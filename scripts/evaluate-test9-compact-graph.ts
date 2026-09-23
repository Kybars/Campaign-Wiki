/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/compact-extraction-context";
import { COMPACT_RELATIONSHIP_BEHAVIOR_VERSION, COMPACT_RELATIONSHIP_CONTRACT_VERSION, COMPACT_RELATIONSHIP_SYSTEM_PROMPT, compactRelationshipOutputSchema, planCompactRelationshipRequests, serializeCompactRelationshipRequest, validateCompactRelationships, type CompactRelationshipOutput, type CompactRelationshipRequest, type ValidCompactRelationship } from "../lib/ai/compact-relationship-extraction";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";
import { normalizeName } from "../lib/graph/normalize";
import { classifyRelationshipScoringMatch, type RelationshipScoringMatch } from "./wotbs-stage1";

const ROOT = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const RESULT = join(ROOT, "compact-graph-result.json");
const PROGRESS = join(ROOT, "compact-graph-progress.json");
const FAILURES = join(ROOT, "compact-graph-failures.json");
const AUDIT = join(ROOT, "compact-graph-manual-audit.json");
const MODEL = "qwen3.5:9b";
const DIGEST = "6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7";
const OLLAMA = "http://localhost:11434";
const CONTEXT = 32_768;
const DEADLINE_MS = 600_000;
const BOUNDED_SOURCE_CHARACTERS = 12_000;

const fixture = JSON.parse(readFileSync(join(ROOT, "fixture.json"), "utf8")) as any;
const gold = JSON.parse(readFileSync(join(ROOT, "next-experiment-gold.json"), "utf8")) as any;
const spanV2 = JSON.parse(readFileSync(join(ROOT, "span-v2-result.json"), "utf8")) as any;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
if (fixture.fixture_hash !== gold.fixture_hash || hash(gold.relationships) !== gold.reference_hash) throw new Error("Frozen Test 9 fixture/gold mismatch");

const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const pages = cleanDocumentPagesForModel(fixture.pages).pages;
const context = buildExtractionContext(pages, inventory);
const entitiesByName = new Map<string, string>();
for (const entity of inventory.entities) for (const name of [entity.name, ...(entity.aliases ?? [])]) entitiesByName.set(normalizeName(name), entity.temporary_id);
const jsonSchema = z.toJSONSchema(compactRelationshipOutputSchema);
const schemaText = JSON.stringify(jsonSchema);
const boundedOutputSchema = z.object({ relationships: compactRelationshipOutputSchema.shape.relationships.max(100) }).strict();
const boundedJsonSchema = z.toJSONSchema(boundedOutputSchema);
const BOUNDED_PROMPT_SUFFIX = "\nReturn at most 100 of the strongest non-duplicate relationships.";
const refinedOutputSchema = z.object({ relationships: compactRelationshipOutputSchema.shape.relationships.max(80) }).strict();
const refinedJsonSchema = z.toJSONSchema(refinedOutputSchema);
const REFINED_PROMPT_SUFFIX = `
The integer before the first | on an entity line is that entity's exact ID. Copy that integer; do not infer IDs from row positions or names.
Before emitting an edge, verify the cited segment supports both chosen entity names or an unambiguous reference to them.
Keep r to 1–5 words that express only the semantic relation. Return at most 80 strongest unique relationships.`;

function score(relationships: ValidCompactRelationship[]) {
  const matchCounts: Record<RelationshipScoringMatch, number> = { EXACT_MATCH: 0, NORMALIZED_MATCH: 0, BOUNDED_SEMANTIC_MATCH: 0, NO_MATCH: 0 };
  const recovered = gold.relationships.flatMap((reference: any) => {
    const sourceId = entitiesByName.get(normalizeName(reference.source));
    const targetId = entitiesByName.get(normalizeName(reference.target));
    if (!sourceId || !targetId) return [];
    const classifications = relationships.filter((relationship) => reference.pages.includes(relationship.page)).map((relationship) => classifyRelationshipScoringMatch(
      { sourceId: relationship.sourceCanonicalEntityId, targetId: relationship.targetCanonicalEntityId, relationshipType: relationship.relationship },
      { sourceId, targetId, relationshipType: reference.relationship },
    )).filter((classification) => classification !== "NO_MATCH");
    if (!classifications.length) return [];
    const classification = classifications.includes("EXACT_MATCH") ? "EXACT_MATCH" : classifications.includes("NORMALIZED_MATCH") ? "NORMALIZED_MATCH" : "BOUNDED_SEMANTIC_MATCH";
    matchCounts[classification] += 1;
    return [{ ...reference, classification }];
  });
  const recoveredKeys = new Set(recovered.map((item: any) => `${item.source}|${item.relationship}|${item.target}`));
  const missed = gold.relationships.filter((item: any) => !recoveredKeys.has(`${item.source}|${item.relationship}|${item.target}`));
  return { recovered: recovered.length, recall: recovered.length / gold.relationships.length, recallPer1kTokens: null as number | null, matchCounts, recoveredRelationships: recovered, missedRelationships: missed };
}

function explicitChecks(relationships: ValidCompactRelationship[]) {
  const checks = [
    { id: "navy_blockades_turinn", source: "Ragesian Imperial Navy", relationship: "blockades", target: "Turinn", page: 13 },
    { id: "ostalin_attacks_turinn", source: "Ostalin", relationship: "attacks", target: "Turinn", page: 14 },
    { id: "turinn_capital_of_sindaire", source: "Turinn", relationship: "capital of", target: "Sindaire", page: 13 },
  ];
  return checks.map((check) => {
    const sourceId = entitiesByName.get(normalizeName(check.source))!;
    const targetId = entitiesByName.get(normalizeName(check.target))!;
    const matches = relationships.filter((relationship) => relationship.page === check.page && classifyRelationshipScoringMatch(
      { sourceId: relationship.sourceCanonicalEntityId, targetId: relationship.targetCanonicalEntityId, relationshipType: relationship.relationship },
      { sourceId, targetId, relationshipType: check.relationship },
    ) !== "NO_MATCH");
    return { ...check, recovered: matches.length > 0, matches: matches.map((item) => `${item.sourceName} -> ${item.relationship} -> ${item.targetName} [${item.evidenceSegmentId}]`) };
  });
}

function tokenBreakdown(inputTokens: number, request: CompactRelationshipRequest, instructions = COMPACT_RELATIONSHIP_SYSTEM_PROMPT, schema = schemaText) {
  const serialized = serializeCompactRelationshipRequest(context, request);
  const characters = {
    source: serialized.source.length,
    entityContext: serialized.entities.length,
    instructions: instructions.length,
    schema: schema.length,
  };
  const totalCharacters = Object.values(characters).reduce((sum, value) => sum + value, 0);
  const apportioned = Object.fromEntries(Object.entries(characters).map(([key, value]) => [key, Math.round(inputTokens * value / totalCharacters)]));
  return { method: "proportional character attribution reconciled to Ollama prompt_eval_count", characters, tokens: apportioned };
}

interface OllamaResponse {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

async function ollamaRuntime() {
  const [tagsResponse, psResponse] = await Promise.all([fetch(`${OLLAMA}/api/tags`), fetch(`${OLLAMA}/api/ps`)]);
  if (!tagsResponse.ok) throw new Error(`Ollama tags failed (${tagsResponse.status})`);
  const tags = await tagsResponse.json() as { models?: Array<{ name?: string; digest?: string }> };
  const ps = psResponse.ok ? await psResponse.json() as { models?: Array<{ name?: string; context_length?: number }> } : null;
  const model = tags.models?.find((candidate) => candidate.name === MODEL);
  if (model?.digest !== DIGEST) throw new Error(`Expected frozen ${MODEL} digest ${DIGEST}, got ${model?.digest ?? "missing"}`);
  return { model: MODEL, digest: model.digest, loadedContext: ps?.models?.find((candidate) => candidate.name === MODEL)?.context_length ?? null };
}

async function runCall(strategy: string, request: CompactRelationshipRequest) {
  const serialized = serializeCompactRelationshipRequest(context, request);
  const boundedVariant = strategy === "C_compact_bounded_v2_cap100";
  const refinedVariant = strategy.includes("refined_ids_labels_cap80");
  const systemPrompt = refinedVariant ? `${COMPACT_RELATIONSHIP_SYSTEM_PROMPT}${REFINED_PROMPT_SUFFIX}` : boundedVariant ? `${COMPACT_RELATIONSHIP_SYSTEM_PROMPT}${BOUNDED_PROMPT_SUFFIX}` : COMPACT_RELATIONSHIP_SYSTEM_PROMPT;
  const requestSchema = refinedVariant ? refinedOutputSchema : boundedVariant ? boundedOutputSchema : compactRelationshipOutputSchema;
  const requestJsonSchema = refinedVariant ? refinedJsonSchema : boundedVariant ? boundedJsonSchema : jsonSchema;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEADLINE_MS);
  const started = performance.now();
  try {
    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: serialized.payload },
        ],
        format: requestJsonSchema,
        options: { temperature: 0, num_ctx: CONTEXT, num_predict: 6_000 },
      }),
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`Ollama chat failed (${response.status}): ${bodyText.slice(0, 500)}`);
    const body = JSON.parse(bodyText) as OllamaResponse;
    const raw = requestSchema.parse(JSON.parse(body.message?.content ?? "")) as CompactRelationshipOutput;
    const inputTokens = body.prompt_eval_count ?? 0;
    const outputTokens = body.eval_count ?? 0;
    return {
      strategy,
      requestId: request.id,
      raw,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      latencyMs: Math.round(performance.now() - started),
      ollamaDurationMs: body.total_duration ? Math.round(body.total_duration / 1_000_000) : null,
      tokenBreakdown: tokenBreakdown(inputTokens, request, systemPrompt, JSON.stringify(requestJsonSchema)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarize(strategy: string, requests: CompactRelationshipRequest[], calls: Awaited<ReturnType<typeof runCall>>[]) {
  const validations = calls.map((call, index) => validateCompactRelationships(call.raw, context, requests[index]));
  const accepted = validations.flatMap((validation) => validation.relationships);
  const unique = [...new Map(accepted.map((relationship) => [relationship.semanticKey, relationship])).values()];
  const inputTokens = calls.reduce((sum, call) => sum + call.usage.inputTokens, 0);
  const outputTokens = calls.reduce((sum, call) => sum + call.usage.outputTokens, 0);
  const totalTokens = inputTokens + outputTokens;
  const scored = score(unique);
  scored.recallPer1kTokens = totalTokens ? scored.recovered / (totalTokens / 1000) : null;
  const proposed = validations.reduce((sum, validation) => sum + validation.proposed, 0);
  const duplicateRejections = validations.reduce((sum, validation) => sum + validation.duplicateRejections, 0) + accepted.length - unique.length;
  const breakdownTotals = calls.reduce((totals, call) => {
    for (const [key, value] of Object.entries(call.tokenBreakdown.tokens)) totals[key] = (totals[key] ?? 0) + value;
    return totals;
  }, {} as Record<string, number>);
  const first = calls[0]?.tokenBreakdown.tokens ?? {};
  const repeatedContentTokens = calls.slice(1).reduce((sum, call) => sum + call.tokenBreakdown.tokens.entityContext + call.tokenBreakdown.tokens.instructions + call.tokenBreakdown.tokens.schema, 0);
  return {
    strategy,
    model: MODEL,
    calls: calls.length,
    inputTokens,
    outputTokens,
    totalTokens,
    tokenBreakdown: { ...breakdownTotals, repeatedContent: repeatedContentTokens, firstRequestNonSource: (first.entityContext ?? 0) + (first.instructions ?? 0) + (first.schema ?? 0), attribution: calls[0]?.tokenBreakdown.method },
    proposedRelationships: proposed,
    validRelationshipsBeforeCrossCallDedupe: accepted.length,
    validUniqueRelationships: unique.length,
    duplicateRate: proposed ? duplicateRejections / proposed : 0,
    duplicateRejections,
    invalidEntityIdRejections: validations.reduce((sum, validation) => sum + validation.invalidEntityIdRejections, 0),
    invalidSegmentIdRejections: validations.reduce((sum, validation) => sum + validation.invalidSegmentIdRejections, 0),
    endpointEvidenceRejections: validations.reduce((sum, validation) => sum + validation.endpointEvidenceRejections, 0),
    provenanceFailures: validations.reduce((sum, validation) => sum + validation.invalidSegmentIdRejections + validation.endpointEvidenceRejections, 0),
    ...scored,
    explicitChecks: explicitChecks(unique),
    auditRows: unique.map((relationship) => ({ source: relationship.sourceName, relationship: relationship.relationship, target: relationship.targetName, page: relationship.page, segmentId: relationship.evidenceSegmentId, evidence: relationship.rawSource.text })),
    callsDetail: calls,
  };
}

function cachedComparison() {
  const baselineTokens = spanV2.baseline.totalTokens as number;
  const spanTokens = spanV2.candidate.totalTokens as number;
  const baselineRecovered = spanV2.baseline.recovered as number;
  const spanRecovered = spanV2.candidate.recovered as number;
  return {
    A_cached_baseline: { model: "gpt-5.6-luna (cached; not rerun)", calls: 0, historicalCalls: spanV2.baseline.calls, inputTokens: spanV2.baseline.inputTokens, outputTokens: spanV2.baseline.outputTokens, totalTokens: baselineTokens, validUniqueRelationships: spanV2.baseline.validRelationships, recovered: baselineRecovered, recall: baselineRecovered / gold.relationships.length, recallPer1kTokens: baselineRecovered / (baselineTokens / 1000) },
    spanV2_cached: { model: "gpt-5.6-luna (cached; not rerun)", calls: 0, historicalCalls: spanV2.candidate.calls, inputTokens: spanV2.candidate.inputTokens, outputTokens: spanV2.candidate.outputTokens, totalTokens: spanTokens, validUniqueRelationships: spanV2.candidate.uniqueValidRelationships, recovered: spanRecovered, recall: spanRecovered / gold.relationships.length, recallPer1kTokens: spanRecovered / (spanTokens / 1000), provenanceFailures: spanV2.candidate.provenanceRejections },
  };
}

async function main() {
  const flatRequests = planCompactRelationshipRequests(context);
  const boundedRequests = planCompactRelationshipRequests(context, BOUNDED_SOURCE_CHARACTERS);
  const preflight = {
    fixtureHash: fixture.fixture_hash,
    goldHash: gold.reference_hash,
    contextFingerprint: extractionContextFingerprint(context),
    pages: pages.map((page) => page.pageNumber),
    entities: context.entities.length,
    evidenceSegments: context.evidenceSegments.length,
    semanticSourceCharacters: context.evidenceSegments.reduce((sum, segment) => sum + segment.semanticText.length, 0),
    strategies: { B: flatRequests.map((request) => ({ id: request.id, segments: request.segments.length, sourceCharacters: serializeCompactRelationshipRequest(context, request).source.length })), C: boundedRequests.map((request) => ({ id: request.id, segments: request.segments.length, sourceCharacters: serializeCompactRelationshipRequest(context, request).source.length })) },
    contract: { behaviorVersion: COMPACT_RELATIONSHIP_BEHAVIOR_VERSION, contractVersion: COMPACT_RELATIONSHIP_CONTRACT_VERSION, schema: { relationships: [{ s: "integer", r: "string", t: "integer", e: "string" }] }, runtimeEnums: false, unitResults: false, copiedQuotes: false, candidatePairs: false, variants: { B: ["v1", "v2 refined ID-copying + 1–5-word labels + cap 80"], C: ["v1 malformed JSON", "v2 cap 100", "v3 refined ID-copying + 1–5-word labels + cap 80"] } },
    factsCompatibility: { sameEntities: true, sameEvidenceSegments: true, sameRawProvenance: true, separateContractRequired: true, factsImplemented: false },
    safety: { endpoint: OLLAMA, model: MODEL, openAICalls: 0, retries: 0, paidCalls: 0 },
  };
  if (process.argv.includes("--preflight")) { console.log(JSON.stringify({ preflight, ...cachedComparison() }, null, 2)); return; }
  if (existsSync(RESULT) && !process.argv.includes("--rescore-saved") && !process.argv.includes("--continue-variants")) { console.log(readFileSync(RESULT, "utf8")); return; }
  const runtime = await ollamaRuntime();
  const persisted: { fixtureHash: string; calls: Awaited<ReturnType<typeof runCall>>[] } = existsSync(PROGRESS)
    ? JSON.parse(readFileSync(PROGRESS, "utf8"))
    : { fixtureHash: fixture.fixture_hash, calls: [] };
  if (persisted.fixtureHash !== fixture.fixture_hash) throw new Error("Compact progress belongs to another fixture");
  const plan = [{ strategy: "B_single_compact_flat_v2_refined_ids_labels_cap80", requests: flatRequests }, { strategy: "C_compact_bounded_v3_refined_ids_labels_cap80", requests: boundedRequests }];
  for (const item of plan) for (const request of item.requests) {
    if (persisted.calls.some((call) => call.strategy === item.strategy && call.requestId === request.id)) continue;
    const call = await runCall(item.strategy, request);
    persisted.calls.push(call);
    writeFileSync(PROGRESS, `${JSON.stringify(persisted, null, 2)}\n`);
  }
  const B = summarize(plan[0].strategy, flatRequests, persisted.calls.filter((call) => call.strategy === plan[0].strategy));
  const C = summarize(plan[1].strategy, boundedRequests, persisted.calls.filter((call) => call.strategy === plan[1].strategy));
  const priorVariants = {
    B_v1: summarize("B_single_compact_flat", flatRequests, persisted.calls.filter((call) => call.strategy === "B_single_compact_flat")),
    C_v2: summarize("C_compact_bounded_v2_cap100", boundedRequests, persisted.calls.filter((call) => call.strategy === "C_compact_bounded_v2_cap100")),
  };
  const failedAttempts = existsSync(FAILURES) ? JSON.parse(readFileSync(FAILURES, "utf8")) : [];
  const manualAudit = existsSync(AUDIT) ? { status: "complete", ...JSON.parse(readFileSync(AUDIT, "utf8")) } : { status: "pending" };
  const result = { preflight, runtime, cached: cachedComparison(), failedAttempts, priorVariants, B, C, manualAudit };
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(RESULT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
