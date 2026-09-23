/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { zodTextFormat } from "openai/helpers/zod";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { resolveRawRelationships } from "../lib/ai/graph-extraction";
import { SPAN_GRAPH_EXTRACTION_SYSTEM_PROMPT, buildSemanticEvidenceUnits, buildSpanGraphExtractionInput, packSemanticEvidenceUnits, runSpanGraphExtraction, spanGraphExtractionOutputSchemaForRequest, validateSpanGraphExtraction } from "../lib/ai/span-graph-extraction";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";
import { normalizeName } from "../lib/graph/normalize";
import { classifyRelationshipScoringMatch, type RelationshipScoringMatch } from "./wotbs-stage1";

loadEnvConfig(process.cwd());
const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const gold = JSON.parse(readFileSync(join(directory, "next-experiment-gold.json"), "utf8")) as any;
const outputPath = join(directory, "span-v2-result.json");
const progressPath = join(directory, "span-v2-progress.json");
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
if (gold.reference_hash !== "60870a5ccdc5e459576baae78e7fe031c71c16a2939835bb6678b6695beda68a" || sha256(gold.relationships) !== gold.reference_hash) throw new Error("Frozen V2 gold hash mismatch");

const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const cleanedPages = cleanDocumentPagesForModel(fixture.pages).pages;
const units = buildSemanticEvidenceUnits(cleanedPages, inventory);
const requests = packSemanticEvidenceUnits(units, cleanedPages);
const entitiesByName = new Map<string, string>();
for (const entity of inventory.entities) for (const name of [entity.name, ...(entity.aliases ?? [])]) entitiesByName.set(normalizeName(name), entity.temporary_id);
const structural = gold.relationships.map((relationship: any) => {
  const sourceId = entitiesByName.get(normalizeName(relationship.source)); const targetId = entitiesByName.get(normalizeName(relationship.target));
  const candidateUnits = sourceId && targetId ? units.filter((unit) => relationship.pages.includes(unit.page) && unit.entityIds.includes(sourceId) && unit.entityIds.includes(targetId)) : [];
  const evidenceRepresented = candidateUnits.some((unit) => !relationship.evidence || unit.evidenceSpans.some((span) => span.rawSourceSlice.includes(relationship.evidence)));
  return { relationship: `${relationship.source} -> ${relationship.relationship} -> ${relationship.target}`, sourceId: sourceId ?? null, targetId: targetId ?? null, unitIds: candidateUnits.map((unit) => unit.unitId), endpointsTogether: candidateUnits.length > 0, evidenceRepresented };
});
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const distribution = (values: number[]) => ({ minimum: Math.min(...values), p50: sorted(values)[Math.floor(values.length * .5)], p90: sorted(values)[Math.floor(values.length * .9)], maximum: Math.max(...values), average: values.reduce((a, b) => a + b, 0) / values.length });
const preflight = {
  fixtureHash: fixture.fixture_hash,
  goldHash: gold.reference_hash,
  goldRelationships: gold.relationships.length,
  units: units.length,
  unitCharacters: distribution(units.map((unit) => unit.semanticCharacters)),
  entitiesPerUnit: distribution(units.map((unit) => unit.entityIds.length)),
  maximumEntitiesInUnit: Math.max(...units.map((unit) => unit.entityIds.length)),
  evidenceSpans: units.reduce((count, unit) => count + unit.evidenceSpans.length, 0),
  requests: requests.map((request) => {
    const inputCharacters = SPAN_GRAPH_EXTRACTION_SYSTEM_PROMPT.length + JSON.stringify(buildSpanGraphExtractionInput(request, inventory)).length;
    return { id: request.id, units: request.units.length, characters: request.characterCount, entities: request.entityIds.length, evidenceSpans: request.evidenceSpanCount, inputCharacters, estimatedInputTokens: Math.ceil(inputCharacters / 4) };
  }),
  expectedCalls: requests.length,
  strictSchemasReady: requests.every((request) => zodTextFormat(spanGraphExtractionOutputSchemaForRequest(request), "span_graph_extraction_output").type === "json_schema"),
  structuralCoverage: { endpointsTogether: structural.filter((item: any) => item.endpointsTogether).length, evidenceRepresented: structural.filter((item: any) => item.evidenceRepresented).length, impossible: structural.filter((item: any) => !item.endpointsTogether || !item.evidenceRepresented) },
};
console.log(JSON.stringify(preflight, null, 2));
if (process.argv.includes("--preflight")) process.exit(0);
if (preflight.structuralCoverage.impossible.length) throw new Error("V2 deterministic preflight has structurally impossible gold relationships");
if (process.argv.includes("--validate-progress")) {
  const progress = JSON.parse(readFileSync(progressPath, "utf8")) as any;
  const validations = progress.completed.map((item: any) => {
    const request = requests.find((candidate) => candidate.id === item.requestId);
    if (!request) throw new Error(`Progress contains unknown request ${item.requestId}`);
    const validation = validateSpanGraphExtraction(item.raw, request, inventory);
    return { requestId: item.requestId, proposed: validation.proposedRelationships, valid: validation.relationships.length, provenanceRejections: validation.evidenceQuoteRejections };
  });
  console.log(JSON.stringify({ validations }, null, 2));
  process.exit(0);
}

async function runBenchmark() {
const { getStructuredModelProvider } = await import("../lib/ai/structured-model-provider-runtime");
const provider = getStructuredModelProvider("graph_extraction");
if (provider.providerId !== "openai" || provider.modelId !== "gpt-5.6-luna") throw new Error(`Expected openai:gpt-5.6-luna, got ${provider.providerId}:${provider.modelId}`);
const responses = [];
const persisted = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) as any : null;
if (persisted && (persisted.fixtureHash !== fixture.fixture_hash || persisted.goldHash !== gold.reference_hash)) throw new Error("Persisted V2 progress does not match frozen inputs");
for (const request of requests) {
  const prior = persisted?.completed?.find((item: any) => item.requestId === request.id);
  if (prior) {
    responses.push({ request, raw: prior.raw, usage: prior.usage, validation: validateSpanGraphExtraction(prior.raw, request, inventory) });
    continue;
  }
  const response = await runSpanGraphExtraction(request, inventory, provider);
  writeFileSync(progressPath, `${JSON.stringify({ fixtureHash: fixture.fixture_hash, goldHash: gold.reference_hash, completed: [...responses.map((item) => ({ requestId: item.request.id, raw: item.raw, usage: item.usage })), { requestId: request.id, raw: response.output, usage: response.usage }] }, null, 2)}\n`);
  responses.push({ request, raw: response.output, usage: response.usage, validation: validateSpanGraphExtraction(response.output, request, inventory) });
}
const candidate = responses.flatMap((response) => response.validation.relationships);
const score = (relationships: typeof candidate) => {
  const matchCounts: Record<RelationshipScoringMatch, number> = { EXACT_MATCH: 0, NORMALIZED_MATCH: 0, BOUNDED_SEMANTIC_MATCH: 0, NO_MATCH: 0 };
  const recovered = gold.relationships.flatMap((reference: any) => {
    const sourceId = entitiesByName.get(normalizeName(reference.source)); const targetId = entitiesByName.get(normalizeName(reference.target)); if (!sourceId || !targetId) return [];
    const matches = relationships.map((relationship) => ({ relationship, classification: classifyRelationshipScoringMatch({ sourceId: relationship.sourceInventoryId, targetId: relationship.targetInventoryId, relationshipType: relationship.relationship }, { sourceId, targetId, relationshipType: reference.relationship }) })).filter((item) => item.classification !== "NO_MATCH");
    if (!matches.length) return [];
    const classification = matches.some((item) => item.classification === "EXACT_MATCH") ? "EXACT_MATCH" : matches.some((item) => item.classification === "NORMALIZED_MATCH") ? "NORMALIZED_MATCH" : "BOUNDED_SEMANTIC_MATCH";
    matchCounts[classification] += 1; return [{ ...reference, classification }];
  });
  const missed = gold.relationships.filter((reference: any) => !recovered.some((item: any) => item.source === reference.source && item.relationship === reference.relationship && item.target === reference.target));
  const missedAnalysis = missed.map((reference: any) => {
    const sourceId = entitiesByName.get(normalizeName(reference.source)); const targetId = entitiesByName.get(normalizeName(reference.target));
    const endpointCandidates = relationships.filter((relationship) => (relationship.sourceInventoryId === sourceId && relationship.targetInventoryId === targetId) || (relationship.sourceInventoryId === targetId && relationship.targetInventoryId === sourceId)).map((relationship) => `${relationship.sourceName} -> ${relationship.relationship} -> ${relationship.targetName}`);
    return { ...reference, endpointCandidates: [...new Set(endpointCandidates)] };
  });
  return { matchCounts, recovered, missed, missedAnalysis };
};
const candidateScore = score(candidate);
const baselineRaw = { relationships: fixture.baseline_raw.flatMap((raw: any) => raw.relationships).filter((edge: any) => edge.page >= 10 && edge.page <= 14) };
const baselineValidation = resolveRawRelationships(baselineRaw, inventory, { id: "baseline-test9-pages-10-14", pages: cleanedPages, characterCount: cleanedPages.reduce((count, page) => count + page.text.length, 0) });
const baselineForScoring = baselineRaw.relationships.flatMap((relationship: any) => {
  const sourceInventoryId = entitiesByName.get(normalizeName(relationship.source)); const targetInventoryId = entitiesByName.get(normalizeName(relationship.target));
  return sourceInventoryId && targetInventoryId ? [{ sourceInventoryId, targetInventoryId, sourceName: relationship.source, targetName: relationship.target, relationship: relationship.relationship }] : [];
});
const baselineScore = score(baselineForScoring as typeof candidate);
const usages = responses.map((response) => response.usage);
const sum = (key: "inputTokens" | "outputTokens" | "totalTokens") => usages.some((usage) => usage[key] === null) ? null : usages.reduce((count, usage) => count + (usage[key] ?? 0), 0);
const baselineIndexes = fixture.baseline_raw.map((raw: any, index: number) => ({ raw, index })).filter(({ raw }: any) => raw.relationships.some((edge: any) => edge.page >= 10 && edge.page <= 14));
const uniqueCandidate = [...new Map(candidate.map((relationship) => [relationship.semanticKey, relationship])).values()];
const result = { preflight, baseline: { calls: 1, inputTokens: baselineIndexes.reduce((n: number, item: any) => n + (fixture.baseline_usage[item.index].inputTokens ?? 0), 0), outputTokens: baselineIndexes.reduce((n: number, item: any) => n + (fixture.baseline_usage[item.index].outputTokens ?? 0), 0), totalTokens: baselineIndexes.reduce((n: number, item: any) => n + (fixture.baseline_usage[item.index].totalTokens ?? 0), 0), rawRelationships: baselineRaw.relationships.length, validRelationships: baselineRaw.relationships.length, provenanceRejections: null, currentValidatorAccepted: baselineValidation.relationships.length, ...baselineScore, recovered: baselineScore.recovered.length }, candidate: { calls: responses.length, inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens"), rawRelationships: responses.reduce((count, response) => count + response.raw.unit_results.reduce((subtotal: number, unit: any) => subtotal + unit.relationships.length, 0), 0), validRelationships: candidate.length, uniqueValidRelationships: uniqueCandidate.length, provenanceRejections: responses.reduce((count, response) => count + response.validation.evidenceQuoteRejections, 0), ...candidateScore, recovered: candidateScore.recovered.length, audit: uniqueCandidate.map((relationship) => ({ source: relationship.sourceName, relationship: relationship.relationship, target: relationship.targetName, page: relationship.page, evidence: relationship.matchedEvidenceText })), raw: responses.map((response) => response.raw) } };
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
}
void runBenchmark().catch((error) => { console.error(error); process.exitCode = 1; });
