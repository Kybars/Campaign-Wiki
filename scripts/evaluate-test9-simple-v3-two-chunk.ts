/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/extraction-context";
import { auditSimpleGraphV3Coverage, runSimpleGraphV3, simpleGraphV3CheckpointIdentity, simpleGraphV3TokenDiagnostics, SIMPLE_GRAPH_V3_SYSTEM_PROMPT, type ValidSimpleGraphV3Relationship } from "../lib/ai/simple-graph-v3";
import { planTest9TwoChunkSimpleGraphV3, validateAndUnionTwoChunkSimpleGraphV3 } from "../lib/ai/simple-graph-v3-two-chunk";
import { normalizeName } from "../lib/graph/normalize";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";
import { classifyRelationshipScoringMatch, type RelationshipScoringMatch } from "./wotbs-stage1";

loadEnvConfig(process.cwd());
const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const artifactPath = join(directory, "simple-v3-two-chunk-hardened-preflight.json");
const progressPath = join(directory, "simple-v3-two-chunk-hardened-progress.json");
const resultPath = join(directory, "simple-v3-two-chunk-hardened-result.json");
const previousPrompt = `Extract high-recall, explicit campaign relationships among the supplied known entities.
Inspect the entire source. Use only supplied endpoint names or their unambiguous source aliases and only source-supported relationships.
Preserve direction and use concise natural relationship labels. Cite the supporting page and source segment ID.
Omit weak narrative associations, co-occurrence, guesses, and outside lore.
Return only the fixed relationship schema; no quotes, facts, summaries, confidence, new entities, or prose.`;
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const frozenGold = JSON.parse(readFileSync(join(directory, "next-experiment-gold.json"), "utf8")) as any;
const futureGold = JSON.parse(readFileSync(join(directory, "future-evaluation-gold.json"), "utf8")) as any;
const primaryResult = JSON.parse(readFileSync(join(directory, "simple-v3-result.json"), "utf8")) as any;
const targetedProgress = JSON.parse(readFileSync(join(directory, "simple-v3-completeness-retry-progress.json"), "utf8")) as any;
const blanketResult = JSON.parse(readFileSync(join(directory, "simple-v3-blanket-result.json"), "utf8")) as any;
const spanResult = JSON.parse(readFileSync(join(directory, "span-v2-result.json"), "utf8")) as any;
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
if (fixture.fixture_hash !== frozenGold.fixture_hash || fixture.fixture_hash !== futureGold.fixture_hash
  || sha256(frozenGold.relationships) !== frozenGold.reference_hash || sha256(futureGold.relationships) !== futureGold.reference_hash) {
  throw new Error("Test 9 fixture/gold hash mismatch");
}

const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const context = buildExtractionContext(cleanDocumentPagesForModel(fixture.pages).pages, inventory);
const requests = planTest9TwoChunkSimpleGraphV3(context);
const contextFingerprint = extractionContextFingerprint(context);
const idByName = new Map<string, string>();
for (const entity of inventory.entities) for (const name of [entity.name, ...(entity.aliases ?? [])]) idByName.set(normalizeName(name), entity.temporary_id);

const outputAllowancePerCall = 3_500;
const chunks = requests.map((request) => {
  const diagnostics = simpleGraphV3TokenDiagnostics(request);
  return {
    requestId: request.requestId,
    pages: [...new Set(request.sourceSegments.map((segment) => segment.page))],
    segmentIds: request.sourceSegments.map((segment) => segment.segmentId),
    semanticCharacters: request.sourceSegments.reduce((sum, segment) => sum + segment.semanticText.length, 0),
    relevantEntities: request.entities.length,
    characters: diagnostics.characters,
    estimatedTokens: diagnostics.estimatedTokens,
    checkpointIdentity: simpleGraphV3CheckpointIdentity({ campaignId: "test9-fixture", documentId: fixture.fixture_hash, sourceExtractionCacheId: null, providerId: "openai", modelId: "gpt-5.6-luna", request, contextFingerprint }),
  };
});
const estimatedInputTokens = chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens.totalInput, 0);
const estimatedTotalTokens = estimatedInputTokens + requests.length * outputAllowancePerCall;
const previousPromptTokensPerCall = Math.ceil(previousPrompt.length / 4);
const hardenedPromptTokensPerCall = Math.ceil(SIMPLE_GRAPH_V3_SYSTEM_PROMPT.length / 4);

function structuralEvaluation(gold: any) {
  const rows = gold.relationships.map((reference: any) => {
    const sourceId = idByName.get(normalizeName(reference.source));
    const targetId = idByName.get(normalizeName(reference.target));
    const sourceChunks = requests.flatMap((request, index) => request.entities.some((entity) => entity.canonicalId === sourceId) ? [index + 1] : []);
    const targetChunks = requests.flatMap((request, index) => request.entities.some((entity) => entity.canonicalId === targetId) ? [index + 1] : []);
    const evidenceChunks = requests.flatMap((request, index) => request.sourceSegments.some((segment) => reference.pages.includes(segment.page)) ? [index + 1] : []);
    const eligibleChunks = evidenceChunks.filter((index) => sourceChunks.includes(index) && targetChunks.includes(index));
    return { source: reference.source, relationship: reference.relationship, target: reference.target, pages: reference.pages, sourceChunks, targetChunks, evidenceChunks, eligibleChunks };
  });
  return {
    goldCount: rows.length,
    chunk1Eligible: rows.filter((row: any) => row.eligibleChunks.includes(1)).length,
    chunk2Eligible: rows.filter((row: any) => row.eligibleChunks.includes(2)).length,
    unionEligible: rows.filter((row: any) => row.eligibleChunks.length).length,
    boundarySpanning: rows.filter((row: any) => !row.eligibleChunks.length && row.sourceChunks.length && row.targetChunks.length && row.evidenceChunks.length),
    unavailable: rows.filter((row: any) => !row.eligibleChunks.length),
    rows,
  };
}
const frozenStructure = structuralEvaluation(frozenGold);
const futureStructure = structuralEvaluation(futureGold);
const anchorPairs = [["Ragesian Imperial Navy", "Turinn"], ["Turinn", "Sindaire"], ["Ostalin", "Turinn"]];
const anchors = anchorPairs.map(([source, target]) => {
  const row = frozenStructure.rows.find((item: any) => item.source === source && item.target === target);
  if (!row) throw new Error(`Missing frozen Turinn anchor ${source} -> ${target}`);
  return row;
});

const comparisons = {
  singleV3Actual: primaryResult.simpleV3.totalTokens,
  targetedPipelineActual: primaryResult.simpleV3.totalTokens + targetedProgress.completed.reduce((sum: number, item: any) => sum + item.usage.totalTokens, 0),
  blanketPipelineActual: primaryResult.simpleV3.totalTokens + blanketResult.usage.totalTokens,
  spanV2Actual: spanResult.candidate.totalTokens,
};
const preflight = {
  safety: { modelCalls: 0, paidCalls: 0, productionWiring: false },
  fixtureHash: fixture.fixture_hash, frozenGoldHash: frozenGold.reference_hash, futureGoldHash: futureGold.reference_hash,
  chunkDefinitions: [[10, 11, 12], [13, 14]], chunks,
  promptChange: { previousPrompt, hardenedPrompt: SIMPLE_GRAPH_V3_SYSTEM_PROMPT, previousPromptTokensPerCall, hardenedPromptTokensPerCall, increasePerCall: hardenedPromptTokensPerCall - previousPromptTokensPerCall, schemaChanged: false },
  totals: { plannedCalls: 2, estimatedInputTokens, expectedOutputAllowancePerCall: outputAllowancePerCall, estimatedTotalTokens },
  comparisons,
  structural: {
    frozen89: { goldCount: frozenStructure.goldCount, chunk1Eligible: frozenStructure.chunk1Eligible, chunk2Eligible: frozenStructure.chunk2Eligible, unionEligible: frozenStructure.unionEligible, boundarySpanning: frozenStructure.boundarySpanning, unavailable: frozenStructure.unavailable },
    future126: { goldCount: futureStructure.goldCount, chunk1Eligible: futureStructure.chunk1Eligible, chunk2Eligible: futureStructure.chunk2Eligible, unionEligible: futureStructure.unionEligible, boundarySpanning: futureStructure.boundarySpanning, unavailable: futureStructure.unavailable },
    turinnAnchors: anchors,
  },
};

function score(edges: ValidSimpleGraphV3Relationship[], gold: any) {
  const matchCounts: Record<RelationshipScoringMatch, number> = { EXACT_MATCH: 0, NORMALIZED_MATCH: 0, BOUNDED_SEMANTIC_MATCH: 0, NO_MATCH: 0 };
  let recovered = 0;
  for (const reference of gold.relationships) {
    const sourceId = idByName.get(normalizeName(reference.source));
    const targetId = idByName.get(normalizeName(reference.target));
    if (!sourceId || !targetId) continue;
    const matches = edges.flatMap((edge) => edge.provenance.some((item) => reference.pages.includes(item.page))
      ? [classifyRelationshipScoringMatch(
        { sourceId: edge.sourceCanonicalId, targetId: edge.targetCanonicalId, relationshipType: edge.relationshipType },
        { sourceId, targetId, relationshipType: reference.relationship },
      )] : []).filter((value) => value !== "NO_MATCH");
    if (!matches.length) continue;
    recovered += 1;
    const classification = matches.includes("EXACT_MATCH") ? "EXACT_MATCH" : matches.includes("NORMALIZED_MATCH") ? "NORMALIZED_MATCH" : "BOUNDED_SEMANTIC_MATCH";
    matchCounts[classification] += 1;
  }
  return { goldCount: gold.relationships.length, recovered, recall: recovered / gold.relationships.length, matchCounts };
}

async function main() {
  const live = process.argv.includes("--live-luna");
  const validateSaved = process.argv.includes("--validate-saved");
  if (estimatedTotalTokens > 14_500) throw new Error(`Hardened two-chunk token gate exceeded: ${estimatedTotalTokens}`);
  if (!live && !validateSaved) {
    writeFileSync(artifactPath, `${JSON.stringify(preflight, null, 2)}\n`);
    console.log(JSON.stringify({ artifactPath, preflight }, null, 2));
    return;
  }
  if (live && validateSaved) throw new Error("Choose one mode");
  if (live && process.env.ALLOW_PAID_SIMPLE_V3_TWO_CHUNK_LUNA !== "1") throw new Error("Explicit two-chunk Luna authorization required");
  const progress: { fixtureHash: string; completed: Array<{ requestId: string; output: any; usage: any }> } = existsSync(progressPath)
    ? JSON.parse(readFileSync(progressPath, "utf8")) : { fixtureHash: fixture.fixture_hash, completed: [] };
  if (progress.fixtureHash !== fixture.fixture_hash) throw new Error("Saved two-chunk progress belongs to another fixture");
  if (live) {
    const { getStructuredModelProvider } = await import("../lib/ai/structured-model-provider-runtime");
    const provider = getStructuredModelProvider("graph_extraction");
    if (provider.providerId !== "openai" || provider.modelId !== "gpt-5.6-luna") throw new Error(`Expected openai:gpt-5.6-luna, got ${provider.providerId}:${provider.modelId}`);
    for (const request of requests) {
      if (progress.completed.some((item) => item.requestId === request.requestId)) continue;
      const response = await runSimpleGraphV3(request, provider);
      progress.completed.push({ requestId: request.requestId, output: response.output, usage: response.usage });
      writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
    }
  }
  if (progress.completed.length !== 2) throw new Error("Two validated V3 primary outputs are required for scoring");
  const validation = validateAndUnionTwoChunkSimpleGraphV3(progress.completed, requests);
  const result = {
    preflight, actualUsage: progress.completed.map((item) => ({ requestId: item.requestId, usage: item.usage })),
    validation: { proposed: validation.proposed, accepted: validation.relationships.length, duplicateRelationships: validation.duplicateRelationships, unknownEndpointRejections: validation.unknownEndpointRejections, ambiguousEndpointRejections: validation.ambiguousEndpointRejections, selfEdgeRejections: validation.selfEdgeRejections, invalidSegmentRejections: validation.invalidSegmentRejections, invalidPageSegmentRejections: validation.invalidPageSegmentRejections },
    scores: { frozen89: score(validation.relationships, frozenGold), future126: score(validation.relationships, futureGold) },
    coverage: auditSimpleGraphV3Coverage(requests, validation.relationships),
    auditRows: validation.relationships.map((edge) => ({ source: edge.sourceName, relationship: edge.relationship, target: edge.targetName, provenance: edge.provenance })),
    manualSourceAuditRequired: true,
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
