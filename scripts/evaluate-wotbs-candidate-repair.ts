import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { extractionInventoryOutputSchema, type ExtractionInventoryOutput } from "../lib/ai/schemas";
import { buildCandidateClassifierInput, buildEventDiscoveryInput, harvestInventoryCandidates, INVENTORY_CANDIDATE_CLASSIFIER_SYSTEM_PROMPT, INVENTORY_EVENT_DISCOVERY_SYSTEM_PROMPT, unionInventoryOutputs, validateCandidateClassifierOutput, type InventoryEventDiscoveryOutput } from "../lib/ai/inventory-candidates";
import { groundInventoryIdentity, validateExtractionInventory } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError, type StructuredModelResult } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { normalizeName } from "../lib/graph/normalize";
import { assertGoldReferenceIsolation, loadWotbsGoldReference, loadWotbsStage1Fixture, scoreWotbsInventory, WOTBS_STAGE1_CONTEXT, WOTBS_STAGE1_EXPECTED_DIGEST, WOTBS_STAGE1_EXPECTED_MODEL, type WotbsGoldEntity } from "./wotbs-stage1";

loadEnvConfig(process.cwd());
const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const artifactDirectory = new URL("../artifacts/wotbs-candidate-repair/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const WALL_CLOCK_TIMEOUT_MS = 600_000;
const inventoryEventDiscoveryOutputSchema = z.object({
  events: z.array(z.object({ name: z.string().min(1).max(200), page: z.number().int().positive() }).strict()),
}).strict();

function boundedHttpFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:") throw new Error("WotBS candidate repair requires the local HTTP Ollama endpoint");
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
      const deadline = setTimeout(() => { const error = new Error(`WotBS candidate repair request exceeded ${timeoutMs}ms`); error.name = "FixtureWallClockTimeoutError"; request.destroy(error); }, timeoutMs);
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
  return { digest: tags.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.digest ?? null, loadedContext: ps?.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.context_length ?? null };
}

function aliases(entity: WotbsGoldEntity) { return [entity.name, ...(entity.aliases ?? [])].map(normalizeName); }
function lexicalCoverage(candidates: ReturnType<typeof harvestInventoryCandidates>["candidates"], hard: WotbsGoldEntity[]) {
  const surfaces = new Set(candidates.map((candidate) => candidate.normalizedSurface));
  const rows = hard.map((entity) => ({ name: entity.name, type: entity.accepted_types[0], covered: aliases(entity).some((name) => surfaces.has(name)) }));
  const literalRows = rows.filter((row) => row.name !== "Assassination of Drakus Coaltongue");
  return {
    hard: ratio(rows), literal: ratio(literalRows),
    perType: Object.fromEntries([...new Set(rows.map((row) => row.type))].map((type) => [type, ratio(rows.filter((row) => row.type === type))])),
    misses: rows.filter((row) => !row.covered).map((row) => row.name),
    priorMisses: Object.fromEntries(["Shalosha", "Indomitability", "Etinifi", "Innenotdar", "The Scourge"].map((name) => [name, rows.find((row) => row.name === name)?.covered ?? false])),
  };
}
function ratio(rows: Array<{ covered: boolean }>) { const matched = rows.filter((row) => row.covered).length; return { matched, expected: rows.length, recall: rows.length ? matched / rows.length : 1 }; }
function metrics<T>(result: StructuredModelResult<T>, started: number) {
  const serialized = JSON.stringify(result.output);
  return { latencyMs: Math.round(performance.now() - started), usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens }, outputCharacters: serialized.length, outputBytes: Buffer.byteLength(serialized), outputSha256: createHash("sha256").update(serialized).digest("hex") };
}
function serializedError(error: unknown) {
  if (error instanceof LocalStructuredModelError) return { name: error.name, message: error.message, failureClass: error.failureClass, details: error.details, cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : null };
  return { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) };
}

async function main() {
  const live = process.argv.includes("--live"); const preflight = process.argv.includes("--preflight");
  if (live === preflight) throw new Error("Choose exactly one of --preflight or --live");
  const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
  if (fixture.chunks.length !== 1) throw new Error(`Expected one WotBS chunk, found ${fixture.chunks.length}`);
  const chunk = fixture.chunks[0];
  const harvestStarted = performance.now(); const harvest = harvestInventoryCandidates(chunk); const harvestCpuMs = performance.now() - harvestStarted;
  const classifierPayload = buildCandidateClassifierInput(chunk); const eventPayload = buildEventDiscoveryInput(chunk);
  const goldPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot); const goldMarkdownPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.md", fixtureRoot);
  const gold = loadWotbsGoldReference(fileURLToPath(goldPath));
  assertGoldReferenceIsolation([INVENTORY_CANDIDATE_CLASSIFIER_SYSTEM_PROMPT, classifierPayload, INVENTORY_EVENT_DISCOVERY_SYSTEM_PROMPT, eventPayload], [{ path: fileURLToPath(goldPath), raw: gold.raw }, { path: fileURLToPath(goldMarkdownPath), raw: readFileSync(goldMarkdownPath, "utf8") }]);
  const coverage = lexicalCoverage(harvest.candidates, gold.reference.hard_entities);
  const payloadCharacters = JSON.stringify(classifierPayload).length;
  const harvestReport = { rawCandidateCount: harvest.rawCount, dedupedCandidateCount: harvest.candidates.length, cpuMs: harvestCpuMs, contextCharacters: harvest.contextCharacters, contextEstimatedTokens: Math.ceil(harvest.contextCharacters / 4), classifierPayloadCharacters: payloadCharacters, classifierPayloadEstimatedTokens: Math.ceil(payloadCharacters / 4), coverage };
  if (coverage.literal.recall < 0.95) { console.log(JSON.stringify({ harvest: harvestReport, decision: "DETERMINISTIC_CANDIDATE_HARVEST_INSUFFICIENT" }, null, 2)); return; }
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local" || config.modelId !== WOTBS_STAGE1_EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen WotBS candidate-repair configuration mismatch");
  const environment = await runtime(config.baseUrl);
  if (environment.digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen digest mismatch: ${environment.digest ?? "unavailable"}`);
  const fixtureReport = { pdfSha256: fixture.pdfSha256, normalizedTextSha256: fixture.normalizedTextSha256, pages: fixture.pages.map((page) => page.pageNumber), characters: fixture.sourceCharacterCount, chunks: fixture.chunks.length };
  const environmentReport = { provider: "local", model: config.modelId, digest: environment.digest, expectedContext: WOTBS_STAGE1_CONTEXT, loadedContext: environment.loadedContext, temperature: 0, reasoning: "none", concurrency: 1, wallClockTimeoutMs: WALL_CLOCK_TIMEOUT_MS };
  if (preflight) { console.log(JSON.stringify({ fixture: fixtureReport, environment: environmentReport, harvest: harvestReport, modelCalls: 0, writes: 0, result: "PREFLIGHT_PASS" }, null, 2)); return; }
  mkdirSync(artifactDirectory, { recursive: true });
  if (existsSync(manifestPath)) throw new Error("Candidate-repair manifest already exists; retry refused");
  const manifest: Record<string, unknown> = { status: "started", fixture: fixtureReport, environment: environmentReport, harvest: harvestReport, localGenerationCalls: 0, classifier: null, events: null, final: null, safety: { openAICalls: 0, passBCalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0, checkpointOrCacheWrites: 0, goldLeakage: 0 } };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const provider = createLocalStructuredModelProvider(config, boundedHttpFetch(WALL_CLOCK_TIMEOUT_MS));
  let classifier: ExtractionInventoryOutput; const classifierStarted = performance.now(); manifest.localGenerationCalls = 1; writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const result = await provider.parseStructured({ system: INVENTORY_CANDIDATE_CLASSIFIER_SYSTEM_PROMPT, payload: classifierPayload, schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_classifier_output" });
    classifier = result.output; const mapped = validateCandidateClassifierOutput(classifier, harvest.candidates);
    manifest.classifier = { valid: true, ...metrics(result, classifierStarted), proposedEntities: classifier.entities.length, acceptedEntities: mapped.accepted.entities.length, rejectedCandidates: harvest.candidates.length - mapped.accepted.entities.length, unknownOutputRejections: mapped.unknown };
    writeFileSync(new URL("classifier-raw.json", artifactDirectory), `${JSON.stringify(classifier, null, 2)}\n`);
  } catch (error) { manifest.status = "complete"; manifest.classifier = { valid: false, latencyMs: Math.round(performance.now() - classifierStarted), error: serializedError(error) }; manifest.decision = "SEMANTIC_CLASSIFIER_FAILED"; writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2)); return; }
  let events: InventoryEventDiscoveryOutput; const eventStarted = performance.now(); manifest.localGenerationCalls = 2; writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const result = await provider.parseStructured({ system: INVENTORY_EVENT_DISCOVERY_SYSTEM_PROMPT, payload: eventPayload, schema: inventoryEventDiscoveryOutputSchema, schemaName: "extraction_inventory_events_output" });
    events = result.output; const groundings = events.events.map((event) => ({ event, ...groundInventoryIdentity({ ...event, type: "event" }, chunk.pages) }));
    manifest.events = { valid: true, ...metrics(result, eventStarted), proposedEvents: events.events.length, groundedEvents: groundings.filter((item) => item.source).length, rejectedEvents: groundings.filter((item) => !item.source).map((item) => ({ event: item.event, reason: item.reason })) };
    writeFileSync(new URL("events-raw.json", artifactDirectory), `${JSON.stringify(events, null, 2)}\n`);
  } catch (error) { manifest.status = "complete"; manifest.events = { valid: false, latencyMs: Math.round(performance.now() - eventStarted), error: serializedError(error) }; manifest.decision = "EVENT_DISCOVERY_FAILED"; writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2)); return; }
  const mapped = validateCandidateClassifierOutput(classifier, harvest.candidates); const rawInventory = unionInventoryOutputs(mapped.accepted, events); const validated = validateExtractionInventory(rawInventory, chunk); const quality = scoreWotbsInventory(validated.inventory, gold.reference);
  const ids = validated.inventory.entities.map((entity) => entity.temporary_id);
  const classifierMetrics = manifest.classifier as { usage: { totalTokens: number | null }; latencyMs: number; outputCharacters: number }; const eventMetrics = manifest.events as { usage: { totalTokens: number | null }; latencyMs: number; outputCharacters: number };
  const totalTokens = classifierMetrics.usage.totalTokens == null || eventMetrics.usage.totalTokens == null ? null : classifierMetrics.usage.totalTokens + eventMetrics.usage.totalTokens;
  manifest.final = { authoritativeEntities: validated.inventory.entities.length, deterministicIds: new Set(ids).size, idCollisions: ids.length - new Set(ids).size, diagnostics: validated.diagnostics, quality, totalModelTokens: totalTokens, tokensPerAuthoritativeEntity: totalTokens == null ? null : totalTokens / validated.inventory.entities.length, totalLatencyMs: classifierMetrics.latencyMs + eventMetrics.latencyMs, totalOutputCharacters: classifierMetrics.outputCharacters + eventMetrics.outputCharacters, rawInventory, validatedInventory: validated.inventory };
  manifest.status = "complete"; manifest.decision = quality.supportedEntityRecall >= 0.90 && quality.referenceBoundedPrecision >= 0.90 && quality.questRecall === 1 && quality.itemRecall === 1 ? "WOTBS_PASS_A_CANDIDATE_PIPELINE_VALIDATED" : "WOTBS_PASS_A_CANDIDATE_PIPELINE_RECALL_LOW";
  writeFileSync(new URL("validated-inventory.json", artifactDirectory), `${JSON.stringify(validated.inventory, null, 2)}\n`); writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ...manifest, final: { ...(manifest.final as object), rawInventory: undefined, validatedInventory: undefined } }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
