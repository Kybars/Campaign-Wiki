import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { normalizeName } from "../lib/graph/normalize";
import type { ChunkExtraction } from "../lib/ai/schemas";

loadEnvConfig(process.cwd());

const CACHE_ID = "1ad99ac3-6cf5-4731-bf1e-4736109f0de8";
const variants = ["historical", "luna", "terra"] as const;
type Variant = (typeof variants)[number];

interface ReferenceIdentity {
  name: string;
  reference_type: string;
  acceptable_aliases: string[];
  historically_missed: boolean;
}

interface ReferenceChunk {
  chunk_number: number;
  page_range: number[];
  expected_identities: ReferenceIdentity[];
}

interface ReferenceArtifact { chunks: ReferenceChunk[] }

interface CallArtifact {
  attemptNumber: number;
  requestedModel: string;
  responseModel: string;
  responseId: string;
  responseStatus: string;
  incompleteDetails: unknown;
  latencyMs: number;
  valid: boolean;
  usage: {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    cacheWriteTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
  };
  validationDiagnostics: unknown[];
  rawOutput: ChunkExtraction;
  validatedOutput: ChunkExtraction;
}

interface EvaluatedEntity {
  name: string;
  type: string;
  aliases: string[];
  facts: number;
  evidence: number;
  summaryCharacters: number;
  chunk: number;
}

const reference = JSON.parse(readFileSync(
  new URL("../docs/audits/extraction_ab_reference.json", import.meta.url),
  "utf8",
)) as ReferenceArtifact;

function identities(name: string, aliases: string[]) {
  return new Set([name, ...aliases].map(normalizeName).filter(Boolean));
}

function distinctEntities(entities: EvaluatedEntity[]) {
  const groups: EvaluatedEntity[][] = [];
  for (const entity of entities) {
    const entityIdentities = identities(entity.name, entity.aliases);
    const group = groups.find((items) => items.some((item) => [...identities(item.name, item.aliases)].some((identity) => entityIdentities.has(identity))));
    if (group) group.push(entity);
    else groups.push([entity]);
  }
  return groups.map((group) => group[0]);
}

function evaluateEntities(references: ReferenceIdentity[], entities: EvaluatedEntity[]) {
  const matchedReferences = new Set<number>();
  const classifications: Array<{ entity: EvaluatedEntity; classification: string; reference?: ReferenceIdentity }> = [];
  for (const entity of distinctEntities(entities)) {
    const extractedIdentities = identities(entity.name, entity.aliases);
    const exactNameMatches = references.map((item, index) => ({ item, index })).filter(({ item }) =>
      identities(item.name, item.acceptable_aliases).has(normalizeName(entity.name)),
    );
    const matches = exactNameMatches.length > 0 ? exactNameMatches : references.map((item, index) => ({ item, index })).filter(({ item }) =>
      [...extractedIdentities].some((identity) => identities(item.name, item.acceptable_aliases).has(identity)),
    );
    if (matches.length === 0) classifications.push({ entity, classification: "FALSE_POSITIVE" });
    else if (matches.length > 1) classifications.push({ entity, classification: "AMBIGUOUS" });
    else if (matches[0].item.reference_type !== entity.type) classifications.push({ entity, classification: "TYPE_MISMATCH", reference: matches[0].item });
    else if (matchedReferences.has(matches[0].index)) classifications.push({ entity, classification: "DUPLICATE_WITHIN_OUTPUT", reference: matches[0].item });
    else {
      matchedReferences.add(matches[0].index);
      classifications.push({ entity, classification: "TRUE_POSITIVE", reference: matches[0].item });
    }
  }
  const truePositives = classifications.filter((item) => item.classification === "TRUE_POSITIVE").length;
  const distinctExtracted = classifications.filter((item) => item.classification !== "DUPLICATE_WITHIN_OUTPUT").length;
  const precision = distinctExtracted === 0 ? 0 : truePositives / distinctExtracted;
  const recall = references.length === 0 ? 0 : truePositives / references.length;
  const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  const historicalMissIndexes = references.map((item, index) => ({ item, index })).filter(({ item }) => item.historically_missed);
  const recoveredHistoricalMisses = historicalMissIndexes.filter(({ index }) => matchedReferences.has(index)).length;
  const byType = Object.fromEntries([...new Set(references.map((item) => item.reference_type))].sort().map((type) => {
    const expectedIndexes = references.map((item, index) => ({ item, index })).filter(({ item }) => item.reference_type === type);
    const recalled = expectedIndexes.filter(({ index }) => matchedReferences.has(index)).length;
    return [type, { expected: expectedIndexes.length, recalled, recall: expectedIndexes.length ? recalled / expectedIndexes.length : 0 }];
  }));
  return {
    expected: references.length,
    distinctExtracted,
    truePositives,
    precision,
    recall,
    f1,
    historicalMisses: historicalMissIndexes.length,
    recoveredHistoricalMisses,
    historicalMissRecovery: historicalMissIndexes.length ? recoveredHistoricalMisses / historicalMissIndexes.length : 0,
    byType,
    falsePositives: classifications.filter((item) => item.classification === "FALSE_POSITIVE").map((item) => item.entity),
    typeMismatches: classifications.filter((item) => item.classification === "TYPE_MISMATCH").map((item) => ({ ...item.entity, expectedType: item.reference?.reference_type })),
    ambiguous: classifications.filter((item) => item.classification === "AMBIGUOUS").map((item) => item.entity),
    missed: references.filter((_, index) => !matchedReferences.has(index)).map((item) => ({
      name: item.name,
      type: item.reference_type,
      historicallyMissed: item.historically_missed,
    })),
  };
}

type Evaluation = ReturnType<typeof evaluateEntities>;

function aggregateEvaluations(evaluations: Evaluation[]) {
  const expected = evaluations.reduce((total, item) => total + item.expected, 0);
  const distinctExtracted = evaluations.reduce((total, item) => total + item.distinctExtracted, 0);
  const truePositives = evaluations.reduce((total, item) => total + item.truePositives, 0);
  const precision = distinctExtracted ? truePositives / distinctExtracted : 0;
  const recall = expected ? truePositives / expected : 0;
  const historicalMisses = evaluations.reduce((total, item) => total + item.historicalMisses, 0);
  const recoveredHistoricalMisses = evaluations.reduce((total, item) => total + item.recoveredHistoricalMisses, 0);
  const typeNames = [...new Set(evaluations.flatMap((item) => Object.keys(item.byType)))].sort();
  return {
    expected,
    distinctExtracted,
    truePositives,
    precision,
    recall,
    f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    historicalMisses,
    recoveredHistoricalMisses,
    historicalMissRecovery: historicalMisses ? recoveredHistoricalMisses / historicalMisses : 0,
    byType: Object.fromEntries(typeNames.map((type) => {
      const expectedForType = evaluations.reduce((total, item) => total + (item.byType[type]?.expected ?? 0), 0);
      const recalled = evaluations.reduce((total, item) => total + (item.byType[type]?.recalled ?? 0), 0);
      return [type, { expected: expectedForType, recalled, recall: expectedForType ? recalled / expectedForType : 0 }];
    })),
    falsePositives: evaluations.flatMap((item) => item.falsePositives),
    typeMismatches: evaluations.flatMap((item) => item.typeMismatches),
    ambiguous: evaluations.flatMap((item) => item.ambiguous),
    missed: evaluations.flatMap((item) => item.missed),
  };
}

function compactEvaluation(evaluation: Evaluation) {
  return {
    ...evaluation,
    falsePositives: evaluation.falsePositives.map((item) => `${item.name} (${item.type}, chunk ${item.chunk})`),
    typeMismatches: evaluation.typeMismatches.map((item) => `${item.name} (${item.type} -> ${item.expectedType}, chunk ${item.chunk})`),
    ambiguous: evaluation.ambiguous.map((item) => `${item.name} (${item.type}, chunk ${item.chunk})`),
    missed: evaluation.missed.map((item) => `${item.name} (${item.type}${item.historicallyMissed ? ", historical miss" : ""})`),
  };
}

function metricSummary(evaluation: Evaluation) {
  const { expected, distinctExtracted, truePositives, precision, recall, f1, historicalMisses, recoveredHistoricalMisses, historicalMissRecovery, byType } = evaluation;
  return { expected, distinctExtracted, truePositives, precision, recall, f1, historicalMisses, recoveredHistoricalMisses, historicalMissRecovery, byType };
}

function extractionEntities(chunk: number, output: ChunkExtraction): EvaluatedEntity[] {
  return output.entities.map((entity) => ({
    name: entity.name,
    type: entity.type,
    aliases: entity.aliases,
    facts: entity.facts.length,
    evidence: entity.sources.length + entity.facts.reduce((total, fact) => total + fact.sources.length, 0),
    summaryCharacters: entity.summary.length,
    chunk,
  }));
}

function outputMetrics(output: ChunkExtraction) {
  const serialized = JSON.stringify(output);
  return {
    outputCharacters: serialized.length,
    outputBytes: Buffer.byteLength(serialized, "utf8"),
    entities: output.entities.length,
    facts: output.entities.reduce((total, entity) => total + entity.facts.length, 0),
    evidence: output.entities.reduce((total, entity) => total + entity.sources.length + entity.facts.reduce((factTotal, fact) => factTotal + fact.sources.length, 0), 0)
      + output.relationships.reduce((total, relationship) => total + relationship.sources.length, 0),
    relationships: output.relationships.length,
    summaryCharacters: output.entities.reduce((total, entity) => total + entity.summary.length, 0),
    entitiesWithAtMostOneFact: output.entities.filter((entity) => entity.facts.length <= 1).length,
  };
}

function callSummary(call: CallArtifact) {
  return {
    attemptNumber: call.attemptNumber,
    requestedModel: call.requestedModel,
    responseModel: call.responseModel,
    responseId: call.responseId,
    responseStatus: call.responseStatus,
    incompleteDetails: call.incompleteDetails,
    latencyMs: call.latencyMs,
    valid: call.valid,
    usage: call.usage,
    validationDiagnosticCount: call.validationDiagnostics.length,
  };
}

const sumKnown = (values: Array<number | null>) => values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);

async function main() {
  const { createAdminClient } = await import("../lib/db/client");
  const client = createAdminClient();
  const cacheResult = await client.from("extraction_cache_chunks").select("chunk_index,validated_output,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,total_tokens,estimated_cost_usd,response_id,model").eq("cache_run_id", CACHE_ID).order("chunk_index");
  if (cacheResult.error || !cacheResult.data) throw cacheResult.error ?? new Error("Historical cache unavailable");

  const perChunk: Array<Record<string, unknown>> = [];
  const perChunkSummary: Array<Record<string, unknown>> = [];
  const combined = new Map<Variant, { references: ReferenceIdentity[]; entities: EvaluatedEntity[]; outputs: ChunkExtraction[]; calls: CallArtifact[] }>();
  const evaluationsByVariant = new Map<Variant, Evaluation[]>();
  for (const variant of variants) combined.set(variant, { references: [], entities: [], outputs: [], calls: [] });
  for (const variant of variants) evaluationsByVariant.set(variant, []);

  for (const chunk of reference.chunks) {
    const historicalRow = cacheResult.data.find((row) => row.chunk_index + 1 === chunk.chunk_number);
    if (!historicalRow) throw new Error(`Historical chunk ${chunk.chunk_number} unavailable`);
    const historicalOutput = historicalRow.validated_output as unknown as ChunkExtraction;
    const luna = JSON.parse(readFileSync(new URL(`../artifacts/extraction-ab/chunk-${chunk.chunk_number}-luna.json`, import.meta.url), "utf8")) as CallArtifact;
    const terra = JSON.parse(readFileSync(new URL(`../artifacts/extraction-ab/chunk-${chunk.chunk_number}-terra.json`, import.meta.url), "utf8")) as CallArtifact;
    if (!luna.valid || !terra.valid) throw new Error(`A/B call failed for chunk ${chunk.chunk_number}`);
    const outputs: Record<Variant, ChunkExtraction> = { historical: historicalOutput, luna: luna.validatedOutput, terra: terra.validatedOutput };
    const evaluations = Object.fromEntries(variants.map((variant) => [variant, evaluateEntities(chunk.expected_identities, extractionEntities(chunk.chunk_number, outputs[variant]))]));
    perChunk.push({
      chunk: chunk.chunk_number,
      pages: chunk.page_range,
      expected: chunk.expected_identities.length,
      historicalMisses: chunk.expected_identities.filter((item) => item.historically_missed).length,
      evaluations: Object.fromEntries(variants.map((variant) => [variant, compactEvaluation(evaluations[variant] as Evaluation)])),
      outputMetrics: Object.fromEntries(variants.map((variant) => [variant, outputMetrics(outputs[variant])])),
      calls: { luna: callSummary(luna), terra: callSummary(terra) },
      historicalUsage: {
        responseId: historicalRow.response_id,
        model: historicalRow.model,
        inputTokens: historicalRow.input_tokens,
        cachedInputTokens: historicalRow.cached_input_tokens,
        cacheWriteTokens: historicalRow.cache_write_tokens,
        outputTokens: historicalRow.output_tokens,
        totalTokens: historicalRow.total_tokens,
        estimatedCostUsd: historicalRow.estimated_cost_usd,
      },
    });
    perChunkSummary.push({
      chunk: chunk.chunk_number,
      pages: chunk.page_range,
      evaluations: Object.fromEntries(variants.map((variant) => [variant, metricSummary(evaluations[variant] as Evaluation)])),
      outputMetrics: Object.fromEntries(variants.map((variant) => [variant, outputMetrics(outputs[variant])])),
    });
    for (const variant of variants) {
      evaluationsByVariant.get(variant)!.push(evaluations[variant] as Evaluation);
      const target = combined.get(variant)!;
      target.references.push(...chunk.expected_identities);
      target.entities.push(...extractionEntities(chunk.chunk_number, outputs[variant]));
      target.outputs.push(outputs[variant]);
      if (variant === "luna") target.calls.push(luna);
      if (variant === "terra") target.calls.push(terra);
    }
  }

  const overall = Object.fromEntries(variants.map((variant) => {
    const data = combined.get(variant)!;
    const occurrenceEvaluation = aggregateEvaluations(evaluationsByVariant.get(variant)!);
    const uniqueReferenceMap = new Map<string, ReferenceIdentity>();
    for (const item of data.references) {
      const key = `${item.reference_type}:${normalizeName(item.name)}`;
      const existing = uniqueReferenceMap.get(key);
      uniqueReferenceMap.set(key, existing ? { ...existing, historically_missed: existing.historically_missed || item.historically_missed } : item);
    }
    const uniqueEvaluation = evaluateEntities([...uniqueReferenceMap.values()], data.entities);
    const metrics = data.outputs.map(outputMetrics);
    const calls = data.calls;
    return [variant, {
      occurrenceWeighted: compactEvaluation(occurrenceEvaluation),
      occurrenceSummary: metricSummary(occurrenceEvaluation),
      uniqueIdentity: compactEvaluation(uniqueEvaluation),
      richness: {
        facts: metrics.reduce((total, item) => total + item.facts, 0),
        evidence: metrics.reduce((total, item) => total + item.evidence, 0),
        relationships: metrics.reduce((total, item) => total + item.relationships, 0),
        summaryCharacters: metrics.reduce((total, item) => total + item.summaryCharacters, 0),
        entitiesWithAtMostOneFact: metrics.reduce((total, item) => total + item.entitiesWithAtMostOneFact, 0),
      },
      usage: variant === "historical" ? {
        inputTokens: cacheResult.data.filter((row) => reference.chunks.some((chunk) => chunk.chunk_number === row.chunk_index + 1)).reduce((total, row) => total + (row.input_tokens ?? 0), 0),
        outputTokens: cacheResult.data.filter((row) => reference.chunks.some((chunk) => chunk.chunk_number === row.chunk_index + 1)).reduce((total, row) => total + (row.output_tokens ?? 0), 0),
        totalTokens: cacheResult.data.filter((row) => reference.chunks.some((chunk) => chunk.chunk_number === row.chunk_index + 1)).reduce((total, row) => total + (row.total_tokens ?? 0), 0),
        estimatedCostUsd: null,
      } : {
        inputTokens: sumKnown(calls.map((call) => call.usage.inputTokens)),
        cachedInputTokens: sumKnown(calls.map((call) => call.usage.cachedInputTokens)),
        cacheWriteTokens: sumKnown(calls.map((call) => call.usage.cacheWriteTokens)),
        outputTokens: sumKnown(calls.map((call) => call.usage.outputTokens)),
        totalTokens: sumKnown(calls.map((call) => call.usage.totalTokens)),
        estimatedCostUsd: sumKnown(calls.map((call) => call.usage.estimatedCostUsd)),
        latencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
      },
    }];
  }));

  const result = {
    evaluation: "controlled Luna vs Terra extraction A/B",
    applicationAttempts: 6,
    sdkRetries: 0,
    campaignWrites: 0,
    reconciliationCalls: 0,
    enrichmentCalls: 0,
    selectedChunks: reference.chunks.map((chunk) => chunk.chunk_number),
    perChunk,
    overall,
  };
  if (process.argv.includes("--summary")) {
    console.log(JSON.stringify({ ...result, perChunk: perChunkSummary, overall: Object.fromEntries(variants.map((variant) => {
      const entry = overall[variant];
      return [variant, { occurrenceWeighted: entry.occurrenceSummary, richness: entry.richness, usage: entry.usage }];
    })) }, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

void main();
