import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildExtractionInput, EXTRACTION_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { EXTRACTION_BEHAVIOR_VERSION, EXTRACTION_CONTRACT_VERSION } from "../lib/ai/operation-checkpoint";
import { chunkExtractionSchema, type ChunkExtraction } from "../lib/ai/schemas";
import { validateChunkExtraction } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError, type LocalTransportDiagnostics } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { normalizeName } from "../lib/graph/normalize";
import type { DocumentPage, PageChunk } from "../lib/pdf/types";

loadEnvConfig(process.cwd());

const SOURCE_CAMPAIGN_ID = "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4";
const CACHE_ID = "1ad99ac3-6cf5-4731-bf1e-4736109f0de8";
const EXPECTED_MODEL = "qwen3.5:9b";
const EXPECTED_CONTEXT = 32768;
const EXPECTED_FINGERPRINT = "3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6";
const artifactDirectory = new URL("../artifacts/extraction-local-baseline/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const summaryPath = new URL("summary.json", artifactDirectory);

type Phase = "scored_run_1" | "stress" | "scored_run_2";
type FailureClass = "transport failure" | "HTTP 4xx" | "HTTP 5xx" | "malformed JSON" | "schema-invalid JSON" | "evidence validation failure";

interface ReferenceIdentity { name: string; reference_type: string; acceptable_aliases: string[]; historically_missed: boolean }
interface ReferenceChunk { chunk_number: number; chunk_id: string; page_range: number[]; page_numbers: number[]; normalized_source_text_sha256: string; expected_identities: ReferenceIdentity[] }
interface ReferenceArtifact { frozen_at_commit: string; package_version: string; selected_chunk_order: number[]; chunks: ReferenceChunk[] }
interface Attempt {
  attemptNumber: number;
  phase: Phase;
  chunkNumber: number;
  chunkId: string;
  pageRange: number[];
  pageNumbers: number[];
  sourceTextSha256: string;
  provider: "local";
  requestedModel: string;
  responseModel?: string;
  responseId?: string | null;
  contextSetting: number;
  success: boolean;
  failureClass?: FailureClass;
  httpStatus?: number;
  transport?: LocalTransportDiagnostics;
  schemaValidationFailure?: string;
  latencyMs: number;
  usage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  rawOutputCharacters?: number;
  rawOutputBytes?: number;
  entityCandidates?: number;
  facts?: number;
  relationships?: number;
  validationDiagnosticCount?: number;
  error?: string;
  responseBodyExcerpt?: string;
  artifact: string;
}

interface Manifest {
  status: "started" | "complete";
  startingCommit: string;
  packageVersion: string;
  provider: "local";
  model: string;
  modelDigest: string | null;
  contextSetting: number;
  temperature: 0;
  reasoningEffort: "none";
  concurrency: 1;
  architecture: "single-pass";
  plannedAttempts: 15;
  openAICalls: 0;
  reconciliationCalls: 0;
  enrichmentCalls: 0;
  campaignWrites: 0;
  attempts: Attempt[];
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedSourceHash = (chunk: PageChunk) => {
  const input = buildExtractionInput(chunk);
  return sha256(input.slice(input.indexOf("<campaign-page")).replace(/\s+/g, " ").trim());
};
const artifactName = (phase: Phase, chunkNumber: number) => `${phase}-chunk-${chunkNumber}.json`;
const countFacts = (output: ChunkExtraction) => output.entities.reduce((sum, entity) => sum + entity.facts.length, 0);
const serializedSize = (output: ChunkExtraction) => {
  const value = JSON.stringify(output);
  return { characters: value.length, bytes: Buffer.byteLength(value, "utf8") };
};

function identities(name: string, aliases: string[]) {
  return new Set([name, ...aliases].map(normalizeName).filter(Boolean));
}

function scoreChunk(reference: ReferenceChunk, output: ChunkExtraction) {
  const matched = new Set<number>();
  const seenExtracted = new Set<string>();
  let extracted = 0;
  for (const entity of output.entities) {
    const entityIdentities = identities(entity.name, entity.aliases);
    const extractedKey = [...entityIdentities].sort().join("|");
    if (seenExtracted.has(extractedKey)) continue;
    seenExtracted.add(extractedKey);
    extracted += 1;
    const exact = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => identities(item.name, item.acceptable_aliases).has(normalizeName(entity.name)));
    const matches = exact.length ? exact : reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => [...entityIdentities].some((identity) => identities(item.name, item.acceptable_aliases).has(identity)));
    if (matches.length === 1 && matches[0].item.reference_type === entity.type && !matched.has(matches[0].index)) matched.add(matches[0].index);
  }
  const truePositives = matched.size;
  const expected = reference.expected_identities.length;
  const recall = expected ? truePositives / expected : 0;
  const precision = extracted ? truePositives / extracted : 0;
  const historicalMissIndexes = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.historically_missed);
  const byType = Object.fromEntries([...new Set(reference.expected_identities.map((item) => item.reference_type))].sort().map((type) => {
    const indexes = reference.expected_identities.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === type);
    const recalled = indexes.filter(({ index }) => matched.has(index)).length;
    return [type, { expected: indexes.length, recalled, recall: indexes.length ? recalled / indexes.length : 0 }];
  }));
  return {
    expected,
    distinctExtracted: extracted,
    truePositives,
    recall,
    precision,
    f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0,
    historicalMisses: historicalMissIndexes.length,
    recoveredHistoricalMisses: historicalMissIndexes.filter(({ index }) => matched.has(index)).length,
    byType,
  };
}

function aggregateScores(scores: ReturnType<typeof scoreChunk>[]) {
  const total = (key: "expected" | "distinctExtracted" | "truePositives" | "historicalMisses" | "recoveredHistoricalMisses") => scores.reduce((sum, score) => sum + score[key], 0);
  const expected = total("expected");
  const extracted = total("distinctExtracted");
  const truePositives = total("truePositives");
  const recall = expected ? truePositives / expected : 0;
  const precision = extracted ? truePositives / extracted : 0;
  const typeNames = [...new Set(scores.flatMap((score) => Object.keys(score.byType)))].sort();
  return {
    expected,
    distinctExtracted: extracted,
    truePositives,
    recall,
    precision,
    f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0,
    historicalMisses: total("historicalMisses"),
    recoveredHistoricalMisses: total("recoveredHistoricalMisses"),
    byType: Object.fromEntries(typeNames.map((type) => {
      const typeExpected = scores.reduce((sum, score) => sum + (score.byType[type]?.expected ?? 0), 0);
      const recalled = scores.reduce((sum, score) => sum + (score.byType[type]?.recalled ?? 0), 0);
      return [type, { expected: typeExpected, recalled, recall: typeExpected ? recalled / typeExpected : 0 }];
    })),
  };
}

const percentile = (values: number[], percentage: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentage * sorted.length) - 1];
};
const sumKnown = (values: Array<number | null | undefined>) => values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

function summarize(manifest: Manifest, reference: ReferenceArtifact) {
  const scored = (phase: "scored_run_1" | "scored_run_2") => {
    const attempts = manifest.attempts.filter((attempt) => attempt.phase === phase);
    const scores = attempts.flatMap((attempt) => {
      if (!attempt.success) return [];
      const artifact = JSON.parse(readFileSync(new URL(attempt.artifact, artifactDirectory), "utf8")) as { validatedOutput: ChunkExtraction };
      return [scoreChunk(reference.chunks.find((chunk) => chunk.chunk_number === attempt.chunkNumber)!, artifact.validatedOutput)];
    });
    return {
      attempts: attempts.length,
      successes: attempts.filter((attempt) => attempt.success).length,
      failures: attempts.filter((attempt) => !attempt.success).map((attempt) => ({ chunk: attempt.chunkNumber, failureClass: attempt.failureClass, httpStatus: attempt.httpStatus, error: attempt.error })),
      metrics: scores.length === reference.chunks.length ? aggregateScores(scores) : null,
      entityCandidates: attempts.filter((attempt) => attempt.success).reduce((sum, attempt) => sum + (attempt.entityCandidates ?? 0), 0),
      latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
    };
  };
  const run1 = scored("scored_run_1");
  const run2 = scored("scored_run_2");
  const stressAttempts = manifest.attempts.filter((attempt) => attempt.phase === "stress");
  const latencies = stressAttempts.map((attempt) => attempt.latencyMs);
  const stress = {
    attempted: stressAttempts.length,
    validStructuredOutputs: stressAttempts.filter((attempt) => attempt.success).length,
    failures: Object.fromEntries(["HTTP 4xx", "HTTP 5xx", "malformed JSON", "schema-invalid JSON", "transport failure", "evidence validation failure"].map((failureClass) => [failureClass, stressAttempts.filter((attempt) => attempt.failureClass === failureClass).length])),
    latencyMs: { mean: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null, median: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    totalReportedTokens: sumKnown(stressAttempts.map((attempt) => attempt.usage?.totalTokens)),
    largestOutput: [...stressAttempts].filter((attempt) => attempt.rawOutputBytes != null).sort((left, right) => (right.rawOutputBytes ?? 0) - (left.rawOutputBytes ?? 0))[0] ?? null,
  };
  return {
    environment: { model: manifest.model, digest: manifest.modelDigest, context: manifest.contextSetting, provider: manifest.provider, temperature: manifest.temperature, reasoningEffort: manifest.reasoningEffort, concurrency: manifest.concurrency },
    safety: { openAICalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0 },
    scoredRun1: run1,
    stress,
    scoredRun2: run2,
    variance: {
      successDelta: run2.successes - run1.successes,
      recallDelta: run1.metrics && run2.metrics ? run2.metrics.recall - run1.metrics.recall : null,
      f1Delta: run1.metrics && run2.metrics ? run2.metrics.f1 - run1.metrics.f1 : null,
      entityCountDelta: run2.entityCandidates - run1.entityCandidates,
      historicalMissRecoveryDelta: run1.metrics && run2.metrics ? run2.metrics.recoveredHistoricalMisses - run1.metrics.recoveredHistoricalMisses : null,
      latencyDeltaMs: run2.latencyMs - run1.latencyMs,
    },
  };
}

async function ollamaMetadata(baseUrl: string, model: string) {
  const origin = new URL(baseUrl).origin;
  try {
    const response = await fetch(`${origin}/api/tags`);
    if (!response.ok) return { digest: null };
    const body = await response.json() as { models?: Array<{ name?: string; digest?: string }> };
    return { digest: body.models?.find((item) => item.name === model)?.digest ?? null };
  } catch {
    return { digest: null };
  }
}

async function main() {
  const reference = JSON.parse(readFileSync(new URL("../docs/audits/extraction_ab_reference.json", import.meta.url), "utf8")) as ReferenceArtifact;
  if (reference.package_version !== "0.4.8" || reference.chunks.length !== 3) throw new Error("Frozen v0.4.8 scored reference is unavailable");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    if (manifest.status !== "complete") throw new Error("A partial local baseline manifest exists; inspect it before deciding whether an interrupted operation may be resumed");
    const summary = summarize(manifest, reference);
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const config = resolveAIProviderConfig(process.env, "extraction");
  if (config.providerId !== "local") throw new Error("evaluate:extraction-local requires AI_PROVIDER=local");
  if (config.modelId !== EXPECTED_MODEL) throw new Error(`Expected ${EXPECTED_MODEL}; got ${config.modelId}`);
  if (config.allowPersistence) throw new Error("LOCAL_AI_ALLOW_PERSISTENCE must be false for this benchmark");
  if (Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("LOCAL_AI_EXTRACTION_CONCURRENCY must be 1");
  const metadata = await ollamaMetadata(config.baseUrl, config.modelId);
  const provider = createLocalStructuredModelProvider(config, (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15 * 60_000) }));

  const { createAdminClient } = await import("../lib/db/client");
  const database = createAdminClient();
  const documentResult = await database.from("documents").select("id").eq("campaign_id", SOURCE_CAMPAIGN_ID).single();
  if (documentResult.error) throw documentResult.error;
  const [pagesResult, cacheResult] = await Promise.all([
    database.from("document_pages").select("page_number,text").eq("document_id", documentResult.data.id).order("page_number"),
    database.from("extraction_cache_chunks").select("chunk_id,chunk_index,page_numbers").eq("cache_run_id", CACHE_ID).order("chunk_index"),
  ]);
  if (pagesResult.error || !pagesResult.data) throw pagesResult.error ?? new Error("Source pages unavailable");
  if (cacheResult.error || !cacheResult.data || cacheResult.data.length !== 9) throw cacheResult.error ?? new Error("Expected nine historical Test 3 chunks");
  const allChunks = cacheResult.data.map((row): { chunkNumber: number; chunk: PageChunk } => {
    const pages: DocumentPage[] = row.page_numbers.map((pageNumber) => {
      const page = pagesResult.data.find((candidate) => candidate.page_number === pageNumber);
      if (!page) throw new Error(`Missing source page ${pageNumber}`);
      return { pageNumber, text: page.text };
    });
    return { chunkNumber: row.chunk_index + 1, chunk: { id: row.chunk_id, pages, characterCount: pages.reduce((sum, page) => sum + page.text.length, 0) } };
  });
  for (const frozen of reference.chunks) {
    const current = allChunks.find((item) => item.chunkNumber === frozen.chunk_number);
    if (!current || normalizedSourceHash(current.chunk) !== frozen.normalized_source_text_sha256) throw new Error(`Frozen source hash mismatch for chunk ${frozen.chunk_number}`);
  }
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ provider: config.providerId, model: config.modelId, digest: metadata.digest, context: EXPECTED_CONTEXT, plannedAttempts: 15, phases: { scoredRun1: reference.selected_chunk_order, stress: allChunks.map((item) => item.chunkNumber), scoredRun2: reference.selected_chunk_order }, openAICalls: 0, campaignWrites: 0 }, null, 2));
    return;
  }

  mkdirSync(artifactDirectory, { recursive: true });
  const manifest: Manifest = {
    status: "started",
    startingCommit: "ca87efc2aa6c5c37533a8af7d31e83fa40235e0d",
    packageVersion: "0.4.8",
    provider: "local",
    model: config.modelId,
    modelDigest: metadata.digest,
    contextSetting: EXPECTED_CONTEXT,
    temperature: 0,
    reasoningEffort: "none",
    concurrency: 1,
    architecture: "single-pass",
    plannedAttempts: 15,
    openAICalls: 0,
    reconciliationCalls: 0,
    enrichmentCalls: 0,
    campaignWrites: 0,
    attempts: [],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const selected = reference.selected_chunk_order.map((chunkNumber) => allChunks.find((item) => item.chunkNumber === chunkNumber)!);
  const plan: Array<{ phase: Phase; item: { chunkNumber: number; chunk: PageChunk } }> = [
    ...selected.map((item) => ({ phase: "scored_run_1" as const, item })),
    ...allChunks.map((item) => ({ phase: "stress" as const, item })),
    ...selected.map((item) => ({ phase: "scored_run_2" as const, item })),
  ];

  for (const [index, { phase, item }] of plan.entries()) {
    const { chunkNumber, chunk } = item;
    const fileName = artifactName(phase, chunkNumber);
    const base = {
      attemptNumber: index + 1,
      phase,
      chunkNumber,
      chunkId: chunk.id,
      pageRange: [chunk.pages[0].pageNumber, chunk.pages.at(-1)!.pageNumber],
      pageNumbers: chunk.pages.map((page) => page.pageNumber),
      sourceTextSha256: normalizedSourceHash(chunk),
      provider: "local" as const,
      requestedModel: config.modelId,
      contextSetting: EXPECTED_CONTEXT,
      artifact: fileName,
    };
    const started = performance.now();
    console.log(JSON.stringify({ event: "attempt_started", attempt: index + 1, phase, chunk: chunkNumber }));
    try {
      const response = await provider.parseStructured({ system: EXTRACTION_SYSTEM_PROMPT, payload: buildExtractionInput(chunk), schema: chunkExtractionSchema, schemaName: "campaign_chunk_extraction" });
      let validated: ReturnType<typeof validateChunkExtraction>;
      try {
        validated = validateChunkExtraction(response.output, chunk.pages);
      } catch (error) {
        const attempt: Attempt = { ...base, success: false, failureClass: "evidence validation failure", latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
        writeFileSync(new URL(fileName, artifactDirectory), `${JSON.stringify(attempt, null, 2)}\n`);
        manifest.attempts.push(attempt);
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        continue;
      }
      const size = serializedSize(response.output);
      const artifact = { ...base, success: true, latencyMs: Math.round(performance.now() - started), responseModel: response.modelId, responseId: response.responseId, usage: response.usage, rawOutputCharacters: size.characters, rawOutputBytes: size.bytes, entityCandidates: validated.extraction.entities.length, facts: countFacts(validated.extraction), relationships: validated.extraction.relationships.length, validationDiagnosticCount: validated.diagnostics.length, behaviorVersion: EXTRACTION_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_CONTRACT_VERSION, rawOutput: response.output, validatedOutput: validated.extraction, validationDiagnostics: validated.diagnostics };
      writeFileSync(new URL(fileName, artifactDirectory), `${JSON.stringify(artifact, null, 2)}\n`);
      manifest.attempts.push({ ...base, success: true, latencyMs: artifact.latencyMs, responseModel: response.modelId, responseId: response.responseId, usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens }, rawOutputCharacters: size.characters, rawOutputBytes: size.bytes, entityCandidates: artifact.entityCandidates, facts: artifact.facts, relationships: artifact.relationships, validationDiagnosticCount: artifact.validationDiagnosticCount });
    } catch (error) {
      const classified = error instanceof LocalStructuredModelError ? error : null;
      const attempt: Attempt = { ...base, success: false, failureClass: classified?.failureClass ?? "schema-invalid JSON", httpStatus: classified?.details.httpStatus, transport: classified?.details.transport, schemaValidationFailure: classified?.failureClass === "schema-invalid JSON" ? classified.message : undefined, latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error), responseBodyExcerpt: classified?.details.responseBodyExcerpt };
      writeFileSync(new URL(fileName, artifactDirectory), `${JSON.stringify(attempt, null, 2)}\n`);
      manifest.attempts.push(attempt);
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest.attempts.at(-1)));
  }
  manifest.status = "complete";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const summary = summarize(manifest, reference);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ invariant: EXPECTED_FINGERPRINT, artifacts: "artifacts/extraction-local-baseline", status: "complete" }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
