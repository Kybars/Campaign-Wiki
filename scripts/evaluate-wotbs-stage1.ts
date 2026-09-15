import { loadEnvConfig } from "@next/env";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { buildInventoryInput, buildRichExtractionInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT, EXTRACTION_RICH_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { extractionInventoryOutputSchema, extractionRichOutputSchema, type ExtractionRichOutput, type ValidatedExtractionInventoryOutput } from "../lib/ai/schemas";
import { assembleChunkExtraction, validateExtractionInventory, validateExtractionRich } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import {
  assertGoldReferenceIsolation, candidateAssemblySafety, loadWotbsGoldReference, loadWotbsStage1Fixture,
  scoreWotbsInventory, scoreWotbsRelationships, WOTBS_STAGE1_CONTEXT, WOTBS_STAGE1_EXPECTED_DIGEST,
  WOTBS_STAGE1_EXPECTED_MODEL,
} from "./wotbs-stage1";

loadEnvConfig(process.cwd());

const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const pdfPath = new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot);
const goldJsonPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot);
const goldMarkdownPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.md", fixtureRoot);
const artifactDirectory = new URL("../artifacts/wotbs-stage1/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const WALL_CLOCK_TIMEOUT_MS = 600_000;

function serializableError(error: unknown): unknown {
  if (!(error instanceof Error)) return String(error);
  return {
    name: error.name,
    message: error.message,
    ...(error instanceof LocalStructuredModelError ? { failureClass: error.failureClass, details: error.details } : {}),
    cause: error.cause ? serializableError(error.cause) : null,
  };
}

function boundedHttpFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:") throw new Error("WotBS Stage 1 requires the local HTTP Ollama endpoint");
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        action();
      };
      const request = httpRequest({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body).toString() } : {}) } }, (response) => {
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => parts.push(part));
        response.on("end", () => finish(() => resolve(new Response(Buffer.concat(parts), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers: response.headers as HeadersInit }))));
        response.on("aborted", () => finish(() => reject(new Error("Local HTTP response aborted before completion"))));
        response.on("error", (error) => finish(() => reject(error)));
      });
      const deadline = setTimeout(() => {
        const error = new Error(`WotBS Stage 1 local request exceeded the ${timeoutMs}ms wall-clock deadline`);
        error.name = "FixtureWallClockTimeoutError";
        request.destroy(error);
      }, timeoutMs);
      request.on("error", (error) => finish(() => reject(error)));
      if (init?.signal) {
        if (init.signal.aborted) request.destroy(init.signal.reason);
        else init.signal.addEventListener("abort", () => request.destroy(init.signal?.reason), { once: true });
      }
      request.end(body);
    });
  };
}

async function ollamaRuntime(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const [tagsResponse, psResponse] = await Promise.all([fetch(`${origin}/api/tags`), fetch(`${origin}/api/ps`)]);
  if (!tagsResponse.ok) throw new Error(`Ollama model metadata failed (${tagsResponse.status})`);
  const tags = await tagsResponse.json() as { models?: Array<{ name?: string; digest?: string }> };
  const ps = psResponse.ok ? await psResponse.json() as { models?: Array<{ name?: string; context_length?: number }> } : null;
  return {
    digest: tags.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.digest ?? null,
    loadedContext: ps?.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.context_length ?? null,
  };
}

const outputSize = (value: unknown) => { const serialized = JSON.stringify(value); return { characters: serialized.length, bytes: Buffer.byteLength(serialized) }; };
const usage = (value: { usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } }) => ({ inputTokens: value.usage.inputTokens, outputTokens: value.usage.outputTokens, totalTokens: value.usage.totalTokens });

async function main() {
  const fixture = await loadWotbsStage1Fixture(fileURLToPath(pdfPath));
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local" || config.modelId !== WOTBS_STAGE1_EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen WotBS Stage 1 local configuration mismatch");
  const runtime = await ollamaRuntime(config.baseUrl);
  if (runtime.digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen model digest mismatch: ${runtime.digest ?? "unavailable"}`);
  const plan = {
    fixture: { pdfPages: fixture.pages.map((page) => page.pageNumber), pdfSha256: fixture.pdfSha256, normalizedTextSha256: fixture.normalizedTextSha256, sourceCharacterCount: fixture.sourceCharacterCount, normalizedCharacterCount: fixture.normalizedCharacterCount, estimatedSourceTokens: fixture.estimatedSourceTokens, actualChunkCount: fixture.chunks.length, chunks: fixture.chunks.map((chunk) => ({ id: chunk.id, pages: chunk.pages.map((page) => page.pageNumber), characters: chunk.characterCount })) },
    environment: { provider: "local", model: config.modelId, digest: runtime.digest, configuredContext: WOTBS_STAGE1_CONTEXT, loadedContextBeforeRun: runtime.loadedContext, temperature: 0, reasoningEffort: "none", concurrency: 1, wallClockTimeoutMs: WALL_CLOCK_TIMEOUT_MS },
    budget: { passAMaximumCalls: fixture.chunks.length, passBMaximumCalls: fixture.chunks.length, retries: 0, openAIGenerationCalls: 0, campaignWrites: 0 },
  };
  console.log(JSON.stringify({ event: "wotbs_stage1_plan", ...plan }, null, 2));
  if (process.argv.includes("--dry-run")) return;
  if (existsSync(manifestPath)) throw new Error("Existing WotBS Stage 1 manifest found; live generations may not be retried");
  mkdirSync(artifactDirectory, { recursive: true });
  const manifest: Record<string, unknown> = { status: "started", ...plan, passA: null, passB: null, candidateAssembly: null, safety: { openAIGenerationCalls: 0, localGenerationCalls: 0, campaignWrites: 0, checkpointWrites: 0, reconciliationCalls: 0, enrichmentCalls: 0, goldLeakageCount: 0 } };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const provider = createLocalStructuredModelProvider(config, boundedHttpFetch(WALL_CLOCK_TIMEOUT_MS));
  const inventoryResults: Array<{ chunkId: string; raw: unknown; inventory: ValidatedExtractionInventoryOutput; diagnostics: unknown[]; metrics: unknown }> = [];
  let activePassAStartedAt: number | null = null;
  let activePassAChunkId: string | null = null;
  try {
    for (const chunk of fixture.chunks) {
      const started = performance.now();
      activePassAStartedAt = started;
      activePassAChunkId = chunk.id;
      console.log(JSON.stringify({ event: "wotbs_stage1_pass_a_started", chunkId: chunk.id }));
      (manifest.safety as { localGenerationCalls: number }).localGenerationCalls += 1;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const response = await provider.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: buildInventoryInput(chunk), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
      const validated = validateExtractionInventory(response.output, chunk);
      const ids = validated.inventory.entities.map((entity) => entity.temporary_id);
      inventoryResults.push({ chunkId: chunk.id, raw: response.output, inventory: validated.inventory, diagnostics: validated.diagnostics, metrics: { latencyMs: Math.round(performance.now() - started), usage: usage(response), output: outputSize(response.output), rawEntityCount: response.output.entities.length, deterministicIdCount: new Set(ids).size, idCollisions: ids.length - new Set(ids).size } });
      activePassAStartedAt = null;
      activePassAChunkId = null;
      console.log(JSON.stringify({ event: "wotbs_stage1_pass_a_finished", chunkId: chunk.id, metrics: inventoryResults.at(-1)?.metrics }));
    }
  } catch (error) {
    manifest.status = "complete";
    manifest.passA = { valid: false, error: serializableError(error), completedChunks: inventoryResults.length, failedChunkId: activePassAChunkId, failureLatencyMs: activePassAStartedAt === null ? null : Math.round(performance.now() - activePassAStartedAt), usage: null, outputCharacters: null, outputBytes: null, rawEntityCount: null, deterministicIdCount: null, idCollisions: null };
    manifest.decision = error instanceof LocalStructuredModelError && error.failureClass === "transport failure" ? "WOTBS_STAGE1_INCONCLUSIVE" : "WOTBS_STAGE1_PASS_A_FAILED";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ event: "wotbs_stage1_stopped", decision: manifest.decision, error: serializableError(error) }, null, 2));
    return;
  }
  const aggregateInventory = { entities: inventoryResults.flatMap((result) => result.inventory.entities) };
  const goldJson = loadWotbsGoldReference(fileURLToPath(goldJsonPath));
  const goldMarkdownRaw = readFileSync(goldMarkdownPath, "utf8");
  const goldArtifacts = [{ path: fileURLToPath(goldJsonPath), raw: goldJson.raw }, { path: fileURLToPath(goldMarkdownPath), raw: goldMarkdownRaw }];
  assertGoldReferenceIsolation(fixture.chunks.flatMap((chunk) => [EXTRACTION_INVENTORY_SYSTEM_PROMPT, buildInventoryInput(chunk)]), goldArtifacts);
  const quality = scoreWotbsInventory(aggregateInventory, goldJson.reference);
  manifest.passA = { valid: true, chunks: inventoryResults, quality };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const usableForPassB = quality.supportedEntityRecall >= 0.70 && quality.adventureTitles.matched >= 9 && quality.itemRecall >= 0.5 && quality.anchorNames.matched.length >= 6;
  if (!usableForPassB) {
    manifest.status = "complete";
    manifest.decision = "WOTBS_STAGE1_PASS_A_FAILED";
    manifest.diagnosis = "Valid compact output was too incomplete to ground a fair Pass B run under the predeclared usability gate.";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ event: "wotbs_stage1_stopped", decision: manifest.decision, quality }, null, 2));
    return;
  }
  const richResults: Array<{ chunkId: string; raw: ExtractionRichOutput; rich: ExtractionRichOutput; diagnostics: unknown[]; candidate: ReturnType<typeof assembleChunkExtraction>; metrics: unknown }> = [];
  let activePassBStartedAt: number | null = null;
  let activePassBChunkId: string | null = null;
  try {
    for (const [index, chunk] of fixture.chunks.entries()) {
      const inventory = inventoryResults[index].inventory;
      assertGoldReferenceIsolation([EXTRACTION_RICH_SYSTEM_PROMPT, buildRichExtractionInput(chunk, inventory)], goldArtifacts);
      const started = performance.now();
      activePassBStartedAt = started;
      activePassBChunkId = chunk.id;
      console.log(JSON.stringify({ event: "wotbs_stage1_pass_b_started", chunkId: chunk.id }));
      (manifest.safety as { localGenerationCalls: number }).localGenerationCalls += 1;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const response = await provider.parseStructured({ system: EXTRACTION_RICH_SYSTEM_PROMPT, payload: buildRichExtractionInput(chunk, inventory), schema: extractionRichOutputSchema, schemaName: "extraction_rich_output" });
      const validated = validateExtractionRich(response.output, inventory, chunk.pages);
      const candidate = assembleChunkExtraction(inventory, validated.rich);
      richResults.push({ chunkId: chunk.id, raw: response.output, rich: validated.rich, diagnostics: validated.diagnostics, candidate, metrics: { latencyMs: Math.round(performance.now() - started), usage: usage(response), output: outputSize(response.output), facts: validated.rich.entities.reduce((sum, entity) => sum + entity.facts.length, 0), relationships: validated.rich.relationships.length, aliases: validated.rich.entities.reduce((sum, entity) => sum + entity.aliases.length, 0), suspectedInventoryMisses: validated.rich.suspected_inventory_misses.length } });
      activePassBStartedAt = null;
      activePassBChunkId = null;
      console.log(JSON.stringify({ event: "wotbs_stage1_pass_b_finished", chunkId: chunk.id, metrics: richResults.at(-1)?.metrics }));
    }
  } catch (error) {
    manifest.status = "complete";
    manifest.passB = { valid: false, error: serializableError(error), completedChunks: richResults.length, failedChunkId: activePassBChunkId, failureLatencyMs: activePassBStartedAt === null ? null : Math.round(performance.now() - activePassBStartedAt), usage: null, outputCharacters: null, outputBytes: null };
    manifest.decision = error instanceof LocalStructuredModelError && error.failureClass === "transport failure" ? "WOTBS_STAGE1_INCONCLUSIVE" : "WOTBS_STAGE1_PASS_B_FAILED";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ event: "wotbs_stage1_stopped", decision: manifest.decision, error: serializableError(error) }, null, 2));
    return;
  }
  const candidates = richResults.map((result) => result.candidate);
  const aggregateCandidate = { entities: candidates.flatMap((candidate) => candidate.entities), relationships: candidates.flatMap((candidate) => candidate.relationships) };
  const assemblySafety = candidateAssemblySafety(aggregateInventory, aggregateCandidate);
  const relationshipQuality = scoreWotbsRelationships(aggregateCandidate.relationships, aggregateInventory, goldJson.reference);
  const loadedAfter = await ollamaRuntime(config.baseUrl);
  manifest.status = "complete";
  manifest.passB = { valid: true, chunks: richResults, relationshipQuality };
  manifest.candidateAssembly = { totals: { entities: aggregateCandidate.entities.length, facts: aggregateCandidate.entities.reduce((sum, entity) => sum + entity.facts.length, 0), relationships: aggregateCandidate.relationships.length, aliases: aggregateCandidate.entities.reduce((sum, entity) => sum + entity.aliases.length, 0), suspectedInventoryMisses: richResults.reduce((sum, result) => sum + result.rich.suspected_inventory_misses.length, 0) }, safety: assemblySafety };
  manifest.environment = { ...(manifest.environment as object), loadedContextAfterRun: loadedAfter.loadedContext };
  manifest.decision = quality.supportedEntityRecall >= 0.90 && quality.adventureTitles.matched >= 11 && quality.questRecall >= 0.90 && quality.itemRecall >= 0.50 && quality.duplicateGoldMatches.length === 0 && assemblySafety.inventorySurvives && assemblySafety.relationshipEndpointsKnownIdsOnly ? "WOTBS_STAGE1_END_TO_END_VALIDATED" : "WOTBS_STAGE1_PIPELINE_WORKS_RECALL_LOW";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ event: "wotbs_stage1_complete", decision: manifest.decision, passAQuality: quality, passB: richResults.map((result) => result.metrics), candidateAssembly: manifest.candidateAssembly, relationshipQuality }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "wotbs_stage1_runtime_failure", error: serializableError(error) }, null, 2));
  process.exitCode = 1;
});
