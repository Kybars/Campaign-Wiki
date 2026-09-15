import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { buildExtractionInput, buildInventoryInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { extractionInventoryOutputSchema } from "../lib/ai/schemas";
import { validateExtractionInventory } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { normalizeName } from "../lib/graph/normalize";
import type { DocumentPage, PageChunk } from "../lib/pdf/types";

loadEnvConfig(process.cwd());
const EXPECTED_MODEL = "qwen3.5:9b";
const EXPECTED_DIGEST = "6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7";
const EXPECTED_CONTEXT = 32768;
const artifactDirectory = new URL("../artifacts/compact-pass-a/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const reference = JSON.parse(readFileSync(new URL("../docs/audits/extraction_ab_reference.json", import.meta.url), "utf8")) as Reference;

interface ReferenceIdentity { name: string; reference_type: string; acceptable_aliases: string[]; historically_missed: boolean }
interface ReferenceChunk { chunk_number: number; chunk_id: string; normalized_source_text_sha256: string; expected_identities: ReferenceIdentity[] }
interface Reference { source_campaign_id: string; extraction_cache_id: string; selected_chunk_order: number[]; chunks: ReferenceChunk[] }

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedSourceHash = (chunk: PageChunk) => { const input = buildExtractionInput(chunk); return sha256(input.slice(input.indexOf("<campaign-page")).replace(/\s+/g, " ").trim()); };

const longTimeoutFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== "http:") throw new Error("Frozen Ollama benchmark requires its HTTP local endpoint");
  const body = typeof init?.body === "string" ? init.body : "";
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body).toString() } : {}) } }, (response) => {
      const parts: Buffer[] = [];
      response.on("data", (part: Buffer) => parts.push(part));
      response.on("end", () => resolve(new Response(Buffer.concat(parts), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers: response.headers as HeadersInit })));
      response.on("error", reject);
    });
    request.setTimeout(900_000, () => request.destroy(new Error("Local HTTP request exceeded 900000ms")));
    request.on("error", reject);
    request.end(body);
  });
};

function quality(entities: Array<{ name: string; type: string }>, expected: ReferenceIdentity[]) {
  const matched = new Set<number>();
  for (const entity of entities) {
    const name = normalizeName(entity.name);
    const matches = expected.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === entity.type && [item.name, ...item.acceptable_aliases].some((alias) => normalizeName(alias) === name));
    if (matches.length === 1) matched.add(matches[0].index);
  }
  const recall = expected.length ? matched.size / expected.length : 1;
  const precision = entities.length ? matched.size / entities.length : 0;
  const perTypeRecall = Object.fromEntries([...new Set(expected.map((item) => item.reference_type))].sort().map((type) => { const indices = expected.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === type).map(({ index }) => index); const count = indices.filter((index) => matched.has(index)).length; return [type, { matched: count, expected: indices.length, recall: count / indices.length }]; }));
  const historical = expected.map((item, index) => ({ item, index })).filter(({ item }) => item.historically_missed);
  return { matched: matched.size, expected: expected.length, supportedEntityRecall: recall, referenceBoundedPrecision: precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0, perTypeRecall, historicalMissesRecovered: historical.filter(({ index }) => matched.has(index)).length, historicalMissesExpected: historical.length };
}

async function currentDigest(baseUrl: string) {
  const response = await fetch(`${new URL(baseUrl).origin}/api/tags`);
  if (!response.ok) throw new Error(`Ollama model metadata failed (${response.status})`);
  const body = await response.json() as { models?: Array<{ name?: string; digest?: string }> };
  return body.models?.find((item) => item.name === EXPECTED_MODEL)?.digest ?? null;
}

async function main() {
  if (existsSync(manifestPath)) throw new Error("Existing compact Pass-A manifest found; no rerun permitted");
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local" || config.modelId !== EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen local configuration mismatch");
  const digest = await currentDigest(config.baseUrl);
  if (digest !== EXPECTED_DIGEST) throw new Error(`Frozen digest mismatch: ${digest ?? "unavailable"}`);
  const { createAdminClient } = await import("../lib/db/client");
  const db = createAdminClient();
  const document = await db.from("documents").select("id").eq("campaign_id", reference.source_campaign_id).single();
  if (document.error) throw document.error;
  const [pagesResult, chunksResult] = await Promise.all([db.from("document_pages").select("page_number,text").eq("document_id", document.data.id).order("page_number"), db.from("extraction_cache_chunks").select("chunk_id,chunk_index,page_numbers").eq("cache_run_id", reference.extraction_cache_id).order("chunk_index")]);
  if (pagesResult.error || chunksResult.error || !pagesResult.data || !chunksResult.data) throw pagesResult.error ?? chunksResult.error ?? new Error("Frozen source unavailable");
  const provider = createLocalStructuredModelProvider(config, longTimeoutFetch);
  const results = [];
  for (const chunkNumber of reference.selected_chunk_order) {
    const frozen = reference.chunks.find((item) => item.chunk_number === chunkNumber)!;
    const stored = chunksResult.data.find((item) => item.chunk_index + 1 === chunkNumber)!;
    const pages = stored.page_numbers.map((pageNumber): DocumentPage => { const page = pagesResult.data.find((item) => item.page_number === pageNumber); if (!page) throw new Error(`Missing frozen page ${pageNumber}`); return { pageNumber, text: page.text }; });
    const chunk: PageChunk = { id: stored.chunk_id, pages, characterCount: pages.reduce((sum, page) => sum + page.text.length, 0) };
    if (chunk.id !== frozen.chunk_id || normalizedSourceHash(chunk) !== frozen.normalized_source_text_sha256) throw new Error(`Frozen source mismatch for chunk ${chunkNumber}`);
    const started = performance.now();
    try {
      const response = await provider.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: buildInventoryInput(chunk), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
      const serialized = JSON.stringify(response.output);
      const validated = validateExtractionInventory(response.output, chunk);
      const ids = validated.inventory.entities.map((entity) => entity.temporary_id);
      const perType = Object.fromEntries([...new Set(validated.inventory.entities.map((entity) => entity.type))].sort().map((type) => [type, validated.inventory.entities.filter((entity) => entity.type === type).length]));
      results.push({ chunkNumber, chunkId: chunk.id, pages: chunk.pages.map((page) => page.pageNumber), valid: true, failureClass: null, latencyMs: Math.round(performance.now() - started), usage: response.usage, outputCharacters: serialized.length, outputBytes: Buffer.byteLength(serialized), inventoryEntityCount: validated.inventory.entities.length, perType, deterministicIdCount: new Set(ids).size, duplicateOrCollisionCount: ids.length - new Set(ids).size, diagnosticCount: validated.diagnostics.length, quality: quality(validated.inventory.entities, frozen.expected_identities), rawInventory: response.output, validatedInventory: validated.inventory });
    } catch (error) {
      results.push({ chunkNumber, chunkId: chunk.id, pages: chunk.pages.map((page) => page.pageNumber), valid: false, failureClass: error instanceof LocalStructuredModelError ? error.failureClass : "validation/runtime failure", latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error), quality: null });
    }
    console.log(JSON.stringify({ event: "compact_inventory_complete", ...results.at(-1), rawInventory: undefined, validatedInventory: undefined }));
  }
  const successful = results.filter((result) => result.valid && result.quality);
  const totalMatched = successful.reduce((sum, result) => sum + result.quality!.matched, 0);
  const totalExpected = successful.reduce((sum, result) => sum + result.quality!.expected, 0);
  const overallRecall = successful.length === results.length && totalExpected ? totalMatched / totalExpected : null;
  const decision = successful.length === 3 ? overallRecall! >= 0.85 ? "COMPACT_PASS_A_VALIDATED" : "COMPACT_PASS_A_RELIABLE_RECALL_LOW" : successful.length ? "COMPACT_PASS_A_PARTIALLY_RELIABLE" : "COMPACT_PASS_A_STILL_OVERLOADED";
  const manifest = { status: "complete", environment: { provider: "local", model: EXPECTED_MODEL, digest, context: EXPECTED_CONTEXT, temperature: 0, reasoning: "none", concurrency: 1 }, results, overallRecall, decision, safety: { openAIGenerationCalls: 0, localGenerationCalls: results.length, richLiveCalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0, checkpointWrites: 0 } };
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ decision, overallRecall, valid: successful.length, calls: results.length }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
