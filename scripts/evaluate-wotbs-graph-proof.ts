import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { buildGraphExtractionInput, GRAPH_EXTRACTION_BEHAVIOR_VERSION, GRAPH_EXTRACTION_CONTRACT_VERSION, GRAPH_EXTRACTION_SYSTEM_PROMPT, graphExtractionOutputSchema, validateGraphExtraction } from "../lib/ai/graph-extraction";
import { validateAndUnionCompleteness } from "../lib/ai/inventory-completeness";
import { extractionInventoryOutputSchema, type CandidateRelationship } from "../lib/ai/schemas";
import { validateExtractionInventory, validatedInventoryFingerprint } from "../lib/ai/source-validation";
import { normalizeName } from "../lib/graph/normalize";
import { normalizeRelationshipFact, relationshipSemanticKey } from "../lib/relationships/normalize";
import { createLocalStructuredModelProvider, createOpenAIStructuredModelProvider, LocalStructuredModelError, type StructuredModelResult } from "../lib/ai/structured-model-provider";
import { getOpenAIEnv, resolveAIProviderConfig } from "../lib/env";
import { assertGoldReferenceIsolation, loadWotbsGoldReference, loadWotbsStage1Fixture, scoreWotbsRelationships, WOTBS_STAGE1_CONTEXT, WOTBS_STAGE1_EXPECTED_DIGEST, WOTBS_STAGE1_EXPECTED_MODEL } from "./wotbs-stage1";

loadEnvConfig(process.cwd());
const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const priorArtifactRoot = new URL("../artifacts/wotbs-stage1-pass-b/", import.meta.url);
let resultRoot = new URL("../artifacts/wotbs-graph-proof/", import.meta.url);
let resultManifest = new URL("manifest.json", resultRoot);
const DEADLINE_MS = 300_000;

function boundedHttpFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:") throw new Error("Local graph proof requires the local HTTP Ollama endpoint");
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(deadline); action(); };
      const request = httpRequest({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body).toString() } : {}) } }, (response) => {
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => parts.push(part));
        response.on("end", () => finish(() => resolve(new Response(Buffer.concat(parts), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers: response.headers as HeadersInit }))));
        response.on("aborted", () => finish(() => reject(new Error("Local graph response aborted before completion"))));
        response.on("error", (error) => finish(() => reject(error)));
      });
      const deadline = setTimeout(() => { const error = new Error(`Graph proof exceeded ${timeoutMs}ms deadline`); error.name = "GraphProofDeadlineError"; request.destroy(error); }, timeoutMs);
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

function metrics<T>(result: StructuredModelResult<T>, started: number, input: string) {
  const output = JSON.stringify(result.output);
  return { provider: result.providerId, model: result.modelId, latencyMs: Math.round(performance.now() - started), inputCharacters: input.length, inputBytes: Buffer.byteLength(input), inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens, outputCharacters: output.length, outputBytes: Buffer.byteLength(output), outputSha256: createHash("sha256").update(output).digest("hex") };
}

function errorSummary(error: unknown) {
  if (error instanceof LocalStructuredModelError) return { name: error.name, message: error.message, failureClass: error.failureClass, details: error.details, cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : null };
  return { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) };
}

function goldName(gold: ReturnType<typeof loadWotbsGoldReference>["reference"], name: string) {
  const normalized = normalizeName(name);
  return [...gold.hard_entities, ...gold.soft_entities].find((entity) => [entity.name, ...(entity.aliases ?? [])].some((candidate) => normalizeName(candidate) === normalized))?.name ?? null;
}

async function main() {
  const rescoreSaved = process.argv.includes("--rescore-saved");
  const finalizeManualAudit = process.argv.includes("--finalize-manual-audit");
  const terraAudit = process.argv.includes("--terra-audit");
  const live = process.argv.includes("--live");
  const terraLive = process.argv.includes("--terra-live");
  const preflight = process.argv.includes("--preflight");
  if (rescoreSaved) {
    if (finalizeManualAudit || live || terraLive || preflight) throw new Error("Saved rescore cannot be combined with preflight, live, or audit-finalization modes");
    const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
    if (fixture.chunks.length !== 1) throw new Error(`Expected one WotBS chunk, found ${fixture.chunks.length}`);
    const chunk = fixture.chunks[0];
    const initialRaw = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("initial-raw.json", priorArtifactRoot), "utf8")));
    const completenessRaw = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("completeness-raw.json", priorArtifactRoot), "utf8")));
    const inventory = validateAndUnionCompleteness(validateExtractionInventory(initialRaw, chunk).inventory, completenessRaw, chunk).finalInventory;
    if (inventory.entities.length !== 42) throw new Error(`Frozen inventory changed: ${inventory.entities.length} entities`);
    const gold = loadWotbsGoldReference(fileURLToPath(new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot)));
    const present = new Set(inventory.entities.map((entity) => goldName(gold.reference, entity.name)).filter((name): name is string => name !== null));
    const eligible = gold.reference.core_relationships.filter((relationship) => present.has(relationship.source) && present.has(relationship.target));
    const eligibleKeys = eligible.map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`);

    const scoreSavedRun = (root: URL) => {
      const raw = graphExtractionOutputSchema.parse(JSON.parse(readFileSync(new URL("raw-output.json", root), "utf8")));
      const validated = validateGraphExtraction(raw, inventory, chunk);
      const candidates = validated.relationships.map((relationship, index): CandidateRelationship => ({
        source_temporary_id: relationship.sourceInventoryId,
        target_temporary_id: relationship.targetInventoryId,
        relationship_type: relationship.relationshipType,
        description: relationship.relationshipType,
        confidence: 1,
        sources: [{ page_number: relationship.page, supporting_text: "Page-level graph proof provenance." }],
        __index: index,
      } as CandidateRelationship));
      const score = scoreWotbsRelationships(candidates, inventory, gold.reference);
      const recovered = score.recovered.filter((relationship) => eligibleKeys.includes(relationship));
      return {
        proposed: validated.proposedRelationships,
        accepted: validated.relationships.length,
        recovered,
        recoveredCount: recovered.length,
        recall: eligible.length ? recovered.length / eligible.length : 1,
        missed: eligibleKeys.filter((relationship) => !recovered.includes(relationship)),
      };
    };

    const qwen = scoreSavedRun(new URL("../artifacts/wotbs-graph-proof/", import.meta.url));
    const terra = scoreSavedRun(new URL("../artifacts/wotbs-graph-proof-terra/", import.meta.url));
    const qwenSet = new Set(qwen.recovered);
    const terraSet = new Set(terra.recovered);
    const recoveredBoth = eligibleKeys.filter((relationship) => qwenSet.has(relationship) && terraSet.has(relationship));
    const qwenOnly = eligibleKeys.filter((relationship) => qwenSet.has(relationship) && !terraSet.has(relationship));
    const terraOnly = eligibleKeys.filter((relationship) => !qwenSet.has(relationship) && terraSet.has(relationship));
    const missedBoth = eligibleKeys.filter((relationship) => !qwenSet.has(relationship) && !terraSet.has(relationship));
    const unionRecovered = eligibleKeys.length - missedBoth.length;
    console.log(JSON.stringify({
      result: "GRAPH_SCORER_NORMALIZATION_FIXED",
      eligibleGoldRelationships: eligible.length,
      qwen,
      terra,
      union: { recoveredCount: unionRecovered, recall: eligible.length ? unionRecovered / eligible.length : 1 },
      recoveredBoth,
      qwenOnly,
      terraOnly,
      missedBoth,
      precisionAudit: {
        qwen: { supported: 26, accepted: qwen.accepted, precision: 26 / qwen.accepted },
        terra: { supported: 36, accepted: terra.accepted, precision: 36 / terra.accepted, unsupported: "trillith -> created -> Torch of the Burning Sky" },
      },
      safety: { modelCalls: 0, retries: 0, repairCalls: 0, persistenceWrites: 0, artifactWrites: 0 },
    }, null, 2));
    return;
  }
  const terraMode = terraLive || (preflight && process.env.AI_PROVIDER === "openai");
  if (terraMode || terraAudit) {
    resultRoot = new URL("../artifacts/wotbs-graph-proof-terra/", import.meta.url);
    resultManifest = new URL("manifest.json", resultRoot);
  }
  if (finalizeManualAudit) {
    if (live || terraLive || preflight) throw new Error("Manual-audit finalization cannot be combined with preflight or live mode");
    if (!existsSync(resultManifest)) throw new Error("No graph proof result exists to finalize");
    const saved = JSON.parse(readFileSync(resultManifest, "utf8")) as {
      status: string;
      safety: { localGenerations: number; openAICalls?: number };
      manualAudit: Record<string, unknown>;
      goldEvaluation: {
        eligibleGoldRelationships: number;
        recoveredCount: number;
        recall: number;
        manualSemanticEquivalences?: string[];
        manuallyAdjustedRecoveredCount?: number;
        manuallyAdjustedRecall?: number;
      };
      decision?: string;
    };
    if (saved.status !== "needs_manual_source_audit" || saved.safety?.localGenerations !== (terraAudit ? 0 : 1) || (terraAudit && saved.safety?.openAICalls !== 1)) throw new Error("Saved graph result is not an eligible one-call manual-audit result");
    if (terraAudit) {
      saved.manualAudit = {
        pageByPageAudited: true,
        supportedCount: 35,
        unsupportedCount: 2,
        precision: 35 / 37,
        uniqueGraphNodes: 38,
        distinctRelationshipLabels: 18,
        productCoverage: { rulerCommand: true, politicalFactionRelations: true, locationRelations: true, itemAssociations: true, family: false, questEventLocations: true, directQuestParticipation: false },
        unsupportedRelationships: [
          { source: "trillith", relationship: "created", target: "Torch of the Burning Sky", page: 12, reason: "The cited passage attributes the Torch's creation to the power of a trillith, but does not support this generic trillith identity as creator." },
          { source: "Aquiline Heart", relationship: "contains", target: "Heart of History", page: 12, reason: "The cited passage places the Aquiline Heart within the Heart of History; this edge reverses containment." },
        ],
      };
      saved.goldEvaluation.manuallyAdjustedRecoveredCount = saved.goldEvaluation.recoveredCount;
      saved.goldEvaluation.manuallyAdjustedRecall = saved.goldEvaluation.recall;
    } else {
      saved.manualAudit = {
        pageByPageAudited: true,
        supportedCount: 26,
        unsupportedCount: 0,
        precision: 1,
        uniqueGraphNodes: 32,
        distinctRelationshipLabels: 12,
        productCoverage: { rulerCommand: true, politicalFactionRelations: true, locationRelations: true, itemAssociations: true, family: false, questEventLocations: true, directQuestParticipation: false },
        unsupportedRelationships: [],
      };
      saved.goldEvaluation.manualSemanticEquivalences = ["Torch of the Burning Sky -> used by -> Drakus Coaltongue is the inverse of Drakus Coaltongue wielded/acquired Torch of the Burning Sky"];
      saved.goldEvaluation.manuallyAdjustedRecoveredCount = 7;
      saved.goldEvaluation.manuallyAdjustedRecall = 7 / saved.goldEvaluation.eligibleGoldRelationships;
    }
    saved.status = "complete";
    saved.decision = terraAudit ? "TERRA_V0_STYLE_GRAPH_QUALITY_LOW" : "LOCAL_V0_STYLE_GRAPH_QUALITY_LOW";
    writeFileSync(resultManifest, `${JSON.stringify(saved, null, 2)}\n`);
    console.log(JSON.stringify({ status: saved.status, decision: saved.decision, manualAudit: saved.manualAudit, goldEvaluation: saved.goldEvaluation, modelCalls: 0 }, null, 2));
    return;
  }
  if ([live, terraLive, preflight].filter(Boolean).length !== 1) throw new Error("Choose exactly one of --preflight, --live, or --terra-live");
  const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
  if (fixture.chunks.length !== 1) throw new Error(`Expected one WotBS chunk, found ${fixture.chunks.length}`);
  const chunk = fixture.chunks[0];
  const priorManifest = JSON.parse(readFileSync(new URL("manifest.json", priorArtifactRoot), "utf8")) as { fixture: { pdfSha256: string; normalizedTextSha256: string }; completeness: { finalQuality: { supportedEntityRecall: number; referenceBoundedPrecision: number; questRecall: number; itemRecall: number } } };
  if (priorManifest.fixture.pdfSha256 !== fixture.pdfSha256 || priorManifest.fixture.normalizedTextSha256 !== fixture.normalizedTextSha256) throw new Error("Reusable Pass-A artifact fixture fingerprint mismatch");
  const initialRaw = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("initial-raw.json", priorArtifactRoot), "utf8")));
  const completenessRaw = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("completeness-raw.json", priorArtifactRoot), "utf8")));
  const inventory = validateAndUnionCompleteness(validateExtractionInventory(initialRaw, chunk).inventory, completenessRaw, chunk).finalInventory;
  const gate = priorManifest.completeness.finalQuality;
  if (inventory.entities.length !== 42 || gate.supportedEntityRecall < 0.90 || gate.referenceBoundedPrecision < 0.90 || gate.questRecall !== 1 || gate.itemRecall !== 1) throw new Error("Reusable Pass-A inventory failed frozen gate");

  const input = buildGraphExtractionInput(chunk, inventory);
  const config = resolveAIProviderConfig(process.env, "extraction");
  let environment: { digest: string | null; loadedContext: number | null } = { digest: null, loadedContext: null };
  if (terraMode) {
    if (config.providerId !== "openai" || config.modelId !== "gpt-5.6-terra" || process.env.AI_PROVIDER !== "openai") throw new Error("Frozen OpenAI Terra provider/model configuration mismatch");
  } else {
    if (config.providerId !== "local" || config.modelId !== WOTBS_STAGE1_EXPECTED_MODEL || config.allowPersistence || process.env.AI_PROVIDER !== "local" || process.env.LOCAL_AI_MODEL !== WOTBS_STAGE1_EXPECTED_MODEL || process.env.LOCAL_AI_EXTRACTION_MODEL !== WOTBS_STAGE1_EXPECTED_MODEL || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen local model/provider/concurrency configuration mismatch");
    environment = await runtime(config.baseUrl);
    if (environment.digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen model digest mismatch: ${environment.digest ?? "unavailable"}`);
  }
  const report = {
    fixture: { pdfSha256: fixture.pdfSha256, normalizedTextSha256: fixture.normalizedTextSha256, pages: fixture.pages.map((page) => page.pageNumber), characters: fixture.sourceCharacterCount, chunks: fixture.chunks.length },
    passA: { reused: true, inventoryEntities: inventory.entities.length, inventoryFingerprint: validatedInventoryFingerprint(inventory), quality: gate },
    graphInput: { characters: input.length, bytes: Buffer.byteLength(input), estimatedTokens: Math.ceil(input.length / 4), knownEntityLines: inventory.entities.length },
    graphSchema: { behaviorVersion: GRAPH_EXTRACTION_BEHAVIOR_VERSION, contractVersion: GRAPH_EXTRACTION_CONTRACT_VERSION, strict: true, fields: ["source", "relationship", "target", "page"], maximumRelationships: 120 },
    runtime: { provider: config.providerId, model: config.modelId, digest: environment.digest, context: WOTBS_STAGE1_CONTEXT, loadedContext: environment.loadedContext, temperature: 0, reasoning: "none", concurrency: 1, deadlineMs: DEADLINE_MS },
  };
  if (preflight) {
    console.log(JSON.stringify({ result: "GRAPH_PROOF_READY", ...report, modelCalls: 0, writes: 0 }, null, 2));
    return;
  }
  if (existsSync(resultManifest)) throw new Error("Graph proof result already exists; one-attempt guard refuses another call");
  mkdirSync(resultRoot, { recursive: true });
  const safety = { localGenerations: terraMode ? 0 : 1, openAICalls: terraMode ? 1 : 0, retries: 0, repairCalls: 0, passAGenerations: 0, reconciliationCalls: 0, enrichmentCalls: 0, persistenceWrites: 0, officialCheckpointWrites: 0, goldLeakage: 0 };
  const manifest: Record<string, unknown> = { status: "started", ...report, safety };
  writeFileSync(resultManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  const provider = terraMode
    ? createOpenAIStructuredModelProvider(config.modelId, new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: 0, timeout: DEADLINE_MS }))
    : createLocalStructuredModelProvider(config as Extract<typeof config, { providerId: "local" }>, boundedHttpFetch(DEADLINE_MS));
  const started = performance.now();
  try {
    const response = await provider.parseStructured({ system: GRAPH_EXTRACTION_SYSTEM_PROMPT, payload: input, schema: graphExtractionOutputSchema, schemaName: "graph_extraction_output" });
    const parsed = graphExtractionOutputSchema.parse(response.output);
    manifest.call = { valid: true, ...metrics(response, started, input), proposed: parsed.relationships.length };
    writeFileSync(new URL("raw-output.json", resultRoot), `${JSON.stringify(parsed, null, 2)}\n`);
    const validated = validateGraphExtraction(parsed, inventory, chunk);
    manifest.validation = { accepted: validated.relationships.length, proposed: validated.proposedRelationships, unknownEndpointRejections: validated.unknownEndpointRejections, ambiguousEndpointRejections: validated.ambiguousEndpointRejections, selfEdgeRejections: validated.selfEdgeRejections, duplicateSemanticEdges: validated.duplicateSemanticEdges, diagnostics: validated.diagnostics, retainedRelationships: validated.relationships };

    // Gold is loaded only after the single model call has returned and validated structurally.
    const goldJsonPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot);
    const goldMarkdownPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.md", fixtureRoot);
    const gold = loadWotbsGoldReference(fileURLToPath(goldJsonPath));
    assertGoldReferenceIsolation([GRAPH_EXTRACTION_SYSTEM_PROMPT, input], [{ path: fileURLToPath(goldJsonPath), raw: gold.raw }, { path: fileURLToPath(goldMarkdownPath), raw: readFileSync(goldMarkdownPath, "utf8") }]);
    const present = new Set(inventory.entities.map((entity) => goldName(gold.reference, entity.name)).filter((name): name is string => name !== null));
    const eligible = gold.reference.core_relationships.filter((relationship) => present.has(relationship.source) && present.has(relationship.target));
    const candidateRelationships = validated.relationships.map((relationship, index): CandidateRelationship => ({
      source_temporary_id: relationship.sourceInventoryId,
      target_temporary_id: relationship.targetInventoryId,
      relationship_type: relationship.relationshipType,
      description: relationship.relationship,
      confidence: 1,
      sources: [{ page_number: relationship.page, supporting_text: "Page-level graph proof provenance." }],
      __index: index,
    } as CandidateRelationship));
    const score = scoreWotbsRelationships(candidateRelationships, inventory, gold.reference);
    const recovered = score.recovered.filter((line) => eligible.some((relationship) => line === `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`));
    const matchedGoldKeys = new Set(eligible.filter((relationship) => recovered.includes(`${relationship.source} -> ${relationship.relation} -> ${relationship.target}`)).map((relationship) => {
      const source = inventory.entities.find((entity) => goldName(gold.reference, entity.name) === relationship.source)!;
      const target = inventory.entities.find((entity) => goldName(gold.reference, entity.name) === relationship.target)!;
      return relationshipSemanticKey(normalizeRelationshipFact(source.temporary_id, target.temporary_id, relationship.relation));
    }));
    manifest.goldEvaluation = { eligibleGoldRelationships: eligible.length, recoveredEligibleRelationships: recovered, recoveredCount: recovered.length, recall: eligible.length ? recovered.length / eligible.length : 1, missedEligibleRelationships: eligible.filter((relationship) => !recovered.includes(`${relationship.source} -> ${relationship.relation} -> ${relationship.target}`)).map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`), normalizedMatchedGoldKeys: [...matchedGoldKeys] };
    manifest.manualAudit = { requiresPageByPageHumanAudit: true, retainedRelationships: validated.relationships.map(({ sourceName, relationship, targetName, page }) => ({ source: sourceName, relationship, target: targetName, page })), supportedCount: null, unsupportedCount: null, precision: null };
    manifest.status = "needs_manual_source_audit";
  } catch (error) {
    manifest.status = "model_failed";
    manifest.call = { valid: false, latencyMs: Math.round(performance.now() - started), error: errorSummary(error) };
    manifest.decision = "LOCAL_V0_STYLE_GRAPH_MODEL_FAILED";
  }
  writeFileSync(resultManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
