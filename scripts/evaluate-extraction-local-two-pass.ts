import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildExtractionInput, buildInventoryInput, buildRichExtractionInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT, EXTRACTION_RICH_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { EXTRACTION_INVENTORY_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_CONTRACT_VERSION, EXTRACTION_RICH_BEHAVIOR_VERSION, EXTRACTION_RICH_CONTRACT_VERSION } from "../lib/ai/operation-checkpoint";
import { extractionInventoryOutputSchema, extractionRichOutputSchema, type ChunkExtraction, type ExtractionInventoryOutput, type ExtractionRichOutput, type ValidatedExtractionInventoryOutput } from "../lib/ai/schemas";
import { assembleChunkExtraction, validateExtractionInventory, validateExtractionRich } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError, type LocalStructuredFailureClass, type LocalTransportDiagnostics } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { normalizeName } from "../lib/graph/normalize";
import type { DocumentPage, PageChunk } from "../lib/pdf/types";

loadEnvConfig(process.cwd());

const SOURCE_CAMPAIGN_ID = "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4";
const CACHE_ID = "1ad99ac3-6cf5-4731-bf1e-4736109f0de8";
const EXPECTED_MODEL = "qwen3.5:9b";
const EXPECTED_CONTEXT = 32768;
const EXPECTED_FINGERPRINT = "3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6";
const artifactDirectory = new URL("../artifacts/extraction-local-two-pass/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const summaryPath = new URL("summary.json", artifactDirectory);
type Phase = "scored_run_1" | "stress" | "scored_run_2";
type FailureClass = LocalStructuredFailureClass | "evidence validation failure";

interface ReferenceIdentity { name: string; reference_type: string; acceptable_aliases: string[]; historically_missed: boolean }
interface ReferenceChunk { chunk_number: number; chunk_id: string; page_range: number[]; page_numbers: number[]; normalized_source_text_sha256: string; expected_identities: ReferenceIdentity[] }
interface ReferenceArtifact { package_version: string; selected_chunk_order: number[]; chunks: ReferenceChunk[] }
interface PassResult {
  status: "success" | "failed" | "not_run";
  latencyMs: number | null;
  responseModel?: string;
  responseId?: string | null;
  usage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  outputCharacters?: number;
  outputBytes?: number;
  failureClass?: FailureClass;
  httpStatus?: number;
  transport?: LocalTransportDiagnostics;
  error?: string;
}
interface Attempt {
  attemptNumber: number;
  phase: Phase;
  chunkNumber: number;
  chunkId: string;
  pageRange: number[];
  pageNumbers: number[];
  sourceTextSha256: string;
  inventory: PassResult & { entityCount?: number; diagnosticCount?: number };
  rich: PassResult & { factCount?: number; relationshipCount?: number; suspectedInventoryMisses?: number; diagnosticCount?: number };
  endToEndSuccess: boolean;
  combinedOutputBytes: number | null;
  artifact: string;
}
interface Manifest {
  status: "started" | "complete";
  startingCommit: string;
  packageVersion: string;
  provider: "local";
  inventoryModel: string;
  richModel: string;
  modelDigest: string | null;
  contextSetting: 32768;
  temperature: 0;
  reasoningEffort: "none";
  concurrency: 1;
  architecture: "two-pass";
  plannedChunks: 15;
  plannedInventoryOperations: 15;
  plannedRichOperations: 15;
  automaticRetries: 0;
  openAICalls: 0;
  reconciliationCalls: 0;
  enrichmentCalls: 0;
  campaignWrites: 0;
  checkpointWrites: 0;
  attempts: Attempt[];
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedSourceHash = (chunk: PageChunk) => {
  const input = buildExtractionInput(chunk);
  return sha256(input.slice(input.indexOf("<campaign-page")).replace(/\s+/g, " ").trim());
};
const size = (output: unknown) => { const value = JSON.stringify(output); return { characters: value.length, bytes: Buffer.byteLength(value, "utf8") }; };
const countFacts = (output: ChunkExtraction) => output.entities.reduce((sum, entity) => sum + entity.facts.length, 0);
const artifactName = (phase: Phase, chunk: number) => `${phase}-chunk-${chunk}.json`;
const identities = (name: string, aliases: string[]) => new Set([name, ...aliases].map(normalizeName).filter(Boolean));
const passFailure = (error: unknown, latencyMs: number): PassResult => {
  const local = error instanceof LocalStructuredModelError ? error : null;
  return { status: "failed", latencyMs, failureClass: local?.failureClass ?? "evidence validation failure", httpStatus: local?.details.httpStatus, transport: local?.details.transport, error: error instanceof Error ? error.message : String(error) };
};

function scoreChunk(reference: ReferenceChunk, output: ChunkExtraction) {
  const matched = new Set<number>();
  const seen = new Set<string>();
  let extracted = 0;
  for (const entity of output.entities) {
    const entityIdentities = identities(entity.name, entity.aliases);
    const key = [...entityIdentities].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key); extracted += 1;
    const exact = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => identities(item.name, item.acceptable_aliases).has(normalizeName(entity.name)));
    const candidates = exact.length ? exact : reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => [...entityIdentities].some((identity) => identities(item.name, item.acceptable_aliases).has(identity)));
    if (candidates.length === 1 && candidates[0].item.reference_type === entity.type && !matched.has(candidates[0].index)) matched.add(candidates[0].index);
  }
  const expected = reference.expected_identities.length;
  const truePositives = matched.size;
  const recall = expected ? truePositives / expected : 0;
  const precision = extracted ? truePositives / extracted : 0;
  const byType = Object.fromEntries([...new Set(reference.expected_identities.map((item) => item.reference_type))].sort().map((type) => {
    const indexes = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === type);
    const recalled = indexes.filter(({ index }) => matched.has(index)).length;
    return [type, { expected: indexes.length, recalled, recall: indexes.length ? recalled / indexes.length : 0 }];
  }));
  const historical = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.historically_missed);
  return { expected, distinctExtracted: extracted, truePositives, recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0, historicalMisses: historical.length, recoveredHistoricalMisses: historical.filter(({ index }) => matched.has(index)).length, byType };
}

function aggregateScores(scores: ReturnType<typeof scoreChunk>[]) {
  const total = (key: "expected" | "distinctExtracted" | "truePositives" | "historicalMisses" | "recoveredHistoricalMisses") => scores.reduce((sum, score) => sum + score[key], 0);
  const expected = total("expected"); const extracted = total("distinctExtracted"); const truePositives = total("truePositives");
  const recall = expected ? truePositives / expected : 0; const precision = extracted ? truePositives / extracted : 0;
  const types = [...new Set(scores.flatMap((score) => Object.keys(score.byType)))].sort();
  return { expected, distinctExtracted: extracted, truePositives, recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0, historicalMisses: total("historicalMisses"), recoveredHistoricalMisses: total("recoveredHistoricalMisses"), byType: Object.fromEntries(types.map((type) => { const typeExpected = scores.reduce((sum, score) => sum + (score.byType[type]?.expected ?? 0), 0); const recalled = scores.reduce((sum, score) => sum + (score.byType[type]?.recalled ?? 0), 0); return [type, { expected: typeExpected, recalled, recall: typeExpected ? recalled / typeExpected : 0 }]; })) };
}
const percentile = (values: number[], fraction: number) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;
const knownSum = (values: Array<number | null | undefined>) => values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

function summarize(manifest: Manifest, reference: ReferenceArtifact) {
  const phaseSummary = (phase: Phase) => {
    const attempts = manifest.attempts.filter((item) => item.phase === phase);
    const scores = attempts.flatMap((attempt) => {
      if (!attempt.endToEndSuccess) return [];
      const artifact = JSON.parse(readFileSync(new URL(attempt.artifact, artifactDirectory), "utf8")) as { assembledOutput: ChunkExtraction };
      return [scoreChunk(reference.chunks.find((chunk) => chunk.chunk_number === attempt.chunkNumber)!, artifact.assembledOutput)];
    });
    return {
      attempts: attempts.length,
      inventorySuccesses: attempts.filter((item) => item.inventory.status === "success").length,
      richSuccesses: attempts.filter((item) => item.rich.status === "success").length,
      endToEndSuccesses: attempts.filter((item) => item.endToEndSuccess).length,
      inventoryFailures: Object.fromEntries(["transport failure", "HTTP 4xx", "HTTP 5xx", "malformed JSON", "schema-invalid JSON", "evidence validation failure"].map((kind) => [kind, attempts.filter((item) => item.inventory.failureClass === kind).length])),
      richFailures: Object.fromEntries(["not_run", "transport failure", "HTTP 4xx", "HTTP 5xx", "malformed JSON", "schema-invalid JSON", "evidence validation failure"].map((kind) => [kind, attempts.filter((item) => kind === "not_run" ? item.rich.status === "not_run" : item.rich.failureClass === kind).length])),
      metrics: scores.length ? aggregateScores(scores) : null,
      inventoryLatencyMs: attempts.reduce((sum, item) => sum + (item.inventory.latencyMs ?? 0), 0),
      richLatencyMs: attempts.reduce((sum, item) => sum + (item.rich.latencyMs ?? 0), 0),
    };
  };
  const run1 = phaseSummary("scored_run_1"); const stress = phaseSummary("stress"); const run2 = phaseSummary("scored_run_2");
  const scoredScores = manifest.attempts.filter((item) => item.phase !== "stress" && item.endToEndSuccess).map((attempt) => {
    const artifact = JSON.parse(readFileSync(new URL(attempt.artifact, artifactDirectory), "utf8")) as { assembledOutput: ChunkExtraction };
    return scoreChunk(reference.chunks.find((chunk) => chunk.chunk_number === attempt.chunkNumber)!, artifact.assembledOutput);
  });
  const scoredMetrics = scoredScores.length ? aggregateScores(scoredScores) : null;
  const stressAttempts = manifest.attempts.filter((item) => item.phase === "stress");
  const inventoryLatencies = stressAttempts.flatMap((item) => item.inventory.latencyMs == null ? [] : [item.inventory.latencyMs]);
  const richLatencies = stressAttempts.flatMap((item) => item.rich.latencyMs == null ? [] : [item.rich.latencyMs]);
  const reliabilityPass = run1.endToEndSuccesses + run2.endToEndSuccesses >= 5 && stress.endToEndSuccesses >= 8;
  const noCatastrophicCategory = scoredMetrics ? Object.values(scoredMetrics.byType).every((value) => value.recalled > 0) : false;
  const itemRecall = scoredMetrics?.byType.item?.recall ?? 0; const questRecall = scoredMetrics?.byType.quest?.recall ?? 0;
  const decision = reliabilityPass
    ? scoredMetrics && scoredMetrics.recall >= 0.85 && noCatastrophicCategory && itemRecall >= 0.5 && questRecall >= 0.5 ? "TWO_PASS_LOCAL_VALIDATED" : "TWO_PASS_RELIABILITY_IMPROVED_RECALL_LOW"
    : manifest.attempts.some((item) => item.endToEndSuccess) ? "INCONCLUSIVE" : "TWO_PASS_STILL_OVERLOADED";
  return {
    environment: { model: manifest.inventoryModel, digest: manifest.modelDigest, context: manifest.contextSetting, temperature: 0, reasoningEffort: "none", concurrency: 1 },
    safety: { openAICalls: 0, campaignWrites: 0, checkpointWrites: 0, reconciliationCalls: 0, enrichmentCalls: 0 },
    scoredRun1: run1, stress, scoredRun2: run2, combinedScoredMetrics: scoredMetrics,
    stressPressure: {
      inventoryLatencyMs: { mean: inventoryLatencies.length ? Math.round(inventoryLatencies.reduce((a, b) => a + b, 0) / inventoryLatencies.length) : null, median: percentile(inventoryLatencies, 0.5), p95: percentile(inventoryLatencies, 0.95) },
      richLatencyMs: { mean: richLatencies.length ? Math.round(richLatencies.reduce((a, b) => a + b, 0) / richLatencies.length) : null, median: percentile(richLatencies, 0.5), p95: percentile(richLatencies, 0.95) },
      inventoryTokens: knownSum(stressAttempts.map((item) => item.inventory.usage?.totalTokens)), richTokens: knownSum(stressAttempts.map((item) => item.rich.usage?.totalTokens)),
      largestInventoryOutput: [...stressAttempts].filter((item) => item.inventory.outputBytes != null).sort((a, b) => (b.inventory.outputBytes ?? 0) - (a.inventory.outputBytes ?? 0))[0]?.inventory ?? null,
      largestRichOutput: [...stressAttempts].filter((item) => item.rich.outputBytes != null).sort((a, b) => (b.rich.outputBytes ?? 0) - (a.rich.outputBytes ?? 0))[0]?.rich ?? null,
    },
    decision,
  };
}

async function ollamaMetadata(baseUrl: string, model: string) {
  try { const response = await fetch(`${new URL(baseUrl).origin}/api/tags`); if (!response.ok) return { digest: null }; const body = await response.json() as { models?: Array<{ name?: string; digest?: string }> }; return { digest: body.models?.find((item) => item.name === model)?.digest ?? null }; } catch { return { digest: null }; }
}

async function main() {
  const reference = JSON.parse(readFileSync(new URL("../docs/audits/extraction_ab_reference.json", import.meta.url), "utf8")) as ReferenceArtifact;
  if (reference.package_version !== "0.4.8" || reference.chunks.length !== 3) throw new Error("Frozen v0.4.8 scored reference is unavailable");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    if (manifest.status !== "complete") throw new Error("Partial two-pass manifest exists; inspect it before any manual continuation");
    const summary = summarize(manifest, reference); writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`); console.log(JSON.stringify(summary, null, 2)); return;
  }
  const inventoryConfig = resolveAIProviderConfig(process.env, "extraction_inventory");
  const richConfig = resolveAIProviderConfig(process.env, "extraction_rich");
  if (inventoryConfig.providerId !== "local" || richConfig.providerId !== "local") throw new Error("Two-pass local benchmark requires AI_PROVIDER=local");
  if (inventoryConfig.modelId !== EXPECTED_MODEL || richConfig.modelId !== EXPECTED_MODEL) throw new Error(`Both substages must use ${EXPECTED_MODEL}`);
  if (inventoryConfig.allowPersistence || richConfig.allowPersistence) throw new Error("LOCAL_AI_ALLOW_PERSISTENCE must be false");
  if (Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("LOCAL_AI_EXTRACTION_CONCURRENCY must be 1");
  const metadata = await ollamaMetadata(inventoryConfig.baseUrl, EXPECTED_MODEL);
  const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15 * 60_000) });
  const inventoryProvider = createLocalStructuredModelProvider(inventoryConfig, timedFetch);
  const richProvider = createLocalStructuredModelProvider(richConfig, timedFetch);
  const { createAdminClient } = await import("../lib/db/client"); const database = createAdminClient();
  const documentResult = await database.from("documents").select("id").eq("campaign_id", SOURCE_CAMPAIGN_ID).single(); if (documentResult.error) throw documentResult.error;
  const [pagesResult, cacheResult] = await Promise.all([database.from("document_pages").select("page_number,text").eq("document_id", documentResult.data.id).order("page_number"), database.from("extraction_cache_chunks").select("chunk_id,chunk_index,page_numbers").eq("cache_run_id", CACHE_ID).order("chunk_index")]);
  if (pagesResult.error || !pagesResult.data) throw pagesResult.error ?? new Error("Source pages unavailable");
  if (cacheResult.error || !cacheResult.data || cacheResult.data.length !== 9) throw cacheResult.error ?? new Error("Expected nine historical chunks");
  const allChunks = cacheResult.data.map((row) => ({ chunkNumber: row.chunk_index + 1, chunk: { id: row.chunk_id, pages: row.page_numbers.map((pageNumber): DocumentPage => { const page = pagesResult.data.find((item) => item.page_number === pageNumber); if (!page) throw new Error(`Missing page ${pageNumber}`); return { pageNumber, text: page.text }; }), characterCount: 0 } as PageChunk }));
  for (const item of allChunks) item.chunk.characterCount = item.chunk.pages.reduce((sum, page) => sum + page.text.length, 0);
  for (const frozen of reference.chunks) { const current = allChunks.find((item) => item.chunkNumber === frozen.chunk_number); if (!current || normalizedSourceHash(current.chunk) !== frozen.normalized_source_text_sha256) throw new Error(`Frozen source hash mismatch for chunk ${frozen.chunk_number}`); }
  const selected = reference.selected_chunk_order.map((number) => allChunks.find((item) => item.chunkNumber === number)!);
  const plan = [...selected.map((item) => ({ phase: "scored_run_1" as const, item })), ...allChunks.map((item) => ({ phase: "stress" as const, item })), ...selected.map((item) => ({ phase: "scored_run_2" as const, item }))];
  if (process.argv.includes("--dry-run")) { console.log(JSON.stringify({ architecture: "two-pass", provider: "local", inventoryModel: inventoryConfig.modelId, richModel: richConfig.modelId, digest: metadata.digest, context: EXPECTED_CONTEXT, plannedChunks: plan.length, plannedInventoryOperations: plan.length, maximumPlannedRichOperations: plan.length, openAICalls: 0, campaignWrites: 0 }, null, 2)); return; }
  mkdirSync(artifactDirectory, { recursive: true });
  const manifest: Manifest = { status: "started", startingCommit: "3b439430463a6bb774bc10ca5ad90137b28649de", packageVersion: "0.4.9", provider: "local", inventoryModel: inventoryConfig.modelId, richModel: richConfig.modelId, modelDigest: metadata.digest, contextSetting: 32768, temperature: 0, reasoningEffort: "none", concurrency: 1, architecture: "two-pass", plannedChunks: 15, plannedInventoryOperations: 15, plannedRichOperations: 15, automaticRetries: 0, openAICalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0, checkpointWrites: 0, attempts: [] };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [index, { phase, item }] of plan.entries()) {
    const fileName = artifactName(phase, item.chunkNumber); const startedInventory = performance.now();
    let rawInventory: ExtractionInventoryOutput | undefined; let validatedInventory: ValidatedExtractionInventoryOutput | undefined; let inventoryResult: Attempt["inventory"];
    console.log(JSON.stringify({ event: "inventory_started", attempt: index + 1, phase, chunk: item.chunkNumber }));
    try {
      const response = await inventoryProvider.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: buildInventoryInput(item.chunk), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
      rawInventory = response.output; const validated = validateExtractionInventory(response.output, item.chunk); validatedInventory = validated.inventory; const outputSize = size(response.output);
      inventoryResult = { status: "success", latencyMs: Math.round(performance.now() - startedInventory), responseModel: response.modelId, responseId: response.responseId, usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens }, outputCharacters: outputSize.characters, outputBytes: outputSize.bytes, entityCount: validated.inventory.entities.length, diagnosticCount: validated.diagnostics.length };
    } catch (error) { inventoryResult = passFailure(error, Math.round(performance.now() - startedInventory)); }
    let rawRich: ExtractionRichOutput | undefined; let validatedRich: ExtractionRichOutput | undefined; let richResult: Attempt["rich"] = { status: "not_run", latencyMs: null };
    if (validatedInventory) {
      const startedRich = performance.now(); console.log(JSON.stringify({ event: "rich_started", attempt: index + 1, phase, chunk: item.chunkNumber, inventoryEntities: validatedInventory.entities.length }));
      try {
        const response = await richProvider.parseStructured({ system: EXTRACTION_RICH_SYSTEM_PROMPT, payload: buildRichExtractionInput(item.chunk, validatedInventory), schema: extractionRichOutputSchema, schemaName: "extraction_rich_output" });
        rawRich = response.output; const validated = validateExtractionRich(response.output, validatedInventory, item.chunk.pages); validatedRich = validated.rich; const assembled = assembleChunkExtraction(validatedInventory, validated.rich); const outputSize = size(response.output);
        richResult = { status: "success", latencyMs: Math.round(performance.now() - startedRich), responseModel: response.modelId, responseId: response.responseId, usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens }, outputCharacters: outputSize.characters, outputBytes: outputSize.bytes, factCount: countFacts(assembled), relationshipCount: assembled.relationships.length, suspectedInventoryMisses: validated.rich.suspected_inventory_misses.length, diagnosticCount: validated.diagnostics.length };
      } catch (error) { richResult = passFailure(error, Math.round(performance.now() - startedRich)); }
    }
    const assembledOutput = validatedInventory && validatedRich ? assembleChunkExtraction(validatedInventory, validatedRich) : undefined;
    const attempt: Attempt = { attemptNumber: index + 1, phase, chunkNumber: item.chunkNumber, chunkId: item.chunk.id, pageRange: [item.chunk.pages[0].pageNumber, item.chunk.pages.at(-1)!.pageNumber], pageNumbers: item.chunk.pages.map((page) => page.pageNumber), sourceTextSha256: normalizedSourceHash(item.chunk), inventory: inventoryResult, rich: richResult, endToEndSuccess: Boolean(assembledOutput), combinedOutputBytes: inventoryResult.outputBytes != null && richResult.outputBytes != null ? inventoryResult.outputBytes + richResult.outputBytes : null, artifact: fileName };
    writeFileSync(new URL(fileName, artifactDirectory), `${JSON.stringify({ ...attempt, inventoryBehaviorVersion: EXTRACTION_INVENTORY_BEHAVIOR_VERSION, inventorySchemaVersion: EXTRACTION_INVENTORY_CONTRACT_VERSION, richBehaviorVersion: EXTRACTION_RICH_BEHAVIOR_VERSION, richSchemaVersion: EXTRACTION_RICH_CONTRACT_VERSION, rawInventory, validatedInventory, rawRichOutput: rawRich, validatedRichOutput: validatedRich, assembledOutput }, null, 2)}\n`);
    manifest.attempts.push(attempt); writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(attempt));
  }
  manifest.status = "complete"; writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const summary = summarize(manifest, reference); writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`); console.log(JSON.stringify(summary, null, 2)); console.log(JSON.stringify({ invariant: EXPECTED_FINGERPRINT, status: "complete" }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
