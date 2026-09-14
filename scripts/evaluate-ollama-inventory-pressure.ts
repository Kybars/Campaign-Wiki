import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { z } from "zod";
import { buildExtractionInput, buildInventoryInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { extractionInventoryOutputSchema, type ExtractionInventoryOutput } from "../lib/ai/schemas";
import { validateExtractionInventory } from "../lib/ai/source-validation";
import { resolveAIProviderConfig } from "../lib/env";
import { aggregateBoundaryInventories, subdivideInventorySource, summarizeInventoryPressureCalls, type InventoryPressureSubchunk } from "./ollama-inventory-pressure";
import { normalizeName } from "../lib/graph/normalize";
import type { DocumentPage, PageChunk } from "../lib/pdf/types";

loadEnvConfig(process.cwd());

const SOURCE_CAMPAIGN_ID = "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4";
const CACHE_ID = "1ad99ac3-6cf5-4731-bf1e-4736109f0de8";
const EXPECTED_MODEL = "qwen3.5:9b";
const EXPECTED_DIGEST = "6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7";
const EXPECTED_CONTEXT = 32768;
const SCORED_CHUNK = 3;
const artifactDirectory = new URL("../artifacts/ollama-inventory-pressure/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);

interface ReferenceIdentity { name: string; reference_type: string; acceptable_aliases: string[]; historically_missed: boolean }
interface ReferenceChunk { chunk_number: number; normalized_source_text_sha256: string; expected_identities: ReferenceIdentity[] }
interface Attempt {
  subchunk: Omit<InventoryPressureSubchunk, "pages"> & { pageRange: number[]; pageNumbers: number[] };
  status: "success" | "failed";
  latencyMs: number;
  firstByteMs: number | null;
  outputCharacters: number | null;
  outputBytes: number | null;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  entityCount: number | null;
  perType: Record<string, number> | null;
  failureClass: string | null;
  suspectedIncompleteJson: boolean;
  error: string | null;
  inventory?: ExtractionInventoryOutput;
}
interface LevelResult { label: "2 x ~50%" | "4 x ~25%"; calls: Attempt[]; aggregate: ReturnType<typeof aggregateBoundaryInventories> | null; quality: ReturnType<typeof qualityMetrics> | null }

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedSourceHash = (chunk: PageChunk) => { const input = buildExtractionInput(chunk); return sha256(input.slice(input.indexOf("<campaign-page")).replace(/\s+/g, " ").trim()); };
const typeCounts = (inventory: ExtractionInventoryOutput) => Object.fromEntries([...new Set(inventory.entities.map((entity) => entity.type))].sort().map((type) => [type, inventory.entities.filter((entity) => entity.type === type).length]));
const identities = (name: string, aliases: string[]) => new Set([name, ...aliases].map(normalizeName).filter(Boolean));

function qualityMetrics(inventory: ExtractionInventoryOutput[], reference: ReferenceChunk) {
  const entities = inventory.flatMap((item) => item.entities);
  const matched = new Set<number>();
  for (const entity of entities) {
    const candidate = identities(entity.name, entity.aliases);
    const possible = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === entity.type && [...candidate].some((value) => identities(item.name, item.acceptable_aliases).has(value)));
    if (possible.length === 1) matched.add(possible[0].index);
  }
  const expected = reference.expected_identities.length;
  const recall = matched.size / expected;
  const aggregate = aggregateBoundaryInventories(inventory.map((item, index) => ({ subchunkId: String(index), inventory: item })));
  const precision = aggregate.conservativeUnionCount ? matched.size / aggregate.conservativeUnionCount : 0;
  const f1 = recall + precision ? 2 * recall * precision / (recall + precision) : 0;
  const perType = Object.fromEntries([...new Set(reference.expected_identities.map((item) => item.reference_type))].sort().map((type) => {
    const indices = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === type).map(({ index }) => index);
    return [type, { matched: indices.filter((index) => matched.has(index)).length, expected: indices.length, recall: indices.length ? indices.filter((index) => matched.has(index)).length / indices.length : null }];
  }));
  const historical = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.historically_missed);
  return { supportedEntityRecall: recall, referenceBoundedPrecision: precision, f1, matched: matched.size, expected, perType, historicalMissesRecovered: historical.filter(({ index }) => matched.has(index)).length, historicalMissesExpected: historical.length };
}

async function postLong(endpoint: string, body: string, headers: Record<string, string>, startedAt: number) {
  const target = new URL(endpoint);
  return new Promise<{ status: number; statusText: string; body: string; firstByteMs: number | null }>((resolve, reject) => {
    const request = httpRequest({ protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname, method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body).toString() } }, (response) => {
      const firstByteMs = Math.round(performance.now() - startedAt); const parts: Buffer[] = [];
      response.on("data", (part: Buffer) => parts.push(part));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, statusText: response.statusMessage ?? "", body: Buffer.concat(parts).toString("utf8"), firstByteMs }));
      response.on("error", reject);
    });
    request.setTimeout(900_000, () => request.destroy(new Error("Local HTTP request exceeded 900000ms")));
    request.on("error", reject); request.end(body);
  });
}

async function currentDigest(baseUrl: string, model: string) {
  const response = await fetch(`${new URL(baseUrl).origin}/api/tags`);
  if (!response.ok) throw new Error(`Ollama model metadata failed (${response.status})`);
  const body = await response.json() as { models?: Array<{ name?: string; digest?: string }> };
  return body.models?.find((item) => item.name === model)?.digest ?? null;
}

async function runAttempt(config: Extract<ReturnType<typeof resolveAIProviderConfig>, { providerId: "local" }>, subchunk: InventoryPressureSubchunk): Promise<Attempt> {
  const startedAt = performance.now();
  const subchunkDetails = { id: subchunk.id, ordinal: subchunk.ordinal, characterCount: subchunk.characterCount, estimatedInputTokens: subchunk.estimatedInputTokens, sourceHash: subchunk.sourceHash };
  const base: Omit<Attempt, "status" | "latencyMs" | "inventory"> = { subchunk: { ...subchunkDetails, pageRange: [subchunk.pages[0].pageNumber, subchunk.pages.at(-1)!.pageNumber], pageNumbers: subchunk.pages.map((page) => page.pageNumber) }, firstByteMs: null, outputCharacters: null, outputBytes: null, usage: null, entityCount: null, perType: null, failureClass: null, suspectedIncompleteJson: false, error: null };
  try {
    const body = JSON.stringify({ model: config.modelId, messages: [{ role: "system", content: `${EXTRACTION_INVENTORY_SYSTEM_PROMPT}\nReturn only valid JSON matching the requested extraction_inventory_output structure.` }, { role: "user", content: buildInventoryInput({ id: subchunk.id, pages: subchunk.pages, characterCount: subchunk.characterCount }) }], response_format: { type: "json_schema", json_schema: { name: "extraction_inventory_output", strict: true, schema: z.toJSONSchema(extractionInventoryOutputSchema) } }, reasoning_effort: "none", temperature: 0 });
    const response = await postLong(`${config.baseUrl}/chat/completions`, body, { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) }, startedAt);
    base.firstByteMs = response.firstByteMs;
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP_${response.status}: ${response.statusText}`);
    const envelope = JSON.parse(response.body) as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    const content = envelope.choices?.[0]?.message?.content;
    if (!content) throw new Error("Local AI returned no extraction_inventory_output content");
    base.outputCharacters = content.length; base.outputBytes = Buffer.byteLength(content, "utf8"); base.usage = { inputTokens: envelope.usage?.prompt_tokens ?? null, outputTokens: envelope.usage?.completion_tokens ?? null, totalTokens: envelope.usage?.total_tokens ?? null };
    const parsed = extractionInventoryOutputSchema.parse(JSON.parse(content));
    const validated = validateExtractionInventory(parsed, subchunk.pages);
    return { ...base, status: "success", latencyMs: Math.round(performance.now() - startedAt), entityCount: validated.inventory.entities.length, perType: typeCounts(validated.inventory), inventory: validated.inventory };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, status: "failed", latencyMs: Math.round(performance.now() - startedAt), failureClass: message.startsWith("HTTP_") ? message.split(":")[0] : "parse_or_transport_failure", suspectedIncompleteJson: /Unexpected end of JSON input/i.test(message), error: message };
  }
}

async function runLevel(config: Extract<ReturnType<typeof resolveAIProviderConfig>, { providerId: "local" }>, chunk: PageChunk, parts: 2 | 4, reference: ReferenceChunk): Promise<LevelResult> {
  const calls: Attempt[] = [];
  for (const subchunk of subdivideInventorySource(chunk, parts)) { console.log(JSON.stringify({ event: "inventory_started", partition: parts, subchunk: subchunk.ordinal, pages: subchunk.pages.map((page) => page.pageNumber) })); calls.push(await runAttempt(config, subchunk)); console.log(JSON.stringify({ event: "inventory_finished", partition: parts, subchunk: subchunk.ordinal, status: calls.at(-1)!.status, latencyMs: calls.at(-1)!.latencyMs })); }
  const successful = calls.filter((call) => call.status === "success" && call.inventory);
  const aggregate = successful.length === calls.length ? aggregateBoundaryInventories(successful.map((call) => ({ subchunkId: call.subchunk.id, inventory: call.inventory! }))) : null;
  const quality = successful.length === calls.length ? qualityMetrics(successful.map((call) => call.inventory!), reference) : null;
  return { label: parts === 2 ? "2 x ~50%" : "4 x ~25%", calls, aggregate, quality };
}

function savedLevel(level: LevelResult) {
  return { label: level.label, summary: summarizeInventoryPressureCalls(level.calls), calls: level.calls.map((item) => { const call = { ...item }; delete call.inventory; return call; }), aggregate: level.aggregate, quality: level.quality };
}

async function main() {
  if (existsSync(manifestPath)) throw new Error("Existing pressure manifest found; inspect it rather than re-running live inference");
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local" || config.modelId !== EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen local inventory configuration is not active");
  const digest = await currentDigest(config.baseUrl, config.modelId);
  if (digest !== EXPECTED_DIGEST) throw new Error(`Frozen model digest mismatch: ${digest ?? "unavailable"}`);
  const referenceData = JSON.parse(readFileSync(new URL("../docs/audits/extraction_ab_reference.json", import.meta.url), "utf8")) as { chunks: ReferenceChunk[] };
  const reference = referenceData.chunks.find((item) => item.chunk_number === SCORED_CHUNK); if (!reference) throw new Error("Frozen chunk 3 reference unavailable");
  const { createAdminClient } = await import("../lib/db/client"); const database = createAdminClient();
  const document = await database.from("documents").select("id").eq("campaign_id", SOURCE_CAMPAIGN_ID).single(); if (document.error) throw document.error;
  const [pages, chunks] = await Promise.all([database.from("document_pages").select("page_number,text").eq("document_id", document.data.id).order("page_number"), database.from("extraction_cache_chunks").select("chunk_id,chunk_index,page_numbers").eq("cache_run_id", CACHE_ID).order("chunk_index")]);
  if (pages.error || !pages.data || chunks.error || !chunks.data) throw pages.error ?? chunks.error ?? new Error("Frozen source unavailable");
  const stored = chunks.data.find((item) => item.chunk_index + 1 === SCORED_CHUNK); if (!stored) throw new Error("Frozen chunk 3 unavailable");
  const chunk: PageChunk = { id: stored.chunk_id, pages: stored.page_numbers.map((pageNumber): DocumentPage => { const page = pages.data.find((item) => item.page_number === pageNumber); if (!page) throw new Error(`Missing page ${pageNumber}`); return { pageNumber, text: page.text }; }), characterCount: 0 }; chunk.characterCount = chunk.pages.reduce((sum, page) => sum + page.text.length, 0);
  if (normalizedSourceHash(chunk) !== reference.normalized_source_text_sha256) throw new Error("Frozen source hash mismatch");
  mkdirSync(artifactDirectory, { recursive: true });
  const half = await runLevel(config, chunk, 2, reference);
  const quarter = half.calls.every((call) => call.status === "success") ? null : await runLevel(config, chunk, 4, reference);
  const manifest = { status: "complete", source: { chunkNumber: SCORED_CHUNK, chunkId: chunk.id, pages: chunk.pages.map((page) => page.pageNumber), sourceHash: reference.normalized_source_text_sha256, characterCount: chunk.characterCount }, environment: { provider: "local", model: config.modelId, modelDigest: digest, context: EXPECTED_CONTEXT, temperature: 0, reasoningEffort: "none", concurrency: 1, requestTimeoutMs: 900000 }, half: savedLevel(half), quarter: quarter ? savedLevel(quarter) : null, openAICalls: 0, localGenerationCalls: half.calls.length + (quarter?.calls.length ?? 0), campaignWrites: 0, reconciliationCalls: 0, enrichmentCalls: 0 };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
