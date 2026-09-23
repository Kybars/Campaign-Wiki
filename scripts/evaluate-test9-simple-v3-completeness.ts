/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext } from "../lib/ai/extraction-context";
import {
  planSimpleGraphV3Completeness,
  runSimpleGraphV3Completeness,
  simpleGraphV3CompletenessTokenDiagnostics,
  validateSimpleGraphV3Completeness,
} from "../lib/ai/simple-graph-v3-completeness";
import { planSimpleGraphV3Requests, validateSimpleGraphV3, type ValidSimpleGraphV3Relationship } from "../lib/ai/simple-graph-v3";
import { boundedEntityContextInSemanticText } from "../lib/graph/occurrence-index";
import { normalizeName } from "../lib/graph/normalize";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";
import { classifyRelationshipScoringMatch } from "./wotbs-stage1";

const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const auditPath = join(directory, "simple-v3-nongold-audit.json");
const futureGoldPath = join(directory, "future-evaluation-gold.json");
const resultPath = join(directory, "simple-v3-completeness-retry-preflight.json");
const progressPath = join(directory, "simple-v3-completeness-retry-progress.json");
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const frozenGold = JSON.parse(readFileSync(join(directory, "next-experiment-gold.json"), "utf8")) as any;
const firstPassProgress = JSON.parse(readFileSync(join(directory, "simple-v3-progress.json"), "utf8")) as any;
const firstPassResult = JSON.parse(readFileSync(join(directory, "simple-v3-result.json"), "utf8")) as any;
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

if (fixture.fixture_hash !== frozenGold.fixture_hash || sha256(frozenGold.relationships) !== frozenGold.reference_hash) {
  throw new Error("Frozen Test 9 fixture/gold mismatch");
}

const inventory: GraphInventory = {
  entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })),
};
const pages = cleanDocumentPagesForModel(fixture.pages).pages;
const context = buildExtractionContext(pages, inventory);
const firstPassRequest = planSimpleGraphV3Requests(context)[0];
const firstPassValidation = validateSimpleGraphV3(firstPassProgress.completed[0].output, firstPassRequest);
const entityIdsByName = new Map<string, string>();
for (const entity of inventory.entities) {
  for (const name of [entity.name, ...(entity.aliases ?? [])]) entityIdsByName.set(normalizeName(name), entity.temporary_id);
}

function goldMatch(relationship: ValidSimpleGraphV3Relationship, reference: any, requirePage = true) {
  const sourceId = entityIdsByName.get(normalizeName(reference.source));
  const targetId = entityIdsByName.get(normalizeName(reference.target));
  if (!sourceId || !targetId) return false;
  if (requirePage && !relationship.provenance.some((provenance) => reference.pages.includes(provenance.page))) return false;
  return classifyRelationshipScoringMatch(
    { sourceId: relationship.sourceCanonicalId, targetId: relationship.targetCanonicalId, relationshipType: relationship.relationshipType },
    { sourceId, targetId, relationshipType: reference.relationship },
  ) !== "NO_MATCH";
}

const outsideGold = firstPassValidation.relationships.filter((relationship) =>
  !frozenGold.relationships.some((reference: any) => goldMatch(relationship, reference)));

if (process.argv.includes("--list-outside")) {
  console.log(outsideGold.map((relationship, index) => ({
    index,
    key: `${relationship.sourceName}|${relationship.relationship}|${relationship.targetName}|${relationship.provenance[0].segmentId}`,
  })));
  process.exit(0);
}

type AuditClassification = "VALID_USEFUL" | "VALID_WEAK" | "UNSUPPORTED" | "IDENTITY_ERROR";
interface AuditDecision { key: string; classification: AuditClassification; includeInFutureGold?: boolean; note: string }
const audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, "utf8")) as { decisions: AuditDecision[] } : null;
if (!audit) throw new Error(`Missing source audit ${auditPath}; run --list-outside to prepare it`);
const decisions = new Map(audit.decisions.map((decision) => [decision.key, decision]));
if (decisions.size !== outsideGold.length || outsideGold.some((relationship) => !decisions.has(`${relationship.sourceName}|${relationship.relationship}|${relationship.targetName}|${relationship.provenance[0].segmentId}`))) {
  throw new Error(`Source audit must classify all ${outsideGold.length} outside-gold relationships exactly once`);
}
const acceptedFirstPassRelationships = firstPassValidation.relationships.filter((relationship) => {
  if (frozenGold.relationships.some((reference: any) => goldMatch(relationship, reference))) return true;
  const key = `${relationship.sourceName}|${relationship.relationship}|${relationship.targetName}|${relationship.provenance[0].segmentId}`;
  return decisions.get(key)?.classification === "VALID_USEFUL";
});

function tokenSet(value: string) {
  return new Set(normalizeName(value).split(/\s+/u).filter((token) => token.length > 2));
}

function lexicalCoverage(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  const denominator = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  return [...leftTokens].filter((token) => rightTokens.has(token)).length / denominator;
}

const occurrenceCandidates = context.entities.map((entity) => ({ temporary_id: entity.canonicalId, name: entity.name, type: entity.type, aliases: entity.aliases }));
const idsBySegment = new Map(context.sourceSegments.map((segment) => [segment.segmentId, new Set(boundedEntityContextInSemanticText(occurrenceCandidates, segment.semanticText).entityIds)]));
const degree = new Map(context.entities.map((entity) => [entity.canonicalId, 0]));
for (const relationship of acceptedFirstPassRelationships) {
  degree.set(relationship.sourceCanonicalId, (degree.get(relationship.sourceCanonicalId) ?? 0) + 1);
  degree.set(relationship.targetCanonicalId, (degree.get(relationship.targetCanonicalId) ?? 0) + 1);
}
const representedSegments = new Set(acceptedFirstPassRelationships.flatMap((relationship) => relationship.provenance.map((provenance) => provenance.segmentId)));

function supportSegment(reference: any) {
  const pageSegments = context.sourceSegments.filter((segment) => reference.pages.includes(segment.page));
  const sourceId = entityIdsByName.get(normalizeName(reference.source));
  const targetId = entityIdsByName.get(normalizeName(reference.target));
  return pageSegments.map((segment) => {
    const ids = idsBySegment.get(segment.segmentId) ?? new Set<string>();
    const endpointScore = (sourceId && ids.has(sourceId) ? 100 : 0) + (targetId && ids.has(targetId) ? 100 : 0);
    const evidenceScore = reference.evidence ? lexicalCoverage(reference.evidence, segment.semanticText) * 20 : 0;
    const relationshipScore = lexicalCoverage(reference.relationship, segment.semanticText);
    return { segment, score: endpointScore + evidenceScore + relationshipScore };
  })
    .sort((left, right) => right.score - left.score || left.segment.segmentId.localeCompare(right.segment.segmentId))[0]?.segment ?? null;
}

const recoveredGold = frozenGold.relationships.filter((reference: any) => firstPassValidation.relationships.some((relationship) => goldMatch(relationship, reference)));
const missedDiagnosis = frozenGold.relationships.filter((reference: any) => !recoveredGold.includes(reference)).map((reference: any) => {
  const sourceId = entityIdsByName.get(normalizeName(reference.source));
  const targetId = entityIdsByName.get(normalizeName(reference.target));
  const segment = supportSegment(reference);
  const segmentIds = segment ? idsBySegment.get(segment.segmentId) ?? new Set<string>() : new Set<string>();
  const endpointsPresent = Boolean(sourceId && targetId && firstPassRequest.entities.some((entity) => entity.canonicalId === sourceId) && firstPassRequest.entities.some((entity) => entity.canonicalId === targetId));
  const supportingSegmentPresent = Boolean(segment);
  const endpointsPresentInSupportingSegment = Boolean(sourceId && targetId && segmentIds.has(sourceId) && segmentIds.has(targetId));
  const sourceDegree = sourceId ? degree.get(sourceId) ?? 0 : null;
  const targetDegree = targetId ? degree.get(targetId) ?? 0 : null;
  const cause = endpointsPresent && supportingSegmentPresent && endpointsPresentInSupportingSegment ? "LIKELY_MODEL_OMISSION" : "IDENTITY_OR_CONTEXT_BURDEN";
  return {
    source: reference.source,
    relationship: reference.relationship,
    target: reference.target,
    pages: reference.pages,
    supportSegment: segment?.segmentId ?? null,
    endpointsPresent,
    supportingSegmentPresent,
    endpointsPresentInSupportingSegment,
    sourceDegree,
    targetDegree,
    eitherZeroDegree: sourceDegree === 0 || targetDegree === 0,
    eitherLowDegree: (sourceDegree ?? 99) <= 1 || (targetDegree ?? 99) <= 1,
    supportSegmentRepresented: segment ? representedSegments.has(segment.segmentId) : false,
    cause,
  };
});

const completenessPlan = planSimpleGraphV3Completeness(context, acceptedFirstPassRelationships);
const diagnostics = completenessPlan.requests.map((request) => simpleGraphV3CompletenessTokenDiagnostics(request));

function structurallyRecoverable(reference: any) {
  const sourceId = entityIdsByName.get(normalizeName(reference.source));
  const targetId = entityIdsByName.get(normalizeName(reference.target));
  const segment = supportSegment(reference);
  return completenessPlan.requests.some((request) => sourceId && targetId
    && request.entities.some((entity) => entity.canonicalId === sourceId)
    && request.entities.some((entity) => entity.canonicalId === targetId)
    && Boolean(segment && request.sourceSegments.some((candidate) => candidate.segmentId === segment.segmentId)));
}

function futureGold() {
  const relationships = [...frozenGold.relationships];
  const additions: any[] = [];
  for (const relationship of outsideGold) {
    const key = `${relationship.sourceName}|${relationship.relationship}|${relationship.targetName}|${relationship.provenance[0].segmentId}`;
    const decision = decisions.get(key);
    if (decision?.classification !== "VALID_USEFUL" || decision.includeInFutureGold === false) continue;
    if (relationships.some((reference: any) => goldMatch(relationship, reference, false))) continue;
    const addition = {
      source: relationship.sourceName,
      relationship: relationship.relationship,
      target: relationship.targetName,
      pages: [...new Set(relationship.provenance.map((provenance) => provenance.page))],
      origin: "simple_v3_verified_useful",
      evidence: relationship.provenance[0].text,
    };
    relationships.push(addition);
    additions.push(addition);
  }
  const frozen = {
    fixture_hash: fixture.fixture_hash,
    source_pages: frozenGold.source_pages,
    base_reference_hash: frozenGold.reference_hash,
    prior_verified_v1_v2_additions: 0,
    simple_v3_verified_useful_additions: additions.length,
    relationships,
  };
  return { ...frozen, reference_hash: sha256(relationships) };
}

const future = futureGold();
if (!existsSync(futureGoldPath)) writeFileSync(futureGoldPath, `${JSON.stringify(future, null, 2)}\n`);
else {
  const existing = JSON.parse(readFileSync(futureGoldPath, "utf8"));
  if (existing.reference_hash !== future.reference_hash || sha256(existing.relationships) !== existing.reference_hash) throw new Error("Frozen future gold differs from current verified audit");
}

const auditCounts = Object.fromEntries((["VALID_USEFUL", "VALID_WEAK", "UNSUPPORTED", "IDENTITY_ERROR"] as const).map((classification) => [classification, audit.decisions.filter((decision) => decision.classification === classification).length]));
const estimatedInputTokens = diagnostics.reduce((sum, item) => sum + item.estimatedTokens.totalInput, 0);
const estimatedOutputTokens = diagnostics.reduce((sum, item) => sum + item.estimatedTokens.maximumExpectedOutput, 0);
const oldMissesRecoverable = missedDiagnosis.filter((reference: any) => structurallyRecoverable(reference)).length;
const futureMisses = future.relationships.filter((reference: any) => !firstPassValidation.relationships.some((relationship) => goldMatch(relationship, reference)));
const futureMissesRecoverable = futureMisses.filter((reference: any) => structurallyRecoverable(reference)).length;
const summary = {
  safety: { paidCalls: 0, modelCalls: 0, productionWiring: false, historicalScoresModified: false },
  firstPass: { relationships: firstPassValidation.relationships.length, sourceAcceptedUsefulRelationships: acceptedFirstPassRelationships.length, recovered: recoveredGold.length, totalTokens: firstPassResult.simpleV3.totalTokens },
  outsideGoldAudit: { total: outsideGold.length, counts: auditCounts },
  futureGold: { count: future.relationships.length, hash: future.reference_hash, simpleV3Additions: future.simple_v3_verified_useful_additions, priorVerifiedV1V2Additions: future.prior_verified_v1_v2_additions },
  missedDiagnosis: {
    total: missedDiagnosis.length,
    likelyModelOmission: missedDiagnosis.filter((item: any) => item.cause === "LIKELY_MODEL_OMISSION").length,
    identityOrContextBurden: missedDiagnosis.filter((item: any) => item.cause === "IDENTITY_OR_CONTEXT_BURDEN").length,
    eitherZeroDegree: missedDiagnosis.filter((item: any) => item.eitherZeroDegree).length,
    eitherLowDegree: missedDiagnosis.filter((item: any) => item.eitherLowDegree).length,
    supportSegmentRepresented: missedDiagnosis.filter((item: any) => item.supportSegmentRepresented).length,
    rows: missedDiagnosis,
  },
  completeness: {
    targets: completenessPlan.targets.map((target) => ({ name: target.entity.name, degree: target.degree, signals: target.signals, uncoveredSegments: target.uncoveredSegmentIds.filter((id) => completenessPlan.selectedSegmentIds.includes(id)) })),
    targetCount: completenessPlan.targets.length,
    evidenceSegments: completenessPlan.selectedSegmentIds,
    evidenceSegmentCount: completenessPlan.selectedSegmentIds.length,
    relevantEntities: completenessPlan.requests.reduce((sum, request) => sum + request.entities.length, 0),
    semanticCharacters: completenessPlan.requests.reduce((sum, request) => sum + request.sourceSegments.reduce((subtotal, segment) => subtotal + segment.semanticText.length, 0), 0),
    plannedRequests: completenessPlan.requests.length,
    diagnostics,
    estimatedInputTokens,
    maximumExpectedOutputTokens: estimatedOutputTokens,
    estimatedCompletenessTotalTokens: estimatedInputTokens + estimatedOutputTokens,
    estimatedCombinedTokens: firstPassResult.simpleV3.totalTokens + estimatedInputTokens + estimatedOutputTokens,
    structuralRecoverability: { oldGoldMissed: missedDiagnosis.length, oldGoldRecoverable: oldMissesRecoverable, futureGoldMissed: futureMisses.length, futureGoldRecoverable: futureMissesRecoverable },
  },
  explicitChecks: missedDiagnosis.filter((item: any) =>
    (item.source === "Ragesian Imperial Navy" && item.target === "Turinn")
    || (item.source === "Ostalin" && item.target === "Turinn")
    || (item.source === "Turinn" && item.target === "Sindaire")),
  factsCompatibility: { sharedExtractionContextUnchanged: true, sameEntities: true, sameSourceSegments: true, sameRawProvenance: true, separateFactContract: true, factsImplemented: false },
  manualLunaCommand: "$env:ALLOW_PAID_SIMPLE_V3_COMPLETENESS_LUNA='1'; $env:GRAPH_EXTRACTION_PROVIDER='openai'; $env:OPENAI_GRAPH_EXTRACTION_MODEL='gpt-5.6-luna'; node --conditions=react-server --import tsx scripts/evaluate-test9-simple-v3-completeness.ts --live-luna",
};

async function main() {
  const live = process.argv.includes("--live-luna");
  if (!live) {
    writeFileSync(resultPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (process.env.ALLOW_PAID_SIMPLE_V3_COMPLETENESS_LUNA !== "1") throw new Error("Live Luna completeness requires explicit ALLOW_PAID_SIMPLE_V3_COMPLETENESS_LUNA=1 authorization");
  if (existsSync(progressPath)) throw new Error("Saved completeness retry exists; refusing to overwrite it");
  const { getStructuredModelProvider } = await import("../lib/ai/structured-model-provider-runtime");
  const provider = getStructuredModelProvider("graph_extraction");
  if (provider.providerId !== "openai" || provider.modelId !== "gpt-5.6-luna") throw new Error(`Manual acceptance requires openai:gpt-5.6-luna, got ${provider.providerId}:${provider.modelId}`);
  const completed = [];
  for (const request of completenessPlan.requests) {
    const response = await runSimpleGraphV3Completeness(request, provider);
    completed.push({ requestId: request.requestId, output: response.output, usage: response.usage, validation: validateSimpleGraphV3Completeness(response.output, request) });
  }
  writeFileSync(progressPath, `${JSON.stringify({ fixtureHash: fixture.fixture_hash, futureGoldHash: future.reference_hash, completed }, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, live: { calls: completed.length, completed } }, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
