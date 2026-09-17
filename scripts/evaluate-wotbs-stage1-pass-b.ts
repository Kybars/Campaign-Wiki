import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { buildCompletenessSweepInput, INVENTORY_COMPLETENESS_SYSTEM_PROMPT, serializeCompactInventory, validateAndUnionCompleteness } from "../lib/ai/inventory-completeness";
import { buildInventoryInput, buildRichExtractionInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT, EXTRACTION_RICH_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { extractionInventoryOutputSchema, extractionRichOutputSchema } from "../lib/ai/schemas";
import { assembleChunkExtraction, validateExtractionInventory, validateExtractionRich } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError, type StructuredModelResult } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { normalizeName } from "../lib/graph/normalize";
import { assertGoldReferenceIsolation, candidateAssemblySafety, loadWotbsGoldReference, loadWotbsStage1Fixture, scoreWotbsInventory, scoreWotbsRelationships, WOTBS_STAGE1_CONTEXT, WOTBS_STAGE1_EXPECTED_DIGEST, WOTBS_STAGE1_EXPECTED_MODEL, type WotbsGoldReference } from "./wotbs-stage1";

loadEnvConfig(process.cwd());
const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const artifactDirectory = new URL("../artifacts/wotbs-stage1-pass-b/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const WALL_CLOCK_TIMEOUT_MS = 600_000;

function boundedHttpFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:") throw new Error("WotBS Stage 1 requires the local HTTP Ollama endpoint");
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
      const deadline = setTimeout(() => { const error = new Error(`WotBS Stage 1 request exceeded ${timeoutMs}ms`); error.name = "FixtureWallClockTimeoutError"; request.destroy(error); }, timeoutMs);
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

function metrics<T>(result: StructuredModelResult<T>, started: number) {
  const serialized = JSON.stringify(result.output);
  return { latencyMs: Math.round(performance.now() - started), usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens }, outputCharacters: serialized.length, outputBytes: Buffer.byteLength(serialized), outputSha256: createHash("sha256").update(serialized).digest("hex") };
}

function failure(error: unknown) {
  if (error instanceof LocalStructuredModelError) return { name: error.name, message: error.message, failureClass: error.failureClass, details: error.details, cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : null };
  return { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) };
}

function sumKnown(values: Array<number | null>) { return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0); }
function countTypes(entities: Array<{ type: string }>) { return Object.fromEntries([...new Set(entities.map((entity) => entity.type))].sort().map((type) => [type, entities.filter((entity) => entity.type === type).length])); }
function aliases(reference: WotbsGoldReference, name: string) {
  const match = [...reference.hard_entities, ...reference.soft_entities].find((entity) => [entity.name, ...(entity.aliases ?? [])].map(normalizeName).includes(normalizeName(name)));
  return match?.name ?? null;
}

async function main() {
  const live = process.argv.includes("--live"); const preflight = process.argv.includes("--preflight");
  if (live === preflight) throw new Error("Choose exactly one of --preflight or --live");
  const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
  if (fixture.chunks.length !== 1) throw new Error(`Expected one WotBS chunk, found ${fixture.chunks.length}`);
  const chunk = fixture.chunks[0];
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local" || config.modelId !== WOTBS_STAGE1_EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen WotBS production configuration mismatch");
  const environment = await runtime(config.baseUrl);
  if (environment.digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen digest mismatch: ${environment.digest ?? "unavailable"}`);
  const fixtureReport = { pdfSha256: fixture.pdfSha256, normalizedTextSha256: fixture.normalizedTextSha256, pages: fixture.pages.map((page) => page.pageNumber), characters: fixture.sourceCharacterCount, estimatedSourceTokens: fixture.estimatedSourceTokens, chunks: fixture.chunks.length };
  const environmentReport = { provider: "local", model: config.modelId, digest: environment.digest, expectedContext: WOTBS_STAGE1_CONTEXT, loadedContext: environment.loadedContext, temperature: 0, reasoning: "none", concurrency: 1, wallClockTimeoutMs: WALL_CLOCK_TIMEOUT_MS };
  if (preflight) { console.log(JSON.stringify({ fixture: fixtureReport, environment: environmentReport, modelCalls: 0, writes: 0, result: "PREFLIGHT_PASS" }, null, 2)); return; }

  mkdirSync(artifactDirectory, { recursive: true });
  if (existsSync(manifestPath)) throw new Error("Pass-B manifest already exists; retry refused");
  const safety = { openAICalls: 0, localGenerationCalls: 0, retries: 0, passBCalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0, officialCampaignWrites: 0, checkpointOrCacheWrites: 0, goldLeakage: 0 };
  const manifest: Record<string, unknown> = { status: "started", fixture: fixtureReport, environment: environmentReport, initial: null, completeness: null, rich: null, candidateAssembly: null, safety };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const provider = createLocalStructuredModelProvider(config, boundedHttpFetch(WALL_CLOCK_TIMEOUT_MS));

  const initialPayload = buildInventoryInput(chunk);
  let initial;
  let initialRaw;
  const initialStarted = performance.now(); safety.localGenerationCalls = 1; writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const response = await provider.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: initialPayload, schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
    initialRaw = response.output; initial = validateExtractionInventory(initialRaw, chunk);
    manifest.initial = { valid: true, ...metrics(response, initialStarted), rawEntities: initialRaw.entities.length, authoritativeEntities: initial.inventory.entities.length, diagnostics: initial.diagnostics };
    writeFileSync(new URL("initial-raw.json", artifactDirectory), `${JSON.stringify(initialRaw, null, 2)}\n`);
  } catch (error) {
    manifest.status = "complete"; manifest.initial = { valid: false, latencyMs: Math.round(performance.now() - initialStarted), error: failure(error) }; manifest.decision = "INCONCLUSIVE";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2)); return;
  }

  const completenessPayload = buildCompletenessSweepInput(chunk, initial.inventory);
  let union;
  let completenessRaw;
  const completenessStarted = performance.now(); safety.localGenerationCalls = 2; writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const response = await provider.parseStructured({ system: INVENTORY_COMPLETENESS_SYSTEM_PROMPT, payload: completenessPayload, schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_completeness_output" });
    completenessRaw = response.output; union = validateAndUnionCompleteness(initial.inventory, completenessRaw, chunk);
    manifest.completeness = { valid: true, ...metrics(response, completenessStarted), compactInventoryCharacters: serializeCompactInventory(initial.inventory).length, compactInventoryEstimatedTokens: Math.ceil(serializeCompactInventory(initial.inventory).length / 4), proposedEntities: union.proposedCount, groundedAdditions: union.groundedInventory.entities.length, duplicateRejections: union.duplicateRejections, groundingExclusions: union.diagnostics };
    writeFileSync(new URL("completeness-raw.json", artifactDirectory), `${JSON.stringify(completenessRaw, null, 2)}\n`);
  } catch (error) {
    manifest.status = "complete"; manifest.completeness = { valid: false, latencyMs: Math.round(performance.now() - completenessStarted), error: failure(error) }; manifest.decision = "INCONCLUSIVE";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2)); return;
  }

  const goldJsonPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot);
  const goldMarkdownPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.md", fixtureRoot);
  const gold = loadWotbsGoldReference(fileURLToPath(goldJsonPath));
  assertGoldReferenceIsolation([EXTRACTION_INVENTORY_SYSTEM_PROMPT, initialPayload, INVENTORY_COMPLETENESS_SYSTEM_PROMPT, completenessPayload], [{ path: fileURLToPath(goldJsonPath), raw: gold.raw }, { path: fileURLToPath(goldMarkdownPath), raw: readFileSync(goldMarkdownPath, "utf8") }]);
  const initialQuality = scoreWotbsInventory(initial.inventory, gold.reference);
  const finalQuality = scoreWotbsInventory(union.finalInventory, gold.reference);
  manifest.initial = { ...(manifest.initial as object), quality: initialQuality };
  manifest.completeness = { ...(manifest.completeness as object), finalEntities: union.finalInventory.entities.length, finalQuality, typeCounts: countTypes(union.finalInventory.entities) };
  const passAGate = finalQuality.supportedEntityRecall >= 0.90 && finalQuality.referenceBoundedPrecision >= 0.90 && finalQuality.questRecall === 1 && finalQuality.itemRecall === 1;
  if (!passAGate) {
    manifest.status = "complete"; manifest.decision = "WOTBS_STAGE1_PASS_A_REGRESSION";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2)); return;
  }

  const richPayload = buildRichExtractionInput(chunk, union.finalInventory);
  let validatedRich;
  const richStarted = performance.now(); safety.localGenerationCalls = 3; safety.passBCalls = 1; writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const response = await provider.parseStructured({ system: EXTRACTION_RICH_SYSTEM_PROMPT, payload: richPayload, schema: extractionRichOutputSchema, schemaName: "extraction_rich_output" });
    validatedRich = validateExtractionRich(response.output, union.finalInventory, chunk.pages);
    const aliasesCount = validatedRich.rich.entities.reduce((sum, entity) => sum + entity.aliases.length, 0);
    const factsCount = validatedRich.rich.entities.reduce((sum, entity) => sum + entity.facts.length, 0);
    manifest.rich = { valid: true, ...metrics(response, richStarted), richEntityRecords: validatedRich.rich.entities.length, aliases: aliasesCount, facts: factsCount, relationships: validatedRich.rich.relationships.length, suspectedMisses: validatedRich.rich.suspected_inventory_misses.length, unknownIdViolations: 0, validationDiagnostics: validatedRich.diagnostics };
    writeFileSync(new URL("rich-raw.json", artifactDirectory), `${JSON.stringify(response.output, null, 2)}\n`);
  } catch (error) {
    manifest.status = "complete"; manifest.rich = { valid: false, latencyMs: Math.round(performance.now() - richStarted), error: failure(error) }; manifest.decision = "WOTBS_STAGE1_PASS_B_FAILED";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2)); return;
  }

  assertGoldReferenceIsolation([EXTRACTION_RICH_SYSTEM_PROMPT, richPayload], [{ path: fileURLToPath(goldJsonPath), raw: gold.raw }, { path: fileURLToPath(goldMarkdownPath), raw: readFileSync(goldMarkdownPath, "utf8") }]);
  const candidate = assembleChunkExtraction(union.finalInventory, validatedRich.rich);
  const assembly = candidateAssemblySafety(union.finalInventory, candidate);
  const goldNames = new Set(union.finalInventory.entities.map((entity) => aliases(gold.reference, entity.name)).filter((name): name is string => name !== null));
  const eligibleRelationships = gold.reference.core_relationships.filter((relationship) => goldNames.has(relationship.source) && goldNames.has(relationship.target));
  const relationshipScore = scoreWotbsRelationships(validatedRich.rich.relationships, union.finalInventory, gold.reference);
  const recoveredRelationships = relationshipScore.recovered.filter((line) => eligibleRelationships.some((relationship) => line === `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`));
  const eligibleFacts = gold.reference.core_facts.filter((fact) => goldNames.has(fact.entity));
  const richMetric = manifest.rich as { usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }; latencyMs: number; outputCharacters: number; facts: number; relationships: number };
  const initialMetric = manifest.initial as { usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }; latencyMs: number; outputCharacters: number };
  const completenessMetric = manifest.completeness as { usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }; latencyMs: number; outputCharacters: number };
  const totalTokens = sumKnown([initialMetric.usage.totalTokens, completenessMetric.usage.totalTokens, richMetric.usage.totalTokens]);
  manifest.candidateAssembly = { entities: candidate.entities.length, facts: candidate.entities.reduce((sum, entity) => sum + entity.facts.length, 0), relationships: candidate.relationships.length, aliases: candidate.entities.reduce((sum, entity) => sum + entity.aliases.length, 0), zeroRichRecords: union.finalInventory.entities.filter((entity) => !validatedRich.rich.entities.some((rich) => rich.inventory_id === entity.temporary_id)).map((entity) => entity.name), suspectedMisses: validatedRich.rich.suspected_inventory_misses, duplicateObservations: finalQuality.duplicateGoldMatches, ...assembly };
  manifest.conditionalQuality = { eligibleRelationships: eligibleRelationships.map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`), recoveredRelationships, relationshipRecall: eligibleRelationships.length ? recoveredRelationships.length / eligibleRelationships.length : 1, eligibleFacts: eligibleFacts.map((fact) => fact.entity), recoveredFacts: "manual semantic audit required; validator retained only source-backed facts", unsupportedRetainedFactsOrRelationships: 0 };
  manifest.efficiency = { initial: initialMetric, completeness: completenessMetric, rich: richMetric, totalTokens, totalLatencyMs: initialMetric.latencyMs + completenessMetric.latencyMs + richMetric.latencyMs, totalOutputCharacters: initialMetric.outputCharacters + completenessMetric.outputCharacters + richMetric.outputCharacters, tokensPerFinalEntity: totalTokens === null ? null : totalTokens / union.finalInventory.entities.length, tokensPerFact: totalTokens === null || richMetric.facts === 0 ? null : totalTokens / richMetric.facts, tokensPerRelationship: totalTokens === null || richMetric.relationships === 0 ? null : totalTokens / richMetric.relationships, passABaselines: { v3Single: 4631, validatedSweep: 9205, rejectedCandidatePipeline: 16667 } };
  const usefulRelationships = recoveredRelationships.length > 0;
  const structurallySafe = assembly.inventorySurvives && assembly.relationshipEndpointsKnownIdsOnly && assembly.unknownFactOwners.length === 0;
  manifest.decision = structurallySafe && usefulRelationships ? "WOTBS_STAGE1_TWO_PASS_VALIDATED" : "WOTBS_STAGE1_RICH_QUALITY_LOW";
  manifest.status = "complete";
  writeFileSync(new URL("final-inventory.json", artifactDirectory), `${JSON.stringify(union.finalInventory, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ...manifest, candidateAssembly: manifest.candidateAssembly, conditionalQuality: manifest.conditionalQuality }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
