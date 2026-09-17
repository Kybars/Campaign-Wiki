import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { buildCompletenessSweepInput, INVENTORY_COMPLETENESS_SYSTEM_PROMPT, serializeCompactInventory, validateAndUnionCompleteness } from "../lib/ai/inventory-completeness";
import { buildInventoryInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { extractionInventoryOutputSchema, type ExtractionInventoryOutput, type ValidatedExtractionInventoryOutput } from "../lib/ai/schemas";
import { validateExtractionInventory } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError, type StructuredModelResult } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { assertGoldReferenceIsolation, loadWotbsGoldReference, loadWotbsStage1Fixture, scoreWotbsInventory, WOTBS_STAGE1_CONTEXT, WOTBS_STAGE1_EXPECTED_DIGEST, WOTBS_STAGE1_EXPECTED_MODEL } from "./wotbs-stage1";

loadEnvConfig(process.cwd());

const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const artifactDirectory = new URL("../artifacts/wotbs-v3-completeness-sweep/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const WALL_CLOCK_TIMEOUT_MS = 600_000;

function boundedHttpFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:") throw new Error("WotBS completeness sweep requires the local HTTP Ollama endpoint");
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(deadline); action(); };
      const request = httpRequest({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body).toString() } : {}) } }, (response) => {
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => parts.push(part));
        response.on("end", () => finish(() => resolve(new Response(Buffer.concat(parts), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers: response.headers as HeadersInit }))));
        response.on("aborted", () => finish(() => reject(new Error("Local HTTP response aborted before completion"))));
        response.on("error", (error) => finish(() => reject(error)));
      });
      const deadline = setTimeout(() => { const error = new Error(`WotBS completeness request exceeded ${timeoutMs}ms`); error.name = "FixtureWallClockTimeoutError"; request.destroy(error); }, timeoutMs);
      request.on("error", (error) => finish(() => reject(error)));
      request.end(body);
    });
  };
}

async function runtime(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const [tagsResponse, psResponse] = await Promise.all([fetch(`${origin}/api/tags`), fetch(`${origin}/api/ps`)]);
  if (!tagsResponse.ok) throw new Error(`Ollama tags failed (${tagsResponse.status})`);
  const tags = await tagsResponse.json() as { models?: Array<{ name?: string; digest?: string }> };
  const ps = psResponse.ok ? await psResponse.json() as { models?: Array<{ name?: string; context_length?: number }> } : null;
  return {
    digest: tags.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.digest ?? null,
    loadedContext: ps?.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.context_length ?? null,
  };
}

function callMetrics<T>(result: StructuredModelResult<T>, started: number) {
  const serialized = JSON.stringify(result.output);
  return {
    latencyMs: Math.round(performance.now() - started),
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens },
    outputCharacters: serialized.length,
    outputBytes: Buffer.byteLength(serialized),
    outputSha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

function serializedError(error: unknown) {
  if (error instanceof LocalStructuredModelError) return { name: error.name, message: error.message, failureClass: error.failureClass, details: error.details, cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : null };
  return { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) };
}

function sumKnown(values: Array<number | null>): number | null {
  return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function inventoryTypeCounts(inventory: ValidatedExtractionInventoryOutput) {
  return Object.fromEntries([...new Set(inventory.entities.map((entity) => entity.type))].sort().map((type) => [type, inventory.entities.filter((entity) => entity.type === type).length]));
}

async function main() {
  const live = process.argv.includes("--live");
  const preflight = process.argv.includes("--preflight");
  if (live === preflight) throw new Error("Choose exactly one of --preflight or --live");

  const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
  if (fixture.chunks.length !== 1) throw new Error(`Expected one WotBS chunk, found ${fixture.chunks.length}`);
  const chunk = fixture.chunks[0];
  const initialPayload = buildInventoryInput(chunk);
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local" || config.modelId !== WOTBS_STAGE1_EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen WotBS completeness configuration mismatch");
  const environment = await runtime(config.baseUrl);
  if (environment.digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen digest mismatch: ${environment.digest ?? "unavailable"}`);
  const fixtureReport = { pdfSha256: fixture.pdfSha256, normalizedTextSha256: fixture.normalizedTextSha256, pages: fixture.pages.map((page) => page.pageNumber), characters: fixture.sourceCharacterCount, estimatedSourceTokens: fixture.estimatedSourceTokens, chunks: fixture.chunks.length };
  const environmentReport = { provider: "local", model: config.modelId, digest: environment.digest, expectedContext: WOTBS_STAGE1_CONTEXT, loadedContext: environment.loadedContext, temperature: 0, reasoning: "none", concurrency: 1, wallClockTimeoutMs: WALL_CLOCK_TIMEOUT_MS };
  if (preflight) {
    console.log(JSON.stringify({ fixture: fixtureReport, environment: environmentReport, initialPrompt: { systemCharacters: EXTRACTION_INVENTORY_SYSTEM_PROMPT.length, payloadCharacters: initialPayload.length }, modelCalls: 0, writes: 0, result: "PREFLIGHT_PASS" }, null, 2));
    return;
  }

  mkdirSync(artifactDirectory, { recursive: true });
  if (existsSync(manifestPath)) throw new Error("Completeness-sweep manifest already exists; retry refused");
  const safety = { openAICalls: 0, localGenerationCalls: 0, passBCalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0, officialCampaignWrites: 0, checkpointOrCacheWrites: 0, goldLeakage: 0 };
  const manifest: Record<string, unknown> = { status: "started", fixture: fixtureReport, environment: environmentReport, initial: null, completeness: null, final: null, safety };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const provider = createLocalStructuredModelProvider(config, boundedHttpFetch(WALL_CLOCK_TIMEOUT_MS));

  let initialRaw: ExtractionInventoryOutput;
  let initialInventory: ValidatedExtractionInventoryOutput;
  const initialStarted = performance.now();
  safety.localGenerationCalls = 1;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const result = await provider.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: initialPayload, schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
    initialRaw = result.output;
    const validated = validateExtractionInventory(initialRaw, chunk);
    initialInventory = validated.inventory;
    manifest.initial = { valid: true, ...callMetrics(result, initialStarted), rawEntityCount: initialRaw.entities.length, authoritativeEntityCount: initialInventory.entities.length, typeCounts: inventoryTypeCounts(initialInventory), validationDiagnostics: validated.diagnostics };
    writeFileSync(new URL("initial-raw.json", artifactDirectory), `${JSON.stringify(initialRaw, null, 2)}\n`);
  } catch (error) {
    manifest.status = "complete";
    manifest.initial = { valid: false, latencyMs: Math.round(performance.now() - initialStarted), error: serializedError(error) };
    manifest.decision = "INCONCLUSIVE";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const compactInventory = serializeCompactInventory(initialInventory);
  const completenessPayload = buildCompletenessSweepInput(chunk, initialInventory);
  let sweepRaw: ExtractionInventoryOutput;
  const completenessStarted = performance.now();
  safety.localGenerationCalls = 2;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const result = await provider.parseStructured({ system: INVENTORY_COMPLETENESS_SYSTEM_PROMPT, payload: completenessPayload, schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_completeness_output" });
    sweepRaw = result.output;
    const union = validateAndUnionCompleteness(initialInventory, sweepRaw, chunk);
    manifest.completeness = {
      valid: true,
      ...callMetrics(result, completenessStarted),
      compactInventoryCharacters: compactInventory.length,
      compactInventoryEstimatedTokens: Math.ceil(compactInventory.length / 4),
      payloadCharacters: completenessPayload.length,
      payloadEstimatedTokens: Math.ceil(completenessPayload.length / 4),
      proposedEntities: union.proposedCount,
      groundedEntities: union.groundedInventory.entities.length,
      duplicateRejections: union.duplicateRejections,
      unsupportedOrUngroundedExclusions: union.diagnostics,
    };
    writeFileSync(new URL("completeness-raw.json", artifactDirectory), `${JSON.stringify(sweepRaw, null, 2)}\n`);
  } catch (error) {
    manifest.status = "complete";
    manifest.completeness = { valid: false, latencyMs: Math.round(performance.now() - completenessStarted), error: serializedError(error) };
    manifest.decision = "INCONCLUSIVE";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const goldJsonPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot);
  const goldMarkdownPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.md", fixtureRoot);
  const gold = loadWotbsGoldReference(fileURLToPath(goldJsonPath));
  assertGoldReferenceIsolation(
    [EXTRACTION_INVENTORY_SYSTEM_PROMPT, initialPayload, INVENTORY_COMPLETENESS_SYSTEM_PROMPT, completenessPayload],
    [{ path: fileURLToPath(goldJsonPath), raw: gold.raw }, { path: fileURLToPath(goldMarkdownPath), raw: readFileSync(goldMarkdownPath, "utf8") }],
  );
  const union = validateAndUnionCompleteness(initialInventory, sweepRaw, chunk);
  const initialQuality = scoreWotbsInventory(initialInventory, gold.reference);
  const sweepQuality = scoreWotbsInventory(union.groundedInventory, gold.reference);
  const finalQuality = scoreWotbsInventory(union.finalInventory, gold.reference);
  const initialMatches = new Set(initialQuality.matchedGoldNames);
  const newlyRecovered = finalQuality.matchedGoldNames.filter((name) => !initialMatches.has(name));
  const priorMissNames = ["Shalosha", "Indomitability", "Etinifi", "Innenotdar", "Assassination of Drakus Coaltongue", "The Scourge"];
  const initialMetrics = manifest.initial as { usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }; latencyMs: number; outputCharacters: number };
  const sweepMetrics = manifest.completeness as { usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }; latencyMs: number; outputCharacters: number };
  const totalInputTokens = sumKnown([initialMetrics.usage.inputTokens, sweepMetrics.usage.inputTokens]);
  const totalOutputTokens = sumKnown([initialMetrics.usage.outputTokens, sweepMetrics.usage.outputTokens]);
  const totalModelTokens = sumKnown([initialMetrics.usage.totalTokens, sweepMetrics.usage.totalTokens]);
  const finalIds = union.finalInventory.entities.map((entity) => entity.temporary_id);
  manifest.initial = { ...(manifest.initial as object), quality: initialQuality };
  manifest.completeness = { ...(manifest.completeness as object), groundedQuality: sweepQuality, newlyRecoveredHardReferences: newlyRecovered, recoveredPriorMisses: Object.fromEntries(priorMissNames.map((name) => [name, newlyRecovered.includes(name)])) };
  manifest.final = {
    authoritativeEntities: union.finalInventory.entities.length,
    deterministicIdCount: new Set(finalIds).size,
    idCollisions: finalIds.length - new Set(finalIds).size,
    typeCounts: inventoryTypeCounts(union.finalInventory),
    quality: finalQuality,
    groundingExclusions: union.diagnostics,
    efficiency: {
      totalInputTokens,
      totalOutputTokens,
      totalModelTokens,
      totalLatencyMs: initialMetrics.latencyMs + sweepMetrics.latencyMs,
      totalOutputCharacters: initialMetrics.outputCharacters + sweepMetrics.outputCharacters,
      tokensPerFinalAuthoritativeEntity: totalModelTokens === null ? null : totalModelTokens / union.finalInventory.entities.length,
      incrementalTokensPerNewlyRecoveredGoldEntity: totalModelTokens === null || newlyRecovered.length === 0 ? null : sweepMetrics.usage.totalTokens === null ? null : sweepMetrics.usage.totalTokens / newlyRecovered.length,
      frozenV3: { totalModelTokens: 4631, authoritativeEntities: 39, recall: 0.86, precision: 0.949 },
      rejectedV4: { totalModelTokens: 16667, authoritativeEntities: 41, recall: 0.721, precision: 0.805 },
    },
    validatedInventory: union.finalInventory,
  };
  const reliableQuality = finalQuality.supportedEntityRecall >= 0.90 && finalQuality.referenceBoundedPrecision >= 0.90 && finalQuality.questRecall === 1 && finalQuality.itemRecall === 1;
  if (finalQuality.supportedEntityRecall < 0.90) manifest.decision = "V3_COMPLETENESS_SWEEP_RECALL_LOW";
  else if (finalQuality.referenceBoundedPrecision < 0.90) manifest.decision = "V3_COMPLETENESS_SWEEP_PRECISION_LOW";
  else if (totalModelTokens !== null && totalModelTokens >= 15_000 && newlyRecovered.length < 4) manifest.decision = "V3_COMPLETENESS_SWEEP_TOO_EXPENSIVE";
  else manifest.decision = reliableQuality ? "V3_COMPLETENESS_SWEEP_VALIDATED" : "V3_COMPLETENESS_SWEEP_RECALL_LOW";
  manifest.status = "complete";
  writeFileSync(new URL("final-inventory.json", artifactDirectory), `${JSON.stringify(union.finalInventory, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ...manifest, final: { ...(manifest.final as object), validatedInventory: undefined } }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
