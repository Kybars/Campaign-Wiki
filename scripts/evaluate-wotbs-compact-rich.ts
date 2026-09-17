import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import {
  assembleCompactRich,
  buildCompactRichInput,
  COMPACT_RICH_FACTS_SYSTEM_PROMPT,
  COMPACT_RICH_RELATIONSHIPS_SYSTEM_PROMPT,
  compactRichFactsOutputSchema,
  compactRichRelationshipsOutputSchema,
  createDeterministicSourceSpans,
  SOURCE_SPAN_VERSION,
  type CompactRichFactsOutput,
  type CompactRichRelationshipsOutput,
  validateCompactRichFacts,
  validateCompactRichRelationships,
} from "../lib/ai/rich-kernel";
import { validateAndUnionCompleteness } from "../lib/ai/inventory-completeness";
import { extractionInventoryOutputSchema } from "../lib/ai/schemas";
import { assembleChunkExtraction, validateExtractionInventory, validateExtractionRich, validatedInventoryFingerprint } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError, type StructuredModelResult } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { normalizeName } from "../lib/graph/normalize";
import {
  assertGoldReferenceIsolation, candidateAssemblySafety, loadWotbsGoldReference, loadWotbsStage1Fixture,
  scoreWotbsInventory, scoreWotbsRelationships, WOTBS_STAGE1_CONTEXT, WOTBS_STAGE1_EXPECTED_DIGEST,
  WOTBS_STAGE1_EXPECTED_MODEL, type WotbsGoldReference,
} from "./wotbs-stage1";

loadEnvConfig(process.cwd());
const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const priorArtifactRoot = new URL("../artifacts/wotbs-stage1-pass-b/", import.meta.url);
const artifactDirectory = new URL("../artifacts/wotbs-compact-rich/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const WALL_CLOCK_TIMEOUT_MS = 600_000;

function boundedHttpFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:") throw new Error("WotBS compact Rich requires the local HTTP Ollama endpoint");
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
      const deadline = setTimeout(() => { const error = new Error(`WotBS compact Rich request exceeded ${timeoutMs}ms`); error.name = "FixtureWallClockTimeoutError"; request.destroy(error); }, timeoutMs);
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
function goldName(reference: WotbsGoldReference, name: string) {
  const normalized = normalizeName(name);
  return [...reference.hard_entities, ...reference.soft_entities].find((entity) => [entity.name, ...(entity.aliases ?? [])].some((item) => normalizeName(item) === normalized))?.name ?? null;
}

async function main() {
  const live = process.argv.includes("--live"); const preflight = process.argv.includes("--preflight");
  if (live === preflight) throw new Error("Choose exactly one of --preflight or --live");
  const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
  if (fixture.chunks.length !== 1) throw new Error(`Expected one WotBS chunk, found ${fixture.chunks.length}`);
  const chunk = fixture.chunks[0];
  const priorManifest = JSON.parse(readFileSync(new URL("manifest.json", priorArtifactRoot), "utf8")) as { fixture: { pdfSha256: string; normalizedTextSha256: string }; completeness: { finalQuality: { supportedEntityRecall: number; referenceBoundedPrecision: number; questRecall: number; itemRecall: number } } };
  if (priorManifest.fixture.pdfSha256 !== fixture.pdfSha256 || priorManifest.fixture.normalizedTextSha256 !== fixture.normalizedTextSha256) throw new Error("Reusable Pass-A artifact fixture fingerprint mismatch");
  const initialRaw = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("initial-raw.json", priorArtifactRoot), "utf8")));
  const completenessRaw = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("completeness-raw.json", priorArtifactRoot), "utf8")));
  const initial = validateExtractionInventory(initialRaw, chunk);
  const inventory = validateAndUnionCompleteness(initial.inventory, completenessRaw, chunk).finalInventory;
  if (inventory.entities.length !== 42) throw new Error("Reusable Pass-A inventory failed deterministic reconstruction");
  const gate = priorManifest.completeness.finalQuality;
  if (gate.supportedEntityRecall < 0.90 || gate.referenceBoundedPrecision < 0.90 || gate.questRecall !== 1 || gate.itemRecall !== 1) throw new Error("Reusable Pass-A inventory failed frozen quality gate");

  const spans = createDeterministicSourceSpans(chunk);
  const payload = buildCompactRichInput(inventory, spans);
  const config = resolveAIProviderConfig(process.env, "extraction_rich");
  if (config.providerId !== "local" || config.modelId !== WOTBS_STAGE1_EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen WotBS production configuration mismatch");
  const environment = await runtime(config.baseUrl);
  if (environment.digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen digest mismatch: ${environment.digest ?? "unavailable"}`);
  const fixtureReport = { pdfSha256: fixture.pdfSha256, normalizedTextSha256: fixture.normalizedTextSha256, pages: fixture.pages.map((page) => page.pageNumber), characters: fixture.sourceCharacterCount, estimatedSourceTokens: fixture.estimatedSourceTokens, chunks: fixture.chunks.length };
  const environmentReport = { provider: "local", model: config.modelId, digest: environment.digest, expectedContext: WOTBS_STAGE1_CONTEXT, loadedContext: environment.loadedContext, temperature: 0, reasoning: "none", concurrency: 1, wallClockTimeoutMs: WALL_CLOCK_TIMEOUT_MS };
  const passA = { reused: true, sourceArtifact: "artifacts/wotbs-stage1-pass-b/{initial-raw,completeness-raw}.json", inventoryFingerprint: validatedInventoryFingerprint(inventory), finalEntities: inventory.entities.length, quality: gate };
  if (preflight) { console.log(JSON.stringify({ fixture: fixtureReport, environment: environmentReport, passA, spans: { count: spans.length, version: SOURCE_SPAN_VERSION }, modelCalls: 0, writes: 0, result: "PREFLIGHT_PASS" }, null, 2)); return; }

  mkdirSync(artifactDirectory, { recursive: true });
  if (existsSync(manifestPath)) throw new Error("Compact Rich manifest already exists; retry refused");
  const safety = { openAICalls: 0, localGenerationCalls: 0, retries: 0, repairCalls: 0, passBCalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0, officialCampaignWrites: 0, checkpointOrCacheWrites: 0, goldLeakage: 0 };
  const manifest: Record<string, unknown> = { status: "started", fixture: fixtureReport, environment: environmentReport, passA, sourceSpans: { count: spans.length, characters: spans.reduce((sum, span) => sum + span.text.length, 0), version: SOURCE_SPAN_VERSION }, facts: null, relationships: null, safety };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const provider = createLocalStructuredModelProvider(config, boundedHttpFetch(WALL_CLOCK_TIMEOUT_MS));

  let factsValidation: ReturnType<typeof validateCompactRichFacts>; let factsMetric: ReturnType<typeof metrics>;
  const factsStarted = performance.now(); safety.localGenerationCalls = 1; safety.passBCalls = 1;
  try {
    const response = await provider.parseStructured<CompactRichFactsOutput>({ system: COMPACT_RICH_FACTS_SYSTEM_PROMPT, payload, schema: compactRichFactsOutputSchema, schemaName: "compact_rich_facts_output" });
    const raw = compactRichFactsOutputSchema.parse(response.output);
    factsValidation = validateCompactRichFacts(raw, inventory, spans); factsMetric = metrics(response, factsStarted);
    manifest.facts = { valid: true, ...factsMetric, aliasesProposed: raw.aliases.length, aliasesAccepted: factsValidation.acceptedAliases, factsProposed: raw.facts.length, factsAccepted: factsValidation.acceptedFacts, rejected: factsValidation.diagnostics };
    writeFileSync(new URL("facts-raw.json", artifactDirectory), `${JSON.stringify(raw, null, 2)}\n`);
  } catch (error) {
    manifest.status = "complete"; manifest.facts = { valid: false, latencyMs: Math.round(performance.now() - factsStarted), error: failure(error) }; manifest.decision = "WOTBS_COMPACT_FACTS_FAILED";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2)); return;
  }

  let relationshipsValidation: ReturnType<typeof validateCompactRichRelationships>; let relationshipsMetric: ReturnType<typeof metrics>;
  const relationshipsStarted = performance.now(); safety.localGenerationCalls = 2; safety.passBCalls = 2;
  try {
    const response = await provider.parseStructured<CompactRichRelationshipsOutput>({ system: COMPACT_RICH_RELATIONSHIPS_SYSTEM_PROMPT, payload, schema: compactRichRelationshipsOutputSchema, schemaName: "compact_rich_relationships_output" });
    const raw = compactRichRelationshipsOutputSchema.parse(response.output);
    relationshipsValidation = validateCompactRichRelationships(raw, inventory, spans); relationshipsMetric = metrics(response, relationshipsStarted);
    manifest.relationships = { valid: true, ...relationshipsMetric, proposed: raw.relationships.length, accepted: relationshipsValidation.relationships.length, rejected: relationshipsValidation.diagnostics };
    writeFileSync(new URL("relationships-raw.json", artifactDirectory), `${JSON.stringify(raw, null, 2)}\n`);
  } catch (error) {
    manifest.status = "complete"; manifest.relationships = { valid: false, latencyMs: Math.round(performance.now() - relationshipsStarted), error: failure(error) }; manifest.decision = "WOTBS_COMPACT_RELATIONSHIPS_FAILED";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2)); return;
  }

  const goldJsonPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot);
  const goldMarkdownPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.md", fixtureRoot);
  const gold = loadWotbsGoldReference(fileURLToPath(goldJsonPath));
  assertGoldReferenceIsolation([COMPACT_RICH_FACTS_SYSTEM_PROMPT, COMPACT_RICH_RELATIONSHIPS_SYSTEM_PROMPT, payload], [{ path: fileURLToPath(goldJsonPath), raw: gold.raw }, { path: fileURLToPath(goldMarkdownPath), raw: readFileSync(goldMarkdownPath, "utf8") }]);
  const quality = scoreWotbsInventory(inventory, gold.reference);
  const rich = validateExtractionRich(assembleCompactRich(inventory, factsValidation, relationshipsValidation), inventory, fixture.pages).rich;
  const candidate = assembleChunkExtraction(inventory, rich);
  const assembly = candidateAssemblySafety(inventory, candidate);
  const presentGoldNames = new Set(inventory.entities.map((entity) => goldName(gold.reference, entity.name)).filter((name): name is string => Boolean(name)));
  const eligibleRelationships = gold.reference.core_relationships.filter((relationship) => presentGoldNames.has(relationship.source) && presentGoldNames.has(relationship.target));
  const relationshipScore = scoreWotbsRelationships(candidate.relationships, inventory, gold.reference);
  const recoveredRelationships = relationshipScore.recovered.filter((line) => eligibleRelationships.some((relationship) => line === `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`));
  const eligibleFacts = gold.reference.core_facts.filter((fact) => presentGoldNames.has(fact.entity));
  const totalRichTokens = sumKnown([factsMetric.usage.totalTokens, relationshipsMetric.usage.totalTokens]);
  const totalStageTokens = sumKnown([4631, 4574, factsMetric.usage.totalTokens, relationshipsMetric.usage.totalTokens]);
  const totalLatencyMs = 29755 + 20080 + factsMetric.latencyMs + relationshipsMetric.latencyMs;
  manifest.passA = { ...passA, quality };
  manifest.conditionalQuality = { eligibleFacts: eligibleFacts.map((fact) => ({ entity: fact.entity, fact: fact.fact })), recoveredFacts: "manual semantic audit required", eligibleRelationships: eligibleRelationships.map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`), recoveredRelationships, relationshipRecall: eligibleRelationships.length ? recoveredRelationships.length / eligibleRelationships.length : 1, unsupportedRetainedFactsOrRelationships: "manual semantic audit required" };
  manifest.candidateAssembly = { entities: candidate.entities.length, aliases: candidate.entities.reduce((sum, entity) => sum + entity.aliases.length, 0), facts: candidate.entities.reduce((sum, entity) => sum + entity.facts.length, 0), relationships: candidate.relationships.length, entitiesWithZeroFacts: candidate.entities.filter((entity) => entity.facts.length === 0).length, entitiesWithZeroRelationships: candidate.entities.filter((entity) => !candidate.relationships.some((relationship) => relationship.source_temporary_id === entity.temporary_id || relationship.target_temporary_id === entity.temporary_id)).length, suspectedMisses: rich.suspected_inventory_misses.length, ...assembly };
  manifest.efficiency = { facts: factsMetric, relationships: relationshipsMetric, richOnlyTokens: totalRichTokens, richOnlyOutputTokens: sumKnown([factsMetric.usage.outputTokens, relationshipsMetric.usage.outputTokens]), totalStageTokens, totalStageLatencyMs: totalLatencyMs, tokensPerAcceptedFact: totalRichTokens === null || factsValidation.acceptedFacts === 0 ? null : totalRichTokens / factsValidation.acceptedFacts, tokensPerAcceptedRelationship: totalRichTokens === null || relationshipsValidation.relationships.length === 0 ? null : totalRichTokens / relationshipsValidation.relationships.length, oldRich: { latencyMs: 509401, outputCharactersLowerBound: 90423, valid: false } };
  manifest.decision = assembly.inventorySurvives && assembly.relationshipEndpointsKnownIdsOnly && recoveredRelationships.length > 0 && factsValidation.acceptedFacts > 0 ? "MANUAL_QUALITY_AUDIT_REQUIRED" : "WOTBS_COMPACT_RICH_QUALITY_LOW";
  manifest.status = "complete";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
