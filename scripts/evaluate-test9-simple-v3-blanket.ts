/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/extraction-context";
import {
  planSimpleGraphV3BlanketRequest, runSimpleGraphV3Blanket, serializeSimpleGraphV3BlanketRequest,
  simpleGraphV3BlanketCheckpointIdentity, simpleGraphV3BlanketTokenDiagnostics, validateSimpleGraphV3Blanket,
} from "../lib/ai/simple-graph-v3-blanket-completeness";
import { planSimpleGraphV3Requests, validateSimpleGraphV3, type ValidSimpleGraphV3Relationship } from "../lib/ai/simple-graph-v3";
import { normalizeName } from "../lib/graph/normalize";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";
import { classifyRelationshipScoringMatch } from "./wotbs-stage1";

const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const frozenGold = JSON.parse(readFileSync(join(directory, "next-experiment-gold.json"), "utf8")) as any;
const futureGold = JSON.parse(readFileSync(join(directory, "future-evaluation-gold.json"), "utf8")) as any;
const firstPassProgress = JSON.parse(readFileSync(join(directory, "simple-v3-progress.json"), "utf8")) as any;
const firstPassResult = JSON.parse(readFileSync(join(directory, "simple-v3-result.json"), "utf8")) as any;
const targetedPreflight = JSON.parse(readFileSync(join(directory, "simple-v3-completeness-preflight.json"), "utf8")) as any;
const audit = JSON.parse(readFileSync(join(directory, "simple-v3-nongold-audit.json"), "utf8")) as any;
const artifactPath = join(directory, "simple-v3-blanket-preflight.json");
const progressPath = join(directory, "simple-v3-blanket-progress.json");
const resultPath = join(directory, "simple-v3-blanket-result.json");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

if (fixture.fixture_hash !== frozenGold.fixture_hash || fixture.fixture_hash !== futureGold.fixture_hash
  || hash(frozenGold.relationships) !== frozenGold.reference_hash || hash(futureGold.relationships) !== futureGold.reference_hash) {
  throw new Error("Frozen Test 9 fixture/gold mismatch");
}
const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const context = buildExtractionContext(cleanDocumentPagesForModel(fixture.pages).pages, inventory);
const primary = planSimpleGraphV3Requests(context);
if (primary.length !== 1 || firstPassProgress.completed.length !== 1 || firstPassProgress.completed[0].requestId !== primary[0].requestId) {
  throw new Error("Blanket Test 9 expects exactly one saved full-source V3 first pass");
}
const firstPass = validateSimpleGraphV3(firstPassProgress.completed[0].output, primary[0]).relationships;
const entityIdsByName = new Map<string, string>();
for (const entity of inventory.entities) for (const name of [entity.name, ...(entity.aliases ?? [])]) entityIdsByName.set(normalizeName(name), entity.temporary_id);

function matches(relationship: ValidSimpleGraphV3Relationship, reference: any) {
  const sourceId = entityIdsByName.get(normalizeName(reference.source));
  const targetId = entityIdsByName.get(normalizeName(reference.target));
  return Boolean(sourceId && targetId && relationship.provenance.some((item) => reference.pages.includes(item.page))
    && classifyRelationshipScoringMatch(
      { sourceId: relationship.sourceCanonicalId, targetId: relationship.targetCanonicalId, relationshipType: relationship.relationshipType },
      { sourceId: sourceId!, targetId: targetId!, relationshipType: reference.relationship },
    ) !== "NO_MATCH");
}

// The frozen manual audit defines which saved first-pass edges are source-accepted.
// Gold is used only to recognize previously accepted first-pass edges, never to form candidates.
const decisions = new Map<string, any>(audit.decisions.map((decision: any) => [decision.key, decision]));
const accepted = firstPass.filter((edge) => frozenGold.relationships.some((reference: any) => matches(edge, reference))
  || decisions.get(`${edge.sourceName}|${edge.relationship}|${edge.targetName}|${edge.provenance[0].segmentId}`)?.classification === "VALID_USEFUL");
const request = planSimpleGraphV3BlanketRequest(context, primary[0], accepted);
const serialized = serializeSimpleGraphV3BlanketRequest(request);
const diagnostics = simpleGraphV3BlanketTokenDiagnostics(request);
const estimatedCompletenessTotal = diagnostics.estimatedTokens.totalInput + diagnostics.estimatedTokens.expectedOutputAllowance;
const estimatedCombinedTotal = firstPassResult.simpleV3.totalTokens + estimatedCompletenessTotal;
const anchorPairs = [
  ["Ragesian Imperial Navy", "Turinn"], ["Ostalin", "Turinn"], ["Turinn", "Sindaire"],
];
const anchorReferences = anchorPairs.map(([source, target]) => {
  const reference = frozenGold.relationships.find((item: any) => item.source === source && item.target === target);
  if (!reference) throw new Error(`Missing frozen Turinn anchor: ${source} -> ${target}`);
  return reference;
});

function score(relationships: ValidSimpleGraphV3Relationship[], gold: any) {
  const recovered = gold.relationships.filter((reference: any) => relationships.some((edge) => matches(edge, reference)));
  return { goldCount: gold.relationships.length, recovered: recovered.length, recall: recovered.length / gold.relationships.length };
}

const preflight = {
  safety: { modelCalls: 0, paidCalls: 0, productionWiring: false },
  fixtureHash: fixture.fixture_hash,
  frozenGoldHash: frozenGold.reference_hash,
  futureGoldHash: futureGold.reference_hash,
  requestId: request.requestId,
  sourceSegmentIds: request.sourceSegments.map((segment) => segment.segmentId),
  entityCount: request.entities.length,
  acceptedFirstPassRelationships: request.existingRelationships.length,
  serializedPayloadSha256: hash(serialized.payload),
  checkpointIdentity: simpleGraphV3BlanketCheckpointIdentity({ campaignId: "test9-fixture", documentId: fixture.fixture_hash, sourceExtractionCacheId: null, providerId: "openai", modelId: "gpt-5.6-luna", request, contextFingerprint: extractionContextFingerprint(context) }),
  characters: diagnostics.characters,
  estimatedTokens: { ...diagnostics.estimatedTokens, completenessTotal: estimatedCompletenessTotal, savedPrimaryActualTotal: firstPassResult.simpleV3.totalTokens, combinedTotal: estimatedCombinedTotal },
  plannedCalls: 1,
  baseline: { frozen89: score(firstPass, frozenGold), future126: score(firstPass, futureGold) },
  anchorPairs,
  targetedComparison: { selectedSegments: targetedPreflight.completeness.evidenceSegmentCount, fullSourceSegments: request.sourceSegments.length, targetedEstimatedCombinedTokens: targetedPreflight.completeness.estimatedCombinedTokens, targetMarkers: false },
};

async function main() {
if (!process.argv.includes("--live-luna")) {
  writeFileSync(artifactPath, `${JSON.stringify(preflight, null, 2)}\n`);
  console.log(JSON.stringify({ artifactPath, preflight }, null, 2));
} else {
  if (estimatedCombinedTotal > 25_000) throw new Error(`Token gate exceeded: ${estimatedCombinedTotal}`);
  if (process.env.ALLOW_PAID_SIMPLE_V3_BLANKET_LUNA !== "1") throw new Error("Explicit blanket Luna authorization required");
  if (existsSync(progressPath) || existsSync(resultPath)) throw new Error("Saved blanket result exists; refusing another call");
  const { getStructuredModelProvider } = await import("../lib/ai/structured-model-provider-runtime");
  const provider = getStructuredModelProvider("graph_extraction");
  if (provider.providerId !== "openai" || provider.modelId !== "gpt-5.6-luna") throw new Error(`Expected openai:gpt-5.6-luna, got ${provider.providerId}:${provider.modelId}`);
  const response = await runSimpleGraphV3Blanket(request, provider);
  const validation = validateSimpleGraphV3Blanket(response.output, request);
  writeFileSync(progressPath, `${JSON.stringify({ fixtureHash: fixture.fixture_hash, requestId: request.requestId, output: response.output, usage: response.usage, validation }, null, 2)}\n`);
  const union = new Map(firstPass.map((edge) => [edge.semanticKey, edge]));
  for (const edge of validation.relationships) if (!union.has(edge.semanticKey)) union.set(edge.semanticKey, edge);
  const rows = [...union.values()];
  const result = {
    preflight, usage: response.usage,
    validation: { proposed: validation.proposed, acceptedNovel: validation.relationships.length, existingRelationshipRejections: validation.existingRelationshipRejections, invalidSegmentRejections: validation.invalidSegmentRejections, invalidPageSegmentRejections: validation.invalidPageSegmentRejections, unknownEndpointRejections: validation.unknownEndpointRejections, ambiguousEndpointRejections: validation.ambiguousEndpointRejections, duplicateRelationships: validation.duplicateRelationships },
    scores: { frozen89: score(rows, frozenGold), future126: score(rows, futureGold) },
    anchors: anchorReferences.map((reference: any) => ({ source: reference.source, relationship: reference.relationship, target: reference.target, recovered: rows.some((edge) => matches(edge, reference)) })),
    auditRows: validation.relationships.map((edge) => ({ source: edge.sourceName, relationship: edge.relationship, target: edge.targetName, provenance: edge.provenance })),
    manualSourceAuditRequired: true,
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
