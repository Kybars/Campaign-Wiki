import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { createLocalStructuredModelProvider, createOpenAIStructuredModelProvider, LocalStructuredModelError, type StructuredModelResult } from "../lib/ai/structured-model-provider";
import { getOpenAIEnv, resolveAIProviderConfig } from "../lib/env";
import { graphExtractionOutputSchema, validateGraphExtraction, type ValidatedGraphRelationship } from "../lib/ai/graph-extraction";
import { buildGraphCompletenessInput, buildGraphCompletenessUnion, GRAPH_COMPLETENESS_BEHAVIOR_VERSION, GRAPH_COMPLETENESS_SYSTEM_PROMPT, validateGraphCompletenessSweep } from "../lib/ai/graph-completeness";
import { extractionInventoryOutputSchema, type CandidateRelationship } from "../lib/ai/schemas";
import { validateAndUnionCompleteness } from "../lib/ai/inventory-completeness";
import { validateExtractionInventory, validatedInventoryFingerprint } from "../lib/ai/source-validation";
import { assertGoldReferenceIsolation, loadWotbsGoldReference, loadWotbsStage1Fixture, scoreWotbsRelationships, WOTBS_STAGE1_CONTEXT, WOTBS_STAGE1_EXPECTED_DIGEST, WOTBS_STAGE1_EXPECTED_MODEL } from "./wotbs-stage1";

loadEnvConfig(process.cwd());

const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const passARoot = new URL("../artifacts/wotbs-stage1-pass-b/", import.meta.url);
const firstPassRoot = new URL("../artifacts/wotbs-graph-proof/", import.meta.url);
const localResultRoot = new URL("../artifacts/wotbs-graph-completeness/", import.meta.url);
const terraResultRoot = new URL("../artifacts/wotbs-graph-completeness-terra/", import.meta.url);
const lunaResultRoot = new URL("../artifacts/wotbs-graph-completeness-luna/", import.meta.url);
const DEADLINE_MS = 300_000;

function boundedHttpFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:") throw new Error("Local graph completeness requires the local HTTP Ollama endpoint");
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(deadline); action(); };
      const request = httpRequest({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body).toString() } : {}) } }, (response) => {
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => parts.push(part));
        response.on("end", () => finish(() => resolve(new Response(Buffer.concat(parts), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers: response.headers as HeadersInit }))));
        response.on("aborted", () => finish(() => reject(new Error("Local graph completeness response aborted before completion"))));
        response.on("error", (error) => finish(() => reject(error)));
      });
      const deadline = setTimeout(() => { const error = new Error(`Graph completeness exceeded ${timeoutMs}ms deadline`); error.name = "GraphCompletenessDeadlineError"; request.destroy(error); }, timeoutMs);
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

function candidateRelationships(relationships: ValidatedGraphRelationship[]): CandidateRelationship[] {
  return relationships.map((relationship, index) => ({
    source_temporary_id: relationship.sourceInventoryId,
    target_temporary_id: relationship.targetInventoryId,
    relationship_type: relationship.relationshipType,
    description: relationship.relationshipType,
    confidence: 1,
    sources: [{ page_number: relationship.page, supporting_text: "Page-level graph proof provenance." }],
    __index: index,
  } as CandidateRelationship));
}

async function main() {
  const terraMode = process.argv.includes("--terra") || process.argv.includes("--terra-preflight") || process.argv.includes("--terra-live");
  const lunaMode = process.argv.includes("--luna") || process.argv.includes("--luna-preflight") || process.argv.includes("--luna-live");
  if (terraMode && lunaMode) throw new Error("Choose at most one OpenAI comparison model");
  const resultRoot = terraMode ? terraResultRoot : lunaMode ? lunaResultRoot : localResultRoot;
  const resultManifest = new URL("manifest.json", resultRoot);
  const preflight = process.argv.includes("--preflight") || process.argv.includes("--terra-preflight") || process.argv.includes("--luna-preflight");
  const live = process.argv.includes("--live") || process.argv.includes("--terra-live") || process.argv.includes("--luna-live");
  const auditArgument = process.argv.find((argument) => argument.startsWith("--finalize-manual-audit="));
  if (auditArgument) {
    if (preflight || live) throw new Error("Manual-audit finalization cannot be combined with preflight or live mode");
    if (!existsSync(resultManifest)) throw new Error("No graph completeness result exists to finalize");
    const classifications = auditArgument.slice("--finalize-manual-audit=".length).split(",");
    if (!classifications.length || classifications.some((classification) => !["SUPPORTED", "UNSUPPORTED", "AMBIGUOUS"].includes(classification))) throw new Error("Manual audit classifications must be SUPPORTED, UNSUPPORTED, or AMBIGUOUS");
    const saved = JSON.parse(readFileSync(resultManifest, "utf8")) as {
      status: string;
      safety: { localGenerations: number; openAICalls: number; retries: number; repairCalls: number; persistenceWrites: number };
      validation: { novelAcceptedRelationships: unknown[] };
      goldEvaluation: { finalRecall: number };
      manualAudit?: { required: boolean; classifications?: string[]; supported?: number; unsupported?: number; ambiguous?: number; precision?: number };
      decision?: string;
    };
    const expectedGenerations = terraMode || lunaMode ? { local: 0, openAI: 1 } : { local: 1, openAI: 0 };
    if (saved.status !== "needs_manual_source_audit" || saved.safety.localGenerations !== expectedGenerations.local || saved.safety.openAICalls !== expectedGenerations.openAI || saved.safety.retries !== 0 || saved.safety.repairCalls !== 0 || saved.safety.persistenceWrites !== 0) throw new Error("Saved graph completeness result is not eligible for manual-audit finalization");
    if (classifications.length !== saved.validation.novelAcceptedRelationships.length) throw new Error("Manual audit classification count does not match novel accepted edges");
    const supported = classifications.filter((classification) => classification === "SUPPORTED").length;
    const unsupported = classifications.filter((classification) => classification === "UNSUPPORTED").length;
    const ambiguous = classifications.filter((classification) => classification === "AMBIGUOUS").length;
    const manualAudit = { required: false, classifications, supported, unsupported, ambiguous, precision: saved.validation.novelAcceptedRelationships.length ? supported / saved.validation.novelAcceptedRelationships.length : 1 };
    saved.manualAudit = manualAudit;
    saved.status = "complete";
    saved.decision = supported >= 2 && manualAudit.precision >= 0.90 && saved.goldEvaluation.finalRecall >= 0.75
      ? terraMode ? "TERRA_GRAPH_COMPLETENESS_VALIDATED" : lunaMode ? "LUNA_GRAPH_COMPLETENESS_VALIDATED" : "LOCAL_GRAPH_COMPLETENESS_VALIDATED"
      : terraMode ? "TERRA_GRAPH_COMPLETENESS_LOW_VALUE" : lunaMode ? "LUNA_GRAPH_COMPLETENESS_LOW_VALUE" : "LOCAL_GRAPH_COMPLETENESS_LOW_VALUE";
    writeFileSync(resultManifest, `${JSON.stringify(saved, null, 2)}\n`);
    console.log(JSON.stringify({ status: saved.status, decision: saved.decision, manualAudit: saved.manualAudit, modelCalls: 0 }, null, 2));
    return;
  }
  if ([preflight, live].filter(Boolean).length !== 1) throw new Error("Choose exactly one of --preflight or --live");
  const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
  if (fixture.chunks.length !== 1) throw new Error(`Expected one WotBS chunk, found ${fixture.chunks.length}`);
  const chunk = fixture.chunks[0];
  const initialRaw = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("initial-raw.json", passARoot), "utf8")));
  const completenessRaw = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("completeness-raw.json", passARoot), "utf8")));
  const inventory = validateAndUnionCompleteness(validateExtractionInventory(initialRaw, chunk).inventory, completenessRaw, chunk).finalInventory;
  const inventoryFingerprint = validatedInventoryFingerprint(inventory);
  if (inventory.entities.length !== 42 || inventoryFingerprint !== "c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081") throw new Error("Frozen final inventory changed");
  const firstRaw = graphExtractionOutputSchema.parse(JSON.parse(readFileSync(new URL("raw-output.json", firstPassRoot), "utf8")));
  const firstPass = validateGraphExtraction(firstRaw, inventory, chunk);
  if (firstPass.relationships.length !== 26) throw new Error(`Frozen Qwen first-pass edge count changed: ${firstPass.relationships.length}`);
  const firstPassKeys = new Set(firstPass.relationships.map((relationship) => relationship.semanticKey));
  const input = buildGraphCompletenessInput(chunk, inventory, firstPass.relationships);
  assertGoldReferenceIsolation([GRAPH_COMPLETENESS_SYSTEM_PROMPT, input], []);
  const config = resolveAIProviderConfig(process.env, "extraction");
  let environment: { digest: string | null; loadedContext: number | null } = { digest: null, loadedContext: null };
  if (terraMode || lunaMode) {
    const expectedModel = terraMode ? "gpt-5.6-terra" : "gpt-5.6-luna";
    if (config.providerId !== "openai" || config.modelId !== expectedModel || process.env.AI_PROVIDER !== "openai") throw new Error(`Frozen OpenAI ${terraMode ? "Terra" : "Luna"} provider/model configuration mismatch`);
  } else {
    if (config.providerId !== "local" || config.modelId !== WOTBS_STAGE1_EXPECTED_MODEL || config.allowPersistence || process.env.AI_PROVIDER !== "local" || process.env.LOCAL_AI_MODEL !== WOTBS_STAGE1_EXPECTED_MODEL || process.env.LOCAL_AI_EXTRACTION_MODEL !== WOTBS_STAGE1_EXPECTED_MODEL || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen local provider/model/concurrency configuration mismatch");
    environment = await runtime(config.baseUrl);
    if (environment.digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen model digest mismatch: ${environment.digest ?? "unavailable"}`);
  }
  const report = {
    fixture: { pdfSha256: fixture.pdfSha256, normalizedTextSha256: fixture.normalizedTextSha256, pages: fixture.pages.map((page) => page.pageNumber) },
    inventory: { entities: inventory.entities.length, fingerprint: inventoryFingerprint },
    firstPass: { accepted: firstPass.relationships.length, semanticKeys: firstPassKeys.size },
    completeness: { behaviorVersion: GRAPH_COMPLETENESS_BEHAVIOR_VERSION, schema: "graph_extraction_output", inputCharacters: input.length, inputBytes: Buffer.byteLength(input), estimatedInputTokens: Math.ceil(input.length / 4), existingRelationshipLines: firstPass.relationships.length },
    runtime: { provider: config.providerId, model: config.modelId, digest: environment.digest, context: WOTBS_STAGE1_CONTEXT, loadedContext: environment.loadedContext, temperature: 0, reasoning: "none", concurrency: 1, deadlineMs: DEADLINE_MS },
  };
  if (preflight) {
    console.log(JSON.stringify({ result: terraMode ? "TERRA_GRAPH_COMPLETENESS_READY" : lunaMode ? "LUNA_GRAPH_COMPLETENESS_READY" : "GRAPH_COMPLETENESS_READY", ...report, safety: { localGenerations: 0, openAICalls: 0, retries: 0, repairCalls: 0, persistenceWrites: 0, goldLeakage: 0 } }, null, 2));
    return;
  }
  if (existsSync(resultManifest)) throw new Error("Graph completeness result already exists; one-attempt guard refuses another call");
  mkdirSync(resultRoot, { recursive: true });
  const manifest: Record<string, unknown> = { status: "started", ...report, safety: { localGenerations: terraMode || lunaMode ? 0 : 1, openAICalls: terraMode || lunaMode ? 1 : 0, retries: 0, repairCalls: 0, passAGenerations: 0, firstPassGraphGenerations: 0, reconciliationCalls: 0, enrichmentCalls: 0, persistenceWrites: 0, officialCheckpointWrites: 0, goldLeakage: 0 } };
  writeFileSync(resultManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  const provider = config.providerId === "openai"
    ? createOpenAIStructuredModelProvider(config.modelId, new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: 0, timeout: DEADLINE_MS }))
    : createLocalStructuredModelProvider(config, boundedHttpFetch(DEADLINE_MS));
  const started = performance.now();
  try {
    const response = await provider.parseStructured({ system: GRAPH_COMPLETENESS_SYSTEM_PROMPT, payload: input, schema: graphExtractionOutputSchema, schemaName: "graph_extraction_output" });
    const raw = graphExtractionOutputSchema.parse(response.output);
    manifest.call = { valid: true, ...metrics(response, started, input), proposed: raw.relationships.length };
    writeFileSync(new URL("raw-output.json", resultRoot), `${JSON.stringify(raw, null, 2)}\n`);
    const sweep = validateGraphCompletenessSweep(raw, inventory, chunk, firstPassKeys);
    const union = buildGraphCompletenessUnion(firstPass.relationships, sweep.novelRelationships);
    // Gold is intentionally loaded only after the model call, validation, and union construction.
    const goldPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot);
    const gold = loadWotbsGoldReference(fileURLToPath(goldPath));
    assertGoldReferenceIsolation([GRAPH_COMPLETENESS_SYSTEM_PROMPT, input], [{ path: fileURLToPath(goldPath), raw: gold.raw }]);
    const present = new Set(inventory.entities.map((entity) => entity.name));
    const eligible = gold.reference.core_relationships.filter((relationship) => present.has(relationship.source) && present.has(relationship.target));
    const firstScore = scoreWotbsRelationships(candidateRelationships(firstPass.relationships), inventory, gold.reference);
    const unionScore = scoreWotbsRelationships(candidateRelationships(union), inventory, gold.reference);
    const eligibleKeys = eligible.map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`);
    const firstRecovered = firstScore.recovered.filter((relationship) => eligibleKeys.includes(relationship));
    const finalRecovered = unionScore.recovered.filter((relationship) => eligibleKeys.includes(relationship));
    const novelCounts = Object.fromEntries(["NOVEL_ACCEPTED", "DUPLICATE_OF_FIRST_PASS", "DUPLICATE_WITHIN_SWEEP", "REJECTED_UNKNOWN_ENDPOINT", "REJECTED_AMBIGUOUS_ENDPOINT", "REJECTED_SELF_EDGE", "REJECTED_INVALID_PAGE"].map((classification) => [classification, sweep.classifications.filter((item) => item.classification === classification).length]));
    const touched = new Set(union.flatMap((relationship) => [relationship.sourceInventoryId, relationship.targetInventoryId]));
    manifest.validation = { proposed: raw.relationships.length, accepted: sweep.validation.relationships.length, unknownEndpointRejections: sweep.validation.unknownEndpointRejections, ambiguousEndpointRejections: sweep.validation.ambiguousEndpointRejections, selfEdgeRejections: sweep.validation.selfEdgeRejections, invalidPageRejections: sweep.validation.diagnostics.filter((diagnostic) => diagnostic.reason.includes("page")).length, duplicateWithinSweep: sweep.validation.duplicateSemanticEdges, classifications: sweep.classifications, counts: novelCounts, novelAcceptedRelationships: sweep.novelRelationships };
    manifest.union = { edges: union.length, entitiesTouched: touched.size, isolatedEntities: inventory.entities.length - touched.size, relationshipLabelVariety: new Set(union.map((relationship) => relationship.relationshipType)).size, preservedFirstPassEdges: firstPass.relationships.length, deduped: true };
    manifest.goldEvaluation = { eligibleGoldRelationships: eligible.length, firstPassRecovered: firstRecovered, firstPassRecoveredCount: firstRecovered.length, finalUnionRecovered: finalRecovered, finalUnionRecoveredCount: finalRecovered.length, newGoldRecoveredBySweep: finalRecovered.filter((relationship) => !firstRecovered.includes(relationship)), finalRecall: eligible.length ? finalRecovered.length / eligible.length : 1 };
    manifest.manualAudit = { required: true, novelAcceptedRelationships: sweep.novelRelationships.map(({ sourceName, relationshipType, targetName, page }) => ({ source: sourceName, relationship: relationshipType, target: targetName, page })) };
    manifest.status = "needs_manual_source_audit";
  } catch (error) {
    manifest.status = "model_failed";
    manifest.call = { valid: false, latencyMs: Math.round(performance.now() - started), error: errorSummary(error) };
    manifest.decision = terraMode ? "TERRA_GRAPH_COMPLETENESS_MODEL_FAILED" : lunaMode ? "LUNA_GRAPH_COMPLETENESS_MODEL_FAILED" : "LOCAL_GRAPH_COMPLETENESS_MODEL_FAILED";
  }
  writeFileSync(resultManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
