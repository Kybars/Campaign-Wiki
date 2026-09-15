import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { buildExtractionInput, buildInventoryInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { extractionInventoryOutputSchema, type ValidatedExtractionInventoryOutput } from "../lib/ai/schemas";
import { validateExtractionInventory } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { normalizeName } from "../lib/graph/normalize";
import { logicalInventoryUnion, splitSourceSizeExperiment, verifyCompleteOrderedCoverage, type SourceSizeSubchunk } from "./compact-pass-a-source-size";
import type { DocumentPage, PageChunk } from "../lib/pdf/types";

loadEnvConfig(process.cwd());

const EXPECTED_MODEL = "qwen3.5:9b";
const EXPECTED_DIGEST = "6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7";
const CONTEXT = 32768;
const artifactDirectory = new URL("../artifacts/compact-pass-a-source-size/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const previousManifestPath = new URL("../artifacts/compact-pass-a/manifest.json", import.meta.url);

interface ReferenceIdentity { name: string; reference_type: string; acceptable_aliases: string[]; historically_missed: boolean }
interface ReferenceChunk { chunk_number: number; chunk_id: string; normalized_source_text_sha256: string; expected_identities: ReferenceIdentity[] }
interface Reference { source_campaign_id: string; extraction_cache_id: string; chunks: ReferenceChunk[] }
interface Call {
  originalChunkNumber: number; subchunk: Omit<SourceSizeSubchunk, "pages"> & { pageNumbers: number[]; pageRange: [number, number] };
  valid: boolean; failureClass: string | null; latencyMs: number; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  outputCharacters: number | null; outputBytes: number | null; rawInventoryEntityCount: number | null; deterministicIdCount: number | null; idCollisionCount: number | null; perType: Record<string, number> | null;
  error?: string; rawInventory?: unknown; validatedInventory?: ValidatedExtractionInventoryOutput;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceHash = (chunk: PageChunk) => { const input = buildExtractionInput(chunk); return sha256(input.slice(input.indexOf("<campaign-page")).replace(/\s+/g, " ").trim()); };
const perType = (inventory: ValidatedExtractionInventoryOutput) => Object.fromEntries([...new Set(inventory.entities.map((entity) => entity.type))].sort().map((type) => [type, inventory.entities.filter((entity) => entity.type === type).length]));

const longTimeoutFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const body = typeof init?.body === "string" ? init.body : "";
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body).toString() } : {}) } }, (response) => {
      const parts: Buffer[] = []; response.on("data", (part: Buffer) => parts.push(part));
      response.on("end", () => resolve(new Response(Buffer.concat(parts), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers: response.headers as HeadersInit })));
      response.on("error", reject);
    });
    request.setTimeout(900_000, () => request.destroy(new Error("Local HTTP request exceeded 900000ms")));
    request.on("error", reject); request.end(body);
  });
};

async function currentDigest(baseUrl: string) {
  const response = await fetch(`${new URL(baseUrl).origin}/api/tags`);
  if (!response.ok) throw new Error(`Ollama model metadata failed (${response.status})`);
  const body = await response.json() as { models?: Array<{ name?: string; digest?: string }> };
  return body.models?.find((model) => model.name === EXPECTED_MODEL)?.digest ?? null;
}

function score(inventory: ValidatedExtractionInventoryOutput, reference: ReferenceChunk) {
  const matched = new Set<number>();
  for (const entity of inventory.entities) {
    const name = normalizeName(entity.name);
    const candidates = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === entity.type && [item.name, ...item.acceptable_aliases].some((alias) => normalizeName(alias) === name));
    if (candidates.length === 1) matched.add(candidates[0].index);
  }
  const perTypeRecall = Object.fromEntries([...new Set(reference.expected_identities.map((item) => item.reference_type))].sort().map((type) => {
    const expected = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === type).map(({ index }) => index);
    const count = expected.filter((index) => matched.has(index)).length;
    return [type, { matched: count, expected: expected.length, recall: expected.length ? count / expected.length : null }];
  }));
  const historical = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.historically_missed);
  const recall = reference.expected_identities.length ? matched.size / reference.expected_identities.length : null;
  const precision = inventory.entities.length ? matched.size / inventory.entities.length : null;
  return { matched: matched.size, expected: reference.expected_identities.length, supportedEntityRecall: recall, referenceBoundedPrecision: precision, f1: recall !== null && precision !== null && recall + precision ? 2 * recall * precision / (recall + precision) : null, perTypeRecall, historicalMissesRecovered: historical.filter(({ index }) => matched.has(index)).length, historicalMissesExpected: historical.length };
}

async function call(provider: ReturnType<typeof createLocalStructuredModelProvider>, subchunk: SourceSizeSubchunk): Promise<Call> {
  const details = { ...subchunk, pages: undefined, pageNumbers: subchunk.pages.map((page) => page.pageNumber), pageRange: [subchunk.pages[0].pageNumber, subchunk.pages.at(-1)!.pageNumber] as [number, number] };
  const chunk: PageChunk = { id: subchunk.id, pages: subchunk.pages, characterCount: subchunk.characterCount };
  const started = performance.now();
  try {
    const response = await provider.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: buildInventoryInput(chunk), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
    const serialized = JSON.stringify(response.output); const validated = validateExtractionInventory(response.output, chunk); const ids = validated.inventory.entities.map((entity) => entity.temporary_id);
    return { originalChunkNumber: subchunk.originalChunkNumber, subchunk: details, valid: true, failureClass: null, latencyMs: Math.round(performance.now() - started), usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens }, outputCharacters: serialized.length, outputBytes: Buffer.byteLength(serialized), rawInventoryEntityCount: response.output.entities.length, deterministicIdCount: new Set(ids).size, idCollisionCount: ids.length - new Set(ids).size, perType: perType(validated.inventory), rawInventory: response.output, validatedInventory: validated.inventory };
  } catch (error) {
    return { originalChunkNumber: subchunk.originalChunkNumber, subchunk: details, valid: false, failureClass: error instanceof LocalStructuredModelError ? error.failureClass : "validation/runtime failure", latencyMs: Math.round(performance.now() - started), usage: null, outputCharacters: null, outputBytes: null, rawInventoryEntityCount: null, deterministicIdCount: null, idCollisionCount: null, perType: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  if (existsSync(manifestPath)) throw new Error("Existing source-size manifest found; no live rerun permitted");
  if (!existsSync(previousManifestPath)) throw new Error("Saved compact benchmark manifest is unavailable; chunk 4 cannot be reused");
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local" || config.modelId !== EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen local configuration mismatch");
  const digest = await currentDigest(config.baseUrl); if (digest !== EXPECTED_DIGEST) throw new Error(`Frozen digest mismatch: ${digest ?? "unavailable"}`);
  const reference = JSON.parse(readFileSync(new URL("../docs/audits/extraction_ab_reference.json", import.meta.url), "utf8")) as Reference;
  const previous = JSON.parse(readFileSync(previousManifestPath, "utf8")) as { results: Array<{ chunkNumber: number; valid: boolean; validatedInventory?: ValidatedExtractionInventoryOutput }> };
  const savedFour = previous.results.find((result) => result.chunkNumber === 4 && result.valid && result.validatedInventory);
  const { createAdminClient } = await import("../lib/db/client"); const db = createAdminClient();
  const document = await db.from("documents").select("id").eq("campaign_id", reference.source_campaign_id).single(); if (document.error) throw document.error;
  const [pagesResult, chunksResult] = await Promise.all([db.from("document_pages").select("page_number,text").eq("document_id", document.data.id).order("page_number"), db.from("extraction_cache_chunks").select("chunk_id,chunk_index,page_numbers").eq("cache_run_id", reference.extraction_cache_id).order("chunk_index")]);
  if (pagesResult.error || chunksResult.error || !pagesResult.data || !chunksResult.data) throw pagesResult.error ?? chunksResult.error ?? new Error("Frozen source unavailable");
  const originals = [3, 5].map((number) => {
    const frozen = reference.chunks.find((item) => item.chunk_number === number)!; const stored = chunksResult.data.find((item) => item.chunk_index + 1 === number)!;
    const pages = stored.page_numbers.map((pageNumber): DocumentPage => { const page = pagesResult.data.find((page) => page.page_number === pageNumber); if (!page) throw new Error(`Missing frozen page ${pageNumber}`); return { pageNumber, text: page.text }; });
    const chunk = { id: stored.chunk_id, pages, characterCount: pages.reduce((sum, page) => sum + page.text.length, 0) };
    if (chunk.id !== frozen.chunk_id || sourceHash(chunk) !== frozen.normalized_source_text_sha256) throw new Error(`Frozen source mismatch for chunk ${number}`);
    return { number, chunk };
  });
  const halves = originals.flatMap(({ number, chunk }) => splitSourceSizeExperiment(chunk, number, [`${number}A`, `${number}B`]));
  if (!originals.every(({ chunk, number }) => verifyCompleteOrderedCoverage(chunk.pages, halves.filter((item) => item.originalChunkNumber === number)))) throw new Error("Subdivision coverage proof failed");
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ environment: { provider: "local", model: EXPECTED_MODEL, digest, context: CONTEXT, temperature: 0, reasoningEffort: "none", concurrency: 1 }, sourceCoverage: originals.map(({ number, chunk }) => ({ chunkNumber: number, pages: chunk.pages.map((page) => page.pageNumber), characterCount: chunk.characterCount, sourceHash: sourceHash(chunk), completeNoDuplicateCoverage: verifyCompleteOrderedCoverage(chunk.pages, halves.filter((item) => item.originalChunkNumber === number)) })), halves: halves.map(({ pages, ...half }) => ({ ...half, pageNumbers: pages.map((page) => page.pageNumber), pageRange: [pages[0].pageNumber, pages.at(-1)!.pageNumber] })), safety: { localGenerationCalls: 0, campaignWrites: 0, officialCheckpointOrCacheWrites: 0 } }, null, 2));
    return;
  }
  const provider = createLocalStructuredModelProvider(config, longTimeoutFetch); const calls: Call[] = [];
  for (const half of halves) { console.log(JSON.stringify({ event: "source_size_call_started", subchunk: half.sourceLabel })); calls.push(await call(provider, half)); console.log(JSON.stringify({ event: "source_size_call_finished", subchunk: half.sourceLabel, valid: calls.at(-1)!.valid })); }
  const failedHalves = calls.filter((item) => !item.valid).slice(0, 2);
  for (const failed of failedHalves) {
    const original = halves.find((item) => item.id === failed.subchunk.id)!;
    const children = splitSourceSizeExperiment({ id: original.id, pages: original.pages, characterCount: original.characterCount }, original.originalChunkNumber, [`${original.sourceLabel}1`, `${original.sourceLabel}2`]);
    for (const child of children) { console.log(JSON.stringify({ event: "source_size_call_started", subchunk: child.sourceLabel })); calls.push(await call(provider, child)); console.log(JSON.stringify({ event: "source_size_call_finished", subchunk: child.sourceLabel, valid: calls.at(-1)!.valid })); }
  }
  const reconstructed = Object.fromEntries(originals.map(({ number }) => {
    const successful = calls.filter((item) => item.originalChunkNumber === number && item.valid && item.validatedInventory);
    const selected = (["A", "B"] as const).flatMap((side) => {
      const label = `${number}${side}`;
      const direct = successful.find((item) => item.subchunk.sourceLabel === label);
      if (direct) return [direct];
      const children = successful.filter((item) => item.subchunk.sourceLabel === `${label}1` || item.subchunk.sourceLabel === `${label}2`);
      return children.length === 2 ? children : [];
    });
    const complete = selected.length >= 2 && selected.every((item) => item.validatedInventory);
    if (!complete) return [number, { complete: false, union: null, quality: null }];
    const union = logicalInventoryUnion(selected.map((item) => ({ subchunkId: item.subchunk.sourceLabel, inventory: item.validatedInventory! })));
    const inventory = { entities: union.entities.map((entity) => selected.flatMap((item) => item.validatedInventory!.entities).find((candidate) => candidate.temporary_id === entity.rawIds[0])!) };
    return [number, { complete: true, union, quality: score(inventory, reference.chunks.find((item) => item.chunk_number === number)!) }];
  }));
  const allScored = [3, 5].every((number) => reconstructed[number].complete) && Boolean(savedFour);
  const aggregateInventory = allScored ? { entities: [3, 5].flatMap((number) => reconstructed[number].union.entities.map((entity: { rawIds: string[] }) => calls.flatMap((call) => call.validatedInventory?.entities ?? []).find((candidate) => candidate.temporary_id === entity.rawIds[0])!)).concat(savedFour!.validatedInventory!.entities) } : null;
  const aggregateReference: ReferenceChunk = { chunk_number: 0, chunk_id: "aggregate", normalized_source_text_sha256: "aggregate", expected_identities: reference.chunks.flatMap((chunk) => chunk.expected_identities) };
  const aggregateQuality = aggregateInventory ? score(aggregateInventory, aggregateReference) : null;
  const completeIntervals = [3, 5].filter((number) => reconstructed[number].complete).length;
  const decision = completeIntervals === 2 ? (aggregateQuality && aggregateQuality.supportedEntityRecall! < 0.85 ? "COMPACT_PASS_A_SMALLER_CHUNKS_RELIABLE_RECALL_LOW" : "COMPACT_PASS_A_SMALLER_CHUNKS_RELIABLE") : calls.some((call) => call.valid) ? "COMPACT_PASS_A_SOURCE_SIZE_PARTIALLY_HELPS" : "COMPACT_PASS_A_SOURCE_SIZE_NOT_SUFFICIENT";
  const manifest = { status: "complete", environment: { provider: "local", model: EXPECTED_MODEL, digest, context: CONTEXT, temperature: 0, reasoningEffort: "none", concurrency: 1, transport: "request-scoped 900-second-safe" }, sourceCoverage: originals.map(({ number, chunk }) => ({ chunkNumber: number, pages: chunk.pages.map((page) => page.pageNumber), characterCount: chunk.characterCount, sourceHash: sourceHash(chunk), completeNoDuplicateCoverage: verifyCompleteOrderedCoverage(chunk.pages, halves.filter((item) => item.originalChunkNumber === number)) })), calls, reconstructed, reusedChunk4: savedFour ? { available: true, quality: previous.results.find((result) => result.chunkNumber === 4)?.validatedInventory ? score(savedFour.validatedInventory!, reference.chunks.find((item) => item.chunk_number === 4)!) : null } : { available: false }, aggregateQuality, decision, safety: { openAIGenerationCalls: 0, localGenerationCalls: calls.length, richLiveCalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0, officialCheckpointOrCacheWrites: 0 } };
  mkdirSync(artifactDirectory, { recursive: true }); writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify({ decision, calls: calls.length, completeIntervals, aggregateQuality }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
