/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/extraction-context";
import { auditSimpleGraphV3Coverage, planSimpleGraphV3Requests, runSimpleGraphV3, simpleGraphV3CheckpointIdentity, simpleGraphV3TokenDiagnostics, validateSimpleGraphV3, type SimpleGraphV3Output, type ValidSimpleGraphV3Relationship } from "../lib/ai/simple-graph-v3";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";
import { normalizeName } from "../lib/graph/normalize";
import { classifyRelationshipScoringMatch, type RelationshipScoringMatch } from "./wotbs-stage1";

loadEnvConfig(process.cwd());
const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const resultPath = join(directory, "simple-v3-result.json");
const progressPath = join(directory, "simple-v3-progress.json");
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const gold = JSON.parse(readFileSync(join(directory, "next-experiment-gold.json"), "utf8")) as any;
const spanV2 = JSON.parse(readFileSync(join(directory, "span-v2-result.json"), "utf8")) as any;
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
if (fixture.fixture_hash !== gold.fixture_hash || sha256(gold.relationships) !== gold.reference_hash) throw new Error("Frozen Test 9 fixture/gold mismatch");

const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const pages = cleanDocumentPagesForModel(fixture.pages).pages;
const context = buildExtractionContext(pages, inventory);
const requests = planSimpleGraphV3Requests(context);
const contextFingerprint = extractionContextFingerprint(context);
const entityIdsByName = new Map<string, string>();
for (const entity of inventory.entities) for (const name of [entity.name, ...(entity.aliases ?? [])]) entityIdsByName.set(normalizeName(name), entity.temporary_id);

function score(relationships: ValidSimpleGraphV3Relationship[], totalTokens: number | null) {
  const matchCounts: Record<RelationshipScoringMatch, number> = { EXACT_MATCH: 0, NORMALIZED_MATCH: 0, BOUNDED_SEMANTIC_MATCH: 0, NO_MATCH: 0 };
  const recovered = gold.relationships.flatMap((reference: any) => {
    const sourceId = entityIdsByName.get(normalizeName(reference.source));
    const targetId = entityIdsByName.get(normalizeName(reference.target));
    if (!sourceId || !targetId) return [];
    const matches = relationships.flatMap((relationship) => {
      const supportedPage = relationship.provenance.some((provenance) => reference.pages.includes(provenance.page));
      if (!supportedPage) return [];
      const classification = classifyRelationshipScoringMatch(
        { sourceId: relationship.sourceCanonicalId, targetId: relationship.targetCanonicalId, relationshipType: relationship.relationshipType },
        { sourceId, targetId, relationshipType: reference.relationship },
      );
      return classification === "NO_MATCH" ? [] : [classification];
    });
    if (!matches.length) return [];
    const classification = matches.includes("EXACT_MATCH") ? "EXACT_MATCH" : matches.includes("NORMALIZED_MATCH") ? "NORMALIZED_MATCH" : "BOUNDED_SEMANTIC_MATCH";
    matchCounts[classification] += 1;
    return [{ ...reference, classification }];
  });
  return {
    goldRelationships: gold.relationships.length,
    recovered: recovered.length,
    recall: recovered.length / gold.relationships.length,
    recallPer1kTokens: totalTokens ? recovered.length / (totalTokens / 1000) : null,
    rescueOnlyRecovered: recovered.filter((relationship: any) => relationship.origin === "rescue_only").length,
    matchCounts,
    recoveredRelationships: recovered,
  };
}

const diagnostics = requests.map((request) => ({ requestId: request.requestId, segments: request.sourceSegments.length, pages: [...new Set(request.sourceSegments.map((segment) => segment.page))], semanticCharacters: request.sourceSegments.reduce((sum, segment) => sum + segment.semanticText.length, 0), relevantEntities: request.entities.length, tokenDiagnostics: simpleGraphV3TokenDiagnostics(request) }));
const estimatedInputTokens = diagnostics.reduce((sum, item) => sum + item.tokenDiagnostics.estimatedTokens.totalInput, 0);
const baselineInputTokens = spanV2.baseline.inputTokens as number;
const v2InputTokens = spanV2.candidate.inputTokens as number;
const structurallyEligibleGold = gold.relationships.filter((relationship: any) => requests.some((request) => {
  const suppliedNames = new Set(request.entities.flatMap((entity) => [entity.name, ...entity.aliases]).map(normalizeName));
  return suppliedNames.has(normalizeName(relationship.source)) && suppliedNames.has(normalizeName(relationship.target)) && request.sourceSegments.some((segment) => relationship.pages.includes(segment.page));
}));
const preflight = {
  fixtureHash: fixture.fixture_hash,
  goldHash: gold.reference_hash,
  contextFingerprint,
  pages: pages.map((page) => page.pageNumber),
  sourceSegments: context.sourceSegments.length,
  chunks: requests.length,
  requests: diagnostics,
  totals: { estimatedInputTokens, baselineInputTokens, spanV2InputTokens: v2InputTokens, versusBaseline: estimatedInputTokens / baselineInputTokens, versusSpanV2: estimatedInputTokens / v2InputTokens },
  structuralGoldCoverage: { eligible: structurallyEligibleGold.length, total: gold.relationships.length, rescueOnlyEligible: structurallyEligibleGold.filter((relationship: any) => relationship.origin === "rescue_only").length },
  checkpointIdentities: requests.map((request) => simpleGraphV3CheckpointIdentity({ campaignId: "test9-fixture", documentId: fixture.fixture_hash, sourceExtractionCacheId: null, providerId: "openai", modelId: "gpt-5.6-luna", request, contextFingerprint })),
  factsCompatibility: { sameContext: true, sameEntities: true, sameSourceSegments: true, sameRawProvenance: true, separateFactContractRequired: true, factsImplemented: false },
  safety: { modelCalls: 0, paidCalls: 0, fixtureMutation: false },
};

function cachedComparisons() {
  const baselineRecovered = spanV2.baseline.recovered as number;
  const v2Recovered = spanV2.candidate.recovered as number;
  return {
    productionBaseline: { calls: 0, historicalCalls: spanV2.baseline.calls, inputTokens: baselineInputTokens, outputTokens: spanV2.baseline.outputTokens, totalTokens: spanV2.baseline.totalTokens, validUniqueRelationships: spanV2.baseline.validRelationships, recovered: baselineRecovered, recall: baselineRecovered / gold.relationships.length, recallPer1kTokens: baselineRecovered / (spanV2.baseline.totalTokens / 1000) },
    spanV2: { calls: 0, historicalCalls: spanV2.candidate.calls, inputTokens: v2InputTokens, outputTokens: spanV2.candidate.outputTokens, totalTokens: spanV2.candidate.totalTokens, validUniqueRelationships: spanV2.candidate.uniqueValidRelationships, recovered: v2Recovered, recall: v2Recovered / gold.relationships.length, recallPer1kTokens: v2Recovered / (spanV2.candidate.totalTokens / 1000), provenanceFailures: spanV2.candidate.provenanceRejections },
  };
}

function combineValidations(outputs: Array<{ requestId: string; output: SimpleGraphV3Output }>) {
  const byKey = new Map<string, ValidSimpleGraphV3Relationship>();
  let proposed = 0; let duplicates = 0; let unknown = 0; let ambiguous = 0; let invalidSegments = 0; let invalidPageSegments = 0; let selfEdges = 0;
  for (const item of outputs) {
    const request = requests.find((candidate) => candidate.requestId === item.requestId);
    if (!request) throw new Error(`Saved Simple V3 output has unknown request ${item.requestId}`);
    const validation = validateSimpleGraphV3(item.output, request);
    proposed += validation.proposed; duplicates += validation.duplicateRelationships; unknown += validation.unknownEndpointRejections; ambiguous += validation.ambiguousEndpointRejections; invalidSegments += validation.invalidSegmentRejections; invalidPageSegments += validation.invalidPageSegmentRejections; selfEdges += validation.selfEdgeRejections;
    for (const relationship of validation.relationships) {
      const prior = byKey.get(relationship.semanticKey);
      if (!prior) byKey.set(relationship.semanticKey, relationship);
      else {
        duplicates += 1;
        for (const provenance of relationship.provenance) if (!prior.provenance.some((candidate) => candidate.segmentId === provenance.segmentId)) prior.provenance.push(provenance);
      }
    }
  }
  return { relationships: [...byKey.values()], proposed, duplicates, unknownEndpointRejections: unknown, ambiguousEndpointRejections: ambiguous, invalidSegmentRejections: invalidSegments, invalidPageSegmentRejections: invalidPageSegments, selfEdgeRejections: selfEdges };
}

async function main() {
  const live = process.argv.includes("--live-luna");
  const validateSaved = process.argv.includes("--validate-saved");
  if (!live && !validateSaved) {
    console.log(JSON.stringify({ preflight, cached: cachedComparisons(), manualLunaCommand: "$env:ALLOW_PAID_SIMPLE_V3_LUNA='1'; $env:GRAPH_EXTRACTION_PROVIDER='openai'; $env:OPENAI_GRAPH_EXTRACTION_MODEL='gpt-5.6-luna'; node --conditions=react-server --import tsx scripts/evaluate-test9-simple-v3.ts --live-luna" }, null, 2));
    return;
  }
  if (live && validateSaved) throw new Error("Choose either --live-luna or --validate-saved");
  if (validateSaved && !existsSync(progressPath)) throw new Error("No saved Simple V3 progress exists");
  if (live && process.env.ALLOW_PAID_SIMPLE_V3_LUNA !== "1") throw new Error("Live Luna run requires explicit ALLOW_PAID_SIMPLE_V3_LUNA=1 authorization");
  const progress: { fixtureHash: string; completed: Array<{ requestId: string; output: SimpleGraphV3Output; usage: any }> } = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { fixtureHash: fixture.fixture_hash, completed: [] };
  if (progress.fixtureHash !== fixture.fixture_hash) throw new Error("Saved Simple V3 progress belongs to another fixture");
  if (live) {
    const { getStructuredModelProvider } = await import("../lib/ai/structured-model-provider-runtime");
    const provider = getStructuredModelProvider("graph_extraction");
    if (provider.providerId !== "openai" || provider.modelId !== "gpt-5.6-luna") throw new Error(`Manual acceptance requires openai:gpt-5.6-luna, got ${provider.providerId}:${provider.modelId}`);
    for (const request of requests) {
      if (progress.completed.some((item) => item.requestId === request.requestId)) continue;
      const response = await runSimpleGraphV3(request, provider);
      progress.completed.push({ requestId: request.requestId, output: response.output, usage: response.usage });
      writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
    }
  }
  const validation = combineValidations(progress.completed);
  const usages = progress.completed.map((item) => item.usage);
  const sum = (key: string) => usages.some((usage) => usage[key] === null) ? null : usages.reduce((total, usage) => total + (usage[key] ?? 0), 0);
  const totalTokens = sum("totalTokens");
  const scored = score(validation.relationships, totalTokens);
  const result = {
    preflight,
    cached: cachedComparisons(),
    simpleV3: {
      model: "gpt-5.6-luna",
      calls: progress.completed.length,
      inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens,
      proposedRelationships: validation.proposed,
      validUniqueRelationships: validation.relationships.length,
      duplicateRelationships: validation.duplicates,
      duplicateRate: validation.proposed ? validation.duplicates / validation.proposed : 0,
      provenanceFailures: validation.invalidSegmentRejections + validation.invalidPageSegmentRejections,
      unknownEndpointRejections: validation.unknownEndpointRejections,
      ambiguousEndpointRejections: validation.ambiguousEndpointRejections,
      coverageAudit: auditSimpleGraphV3Coverage(requests, validation.relationships),
      ...scored,
      unsupportedRelationships: null,
      manualAuditRequired: true,
      auditRows: validation.relationships.map((relationship) => ({ source: relationship.sourceName, relationship: relationship.relationship, target: relationship.targetName, provenance: relationship.provenance })),
    },
    safety: { paidCallsMadeByThisMode: live ? progress.completed.length : 0, fixtureMutation: false },
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
