import type { z } from "zod";
import { campaignOverviewSchema, entityClassificationSchema, entitySummariesSchema, factVisibilitySchema, relationshipVisibilitySchema, type CampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import { buildCampaignOverviewInput, buildEntityClassificationInput, buildEntitySummaryInput, buildFactVisibilityInput, buildRelationshipVisibilityInput } from "@/lib/ai/enrichment-input";
import { ENTITY_CLASSIFICATION_SYSTEM_PROMPT, FACT_VISIBILITY_SYSTEM_PROMPT, GM_OVERVIEW_SYSTEM_PROMPT, GM_SUMMARY_SYSTEM_PROMPT, PLAYER_OVERVIEW_SYSTEM_PROMPT, PLAYER_SUMMARY_SYSTEM_PROMPT, RELATIONSHIP_VISIBILITY_SYSTEM_PROMPT } from "@/lib/ai/enrichment-prompts";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { applyCampaignEnrichment } from "@/lib/graph/enrichment";
import type { CanonicalGraph } from "@/lib/graph/types";
import { ENRICHMENT_BEHAVIOR_VERSION, ENRICHMENT_CONTRACT_VERSION, modelInputHash, type AIOperationCheckpointStore, type AIOperationIdentity } from "@/lib/ai/operation-checkpoint";

export const ENTITY_SUMMARY_BATCH_SIZE = 12;
export const FACT_CLASSIFICATION_BATCH_SIZE = 100;
export const RELATIONSHIP_CLASSIFICATION_BATCH_SIZE = 60;

export class EnrichmentFailure extends Error {
  constructor(message: string, readonly usage: ModelCallUsage[], readonly checkpointReport: EnrichmentCheckpointReport[] = []) { super(message); }
}

export interface EnrichmentCheckpointContext {
  campaignId: string;
  documentId: string;
  sourceExtractionCacheId: string | null;
  processingMode: "full";
  providerId: string;
  modelId: string;
  graphFingerprint: string;
}

export interface EnrichmentCheckpointReport { operationType: string; operationKey: string; status: "REUSE" | "RUN"; reason: string }
export interface EnrichmentResumePlanItem { operationType: string; operationKey: string; status: "REUSE" | "RUN" | "INVALIDATED"; reason: string }

export function expectedEnrichmentCallBreakdown(entityCount: number, factCount: number, relationshipCount: number, playerVisibleEntityCount: number) {
  return { entityClassification: 1, factClassification: Math.ceil(factCount / FACT_CLASSIFICATION_BATCH_SIZE), relationshipClassification: Math.ceil(relationshipCount / RELATIONSHIP_CLASSIFICATION_BATCH_SIZE), gmSummaries: Math.ceil(entityCount / ENTITY_SUMMARY_BATCH_SIZE), playerSummaries: Math.ceil(playerVisibleEntityCount / ENTITY_SUMMARY_BATCH_SIZE), overviews: 2, retries: 0 };
}
export function expectedEnrichmentCallCount(entityCount: number, playerVisibleEntityCount: number, factCount = 0, relationshipCount = 0) {
  return Object.values(expectedEnrichmentCallBreakdown(entityCount, factCount, relationshipCount, playerVisibleEntityCount)).reduce((sum, count) => sum + count, 0);
}

export function validateExactKeys(items: { [key: string]: unknown }[], key: string, expected: string[], label: string, batchNumber: number) {
  const values = items.map((item) => String(item[key]));
  const counts = new Map(values.map((value) => [value, values.filter((item) => item === value).length]));
  const missing = expected.filter((value) => !counts.has(value));
  const duplicate = [...counts].filter(([, count]) => count > 1).map(([value]) => value);
  const unexpected = values.filter((value) => !expected.includes(value));
  if (missing.length || duplicate.length || unexpected.length || values.length !== expected.length) throw new Error(`${label} batch ${batchNumber} exact-key validation failed (expected ${expected.length}, actual ${values.length}; missing: ${missing.join(",") || "none"}; duplicates: ${duplicate.join(",") || "none"}; unexpected: ${[...new Set(unexpected)].join(",") || "none"})`);
}

export type EnrichmentParse = <T>(system: string, payload: unknown, schema: z.ZodType<T>, name: string) => Promise<{ output: T; usage: ModelCallUsage }>;
function providerParse(provider: StructuredModelProvider): EnrichmentParse {
  return async <T>(system: string, payload: unknown, schema: z.ZodType<T>, name: string) => {
    const result = await provider.parseStructured({ system, payload, schema, schemaName: name });
    return { output: result.output, usage: result.usage };
  };
}
async function exactBatch<T extends { [key: string]: unknown }>(parse: EnrichmentParse, usage: ModelCallUsage[], system: string, payload: unknown, schema: z.ZodType<T>, name: string, field: string, expected: string[], label: string, batchNumber: number, select: (output: T) => { [key: string]: unknown }[], validate?: (output: T) => void) {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const correction = label === "entity classification"
      ? " For each entity, prominence evidence may only use IDs in that entity's own evidence array; empty evidence is preferable to unsupported evidence."
      : label === "summary"
        ? " Each summary may cite only evidence inside that entity's supplied record; null with no evidence is preferable to unsupported evidence."
        : "";
    const result = await parse<T>(attempt === 1 ? system : `${system} Correction: return the exact supplied key set once each, with no omissions, duplicates, or extra keys.${correction}`, payload, schema, `${name}_${batchNumber}_attempt_${attempt}`);
    usage.push(result.usage);
    try { validateExactKeys(select(result.output), field, expected, label, batchNumber); validate?.(result.output); return result.output; } catch (error) { lastError = error instanceof Error ? error : new Error("Invalid enrichment batch"); }
  }
  throw lastError!;
}

function enrichmentIdentity(context: EnrichmentCheckpointContext, operationType: string, operationKey: string, system: string, payload: unknown): AIOperationIdentity {
  return { ...context, stage: "enrichment", operationType, operationKey, inputHash: modelInputHash(system, payload), upstreamFingerprint: context.graphFingerprint, behaviorVersion: ENRICHMENT_BEHAVIOR_VERSION, schemaVersion: ENRICHMENT_CONTRACT_VERSION };
}

async function checkpointedExactBatch<T extends { [key: string]: unknown }>(args: {
  parse: EnrichmentParse; usage: ModelCallUsage[]; store?: AIOperationCheckpointStore; context?: EnrichmentCheckpointContext; report: EnrichmentCheckpointReport[];
  system: string; payload: unknown; schema: z.ZodType<T>; name: string; field: string; expected: string[]; label: string; batchNumber: number;
  operationType: string; operationKey: string; select: (output: T) => { [key: string]: unknown }[]; validate?: (output: T) => void;
}) {
  const identity = args.store && args.context ? enrichmentIdentity(args.context, args.operationType, args.operationKey, args.system, args.payload) : undefined;
  if (identity) {
    const checkpoint = await args.store!.load<T>(identity);
    if (checkpoint) {
      try {
        const output = args.schema.parse(checkpoint.output);
        validateExactKeys(args.select(output), args.field, args.expected, args.label, args.batchNumber);
        args.validate?.(output);
        args.report.push({ operationType: args.operationType, operationKey: args.operationKey, status: "REUSE", reason: "exact validated identity" });
        return output;
      } catch (error) {
        await args.store!.saveFailed(identity, checkpoint.usage, `Stored enrichment checkpoint invalid: ${error instanceof Error ? error.message : "unknown validation failure"}`, checkpoint.attemptCount);
      }
    }
  }
  const usageStart = args.usage.length;
  try {
    const output = await exactBatch(args.parse, args.usage, args.system, args.payload, args.schema, args.name, args.field, args.expected, args.label, args.batchNumber, args.select, args.validate);
    const operationUsage = args.usage.slice(usageStart);
    if (identity) await args.store!.saveValidated({ identity, output, usage: operationUsage, attemptCount: operationUsage.length });
    args.report.push({ operationType: args.operationType, operationKey: args.operationKey, status: "RUN", reason: "no compatible validated checkpoint" });
    return output;
  } catch (error) {
    const operationUsage = args.usage.slice(usageStart);
    if (identity) await args.store!.saveFailed(identity, operationUsage, error instanceof Error ? error.message : "Invalid model output", Math.max(1, operationUsage.length));
    throw error;
  }
}

async function checkpointedSingle<T>(args: { parse: EnrichmentParse; usage: ModelCallUsage[]; store?: AIOperationCheckpointStore; context?: EnrichmentCheckpointContext; report: EnrichmentCheckpointReport[]; system: string; payload: unknown; schema: z.ZodType<T>; name: string; operationType: string; validate: (output: T) => void }) {
  const identity = args.store && args.context ? enrichmentIdentity(args.context, args.operationType, "global", args.system, args.payload) : undefined;
  if (identity) {
    const checkpoint = await args.store!.load<T>(identity);
    if (checkpoint) {
      try {
        const output = args.schema.parse(checkpoint.output);
        args.validate(output);
        args.report.push({ operationType: args.operationType, operationKey: "global", status: "REUSE", reason: "exact validated identity" });
        return output;
      } catch (error) {
        await args.store!.saveFailed(identity, checkpoint.usage, `Stored enrichment checkpoint invalid: ${error instanceof Error ? error.message : "unknown validation failure"}`, checkpoint.attemptCount);
      }
    }
  }
  const usageStart = args.usage.length;
  try {
    const result = await args.parse(args.system, args.payload, args.schema, args.name);
    args.usage.push(result.usage);
    args.validate(result.output);
    if (identity) await args.store!.saveValidated({ identity, output: result.output, usage: [result.usage], attemptCount: 1 });
    args.report.push({ operationType: args.operationType, operationKey: "global", status: "RUN", reason: "no compatible validated checkpoint" });
    return result.output;
  } catch (error) {
    if (identity) await args.store!.saveFailed(identity, args.usage.slice(usageStart), error instanceof Error ? error.message : "Invalid model output", 1);
    throw error;
  }
}
type EvidenceRecord = { evidence: { id: string }[]; facts?: { evidence: { id: string }[] }[]; relationships?: { evidence: { id: string }[] }[] };
export function evidenceIdsForEntityClassificationInput(entity: EvidenceRecord) { return new Set(entity.evidence.map((evidence) => evidence.id)); }
export function evidenceIdsForSummaryEntityInput(entity: EvidenceRecord) { return new Set([entity.evidence, ...(entity.facts ?? []).map((fact) => fact.evidence), ...(entity.relationships ?? []).map((relationship) => relationship.evidence)].flat().map((evidence) => evidence.id)); }
function evidenceIdsForOverviewInput(input: { entities: EvidenceRecord[] }) { return new Set(input.entities.flatMap((entity) => [...evidenceIdsForSummaryEntityInput(entity)])); }
export function validateOwnedEvidence(ids: string[], allowed: Set<string>, label: string, owner: string) { for (const id of ids) if (!allowed.has(id)) throw new Error(`${label} ${owner} cited unavailable or cross-owner evidence ${id}`); }

export async function planEnrichmentResume(graph: CanonicalGraph, store: AIOperationCheckpointStore, context: EnrichmentCheckpointContext): Promise<EnrichmentResumePlanItem[]> {
  const plan: EnrichmentResumePlanItem[] = [];
  const inspect = async <T>(operationType: string, operationKey: string, system: string, payload: unknown, schema: z.ZodType<T>, validate: (output: T) => void): Promise<T | undefined> => {
    const identity = enrichmentIdentity(context, operationType, operationKey, system, payload);
    const status = store.inspect ? await store.inspect(identity) : (await store.load(identity) ? { status: "REUSE" as const, reason: "exact validated identity" } : { status: "RUN" as const, reason: "no compatible validated checkpoint" });
    if (status.status !== "REUSE") { plan.push({ operationType, operationKey, ...status }); return undefined; }
    try {
      const checkpoint = await store.load<T>(identity);
      if (!checkpoint) { plan.push({ operationType, operationKey, status: "INVALIDATED", reason: "validated checkpoint disappeared during planning" }); return undefined; }
      const output = schema.parse(checkpoint.output); validate(output);
      plan.push({ operationType, operationKey, ...status }); return output;
    } catch {
      plan.push({ operationType, operationKey, status: "INVALIDATED", reason: "stored output no longer passes validation" }); return undefined;
    }
  };
  const entityInput = buildEntityClassificationInput(graph);
  const entityOutput = await inspect("entity_classification", "global", ENTITY_CLASSIFICATION_SYSTEM_PROMPT, entityInput, entityClassificationSchema, (output) => {
    validateExactKeys(output.entities, "entity_key", graph.entities.map((entity) => entity.key), "entity classification", 1);
    const inputByKey = new Map(entityInput.entities.map((entity) => [entity.key, entity]));
    output.entities.forEach((entity) => validateOwnedEvidence(entity.prominence_evidence_ids, evidenceIdsForEntityClassificationInput(inputByKey.get(entity.entity_key)!), "Entity classification", entity.entity_key));
  });
  const factsInput = buildFactVisibilityInput(graph);
  const factOutputs: z.infer<typeof factVisibilitySchema>["facts"] = [];
  let classificationsReusable = Boolean(entityOutput);
  for (let index = 0; index < factsInput.length; index += FACT_CLASSIFICATION_BATCH_SIZE) {
    const batchIndex = Math.floor(index / FACT_CLASSIFICATION_BATCH_SIZE);
    const batchInput = factsInput.slice(index, index + FACT_CLASSIFICATION_BATCH_SIZE);
    const output = await inspect("fact_visibility", String(batchIndex), FACT_VISIBILITY_SYSTEM_PROMPT, { facts: batchInput }, factVisibilitySchema, (value) => validateExactKeys(value.facts, "fact_key", batchInput.map((fact) => fact.key), "fact classification", batchIndex + 1));
    if (output) factOutputs.push(...output.facts); else classificationsReusable = false;
  }
  const relationshipInput = buildRelationshipVisibilityInput(graph);
  const relationshipOutputs: z.infer<typeof relationshipVisibilitySchema>["relationships"] = [];
  for (let index = 0; index < relationshipInput.length; index += RELATIONSHIP_CLASSIFICATION_BATCH_SIZE) {
    const batchIndex = Math.floor(index / RELATIONSHIP_CLASSIFICATION_BATCH_SIZE);
    const batchInput = relationshipInput.slice(index, index + RELATIONSHIP_CLASSIFICATION_BATCH_SIZE);
    const output = await inspect("relationship_visibility", String(batchIndex), RELATIONSHIP_VISIBILITY_SYSTEM_PROMPT, { relationships: batchInput }, relationshipVisibilitySchema, (value) => validateExactKeys(value.relationships, "relationship_key", batchInput.map((relationship) => relationship.key), "relationship classification", batchIndex + 1));
    if (output) relationshipOutputs.push(...output.relationships); else classificationsReusable = false;
  }
  const unresolved = (operationType: string, count: number, reason: string) => Array.from({ length: count }, (_, index) => plan.push({ operationType, operationKey: String(index), status: "RUN", reason }));
  if (!classificationsReusable || !entityOutput) {
    unresolved("gm_summary", Math.ceil(graph.entities.length / ENTITY_SUMMARY_BATCH_SIZE), "dependency-aware input resolves after classification");
    unresolved("player_summary", Math.ceil(graph.entities.length / ENTITY_SUMMARY_BATCH_SIZE), "upper bound; Player-visible set resolves after classification");
    plan.push({ operationType: "gm_overview", operationKey: "global", status: "RUN", reason: "dependency-aware input resolves after summaries" });
    plan.push({ operationType: "player_overview", operationKey: "global", status: "RUN", reason: "dependency-aware input resolves after summaries" });
    return plan;
  }
  const classification = { entities: entityOutput.entities, facts: factOutputs, relationships: relationshipOutputs };
  const classified = applyCampaignEnrichment(graph, { classification, gmSummaries: { summaries: graph.entities.map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) }, playerSummaries: { summaries: graph.entities.filter((entity) => classification.entities.find((item) => item.entity_key === entity.key)?.visibility === "player_visible").map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) }, gmOverview: { overview: null, evidence_ids: [] }, playerOverview: { overview: null, evidence_ids: [] } });
  const planSummaries = async (mode: "gm" | "player", system: string, operationType: string) => {
    const input = buildEntitySummaryInput(classified, mode); const summaries: CampaignEnrichmentOutput["gmSummaries"]["summaries"] = []; let reusable = true;
    for (let index = 0; index < input.length; index += ENTITY_SUMMARY_BATCH_SIZE) {
      const batchIndex = Math.floor(index / ENTITY_SUMMARY_BATCH_SIZE); const batchInput = input.slice(index, index + ENTITY_SUMMARY_BATCH_SIZE);
      const output = await inspect(operationType, String(batchIndex), system, batchInput, entitySummariesSchema, (value) => {
        validateExactKeys(value.summaries, "entity_key", batchInput.map((entity) => entity.key), "summary", batchIndex + 1);
        const inputByKey = new Map(batchInput.map((entity) => [entity.key, entity]));
        value.summaries.forEach((summary) => validateOwnedEvidence(summary.evidence_ids, evidenceIdsForSummaryEntityInput(inputByKey.get(summary.entity_key)!), `${operationType} summary`, summary.entity_key));
      });
      if (output) summaries.push(...output.summaries); else reusable = false;
    }
    return { summaries, reusable };
  };
  const gm = await planSummaries("gm", GM_SUMMARY_SYSTEM_PROMPT, "gm_summary");
  const player = await planSummaries("player", PLAYER_SUMMARY_SYSTEM_PROMPT, "player_summary");
  if (gm.reusable) {
    const input = buildCampaignOverviewInput({ ...classified, entities: classified.entities.map((entity) => ({ ...entity, gmSummary: gm.summaries.find((summary) => summary.entity_key === entity.key)?.summary ?? null })) }, "gm");
    await inspect("gm_overview", "global", GM_OVERVIEW_SYSTEM_PROMPT, input, campaignOverviewSchema, (output) => validateOwnedEvidence(output.evidence_ids, evidenceIdsForOverviewInput(input), "GM overview", "campaign"));
  } else plan.push({ operationType: "gm_overview", operationKey: "global", status: "RUN", reason: "dependency-aware input resolves after summaries" });
  if (player.reusable) {
    const input = buildCampaignOverviewInput({ ...classified, entities: classified.entities.map((entity) => ({ ...entity, playerSummary: player.summaries.find((summary) => summary.entity_key === entity.key)?.summary ?? null })) }, "player");
    await inspect("player_overview", "global", PLAYER_OVERVIEW_SYSTEM_PROMPT, input, campaignOverviewSchema, (output) => validateOwnedEvidence(output.evidence_ids, evidenceIdsForOverviewInput(input), "Player overview", "campaign"));
  } else plan.push({ operationType: "player_overview", operationKey: "global", status: "RUN", reason: "dependency-aware input resolves after summaries" });
  return plan;
}
async function summarizeBatches(parse: EnrichmentParse, system: string, input: ReturnType<typeof buildEntitySummaryInput>, name: string, usage: ModelCallUsage[], operationType: string, store: AIOperationCheckpointStore | undefined, context: EnrichmentCheckpointContext | undefined, report: EnrichmentCheckpointReport[]) {
  const summaries: CampaignEnrichmentOutput["gmSummaries"]["summaries"] = [];
  for (let index = 0; index < input.length; index += ENTITY_SUMMARY_BATCH_SIZE) {
    const batchInput = input.slice(index, index + ENTITY_SUMMARY_BATCH_SIZE);
    const batchIndex = Math.floor(index / ENTITY_SUMMARY_BATCH_SIZE);
    const batch = await checkpointedExactBatch<CampaignEnrichmentOutput["gmSummaries"]>({ parse, usage, store, context, report, system, payload: batchInput, schema: entitySummariesSchema, name, field: "entity_key", expected: batchInput.map((entity) => entity.key), label: "summary", batchNumber: batchIndex + 1, operationType, operationKey: String(batchIndex), select: (output) => output.summaries, validate: (output) => {
      const inputByKey = new Map(batchInput.map((entity) => [entity.key, entity]));
      output.summaries.forEach((summary) => validateOwnedEvidence(summary.evidence_ids, evidenceIdsForSummaryEntityInput(inputByKey.get(summary.entity_key)!), `${name} summary`, summary.entity_key));
    }});
    summaries.push(...batch.summaries);
  }
  return { summaries };
}
export async function enrichCanonicalGraphWithAI(graph: CanonicalGraph, options: { parse?: EnrichmentParse; provider?: StructuredModelProvider; checkpointStore?: AIOperationCheckpointStore; checkpointContext?: EnrichmentCheckpointContext } = {}): Promise<{ graph: CanonicalGraph; output: CampaignEnrichmentOutput; usage: ModelCallUsage[]; checkpointReport: EnrichmentCheckpointReport[] }> {
  const provider = options.provider ?? (options.parse ? undefined : (await import("@/lib/ai/structured-model-provider-runtime")).getStructuredModelProvider("enrichment"));
  const parse = options.parse ?? providerParse(provider!); const usage: ModelCallUsage[] = []; const checkpointReport: EnrichmentCheckpointReport[] = [];
  try {
    const entityInput = buildEntityClassificationInput(graph);
    const entities = await checkpointedExactBatch<z.infer<typeof entityClassificationSchema>>({ parse, usage, store: options.checkpointStore, context: options.checkpointContext, report: checkpointReport, system: ENTITY_CLASSIFICATION_SYSTEM_PROMPT, payload: entityInput, schema: entityClassificationSchema, name: "entity_classification", field: "entity_key", expected: graph.entities.map((entity) => entity.key), label: "entity classification", batchNumber: 1, operationType: "entity_classification", operationKey: "global", select: (output) => output.entities, validate: (output) => {
      const inputByKey = new Map(entityInput.entities.map((entity) => [entity.key, entity]));
      output.entities.forEach((entity) => validateOwnedEvidence(entity.prominence_evidence_ids, evidenceIdsForEntityClassificationInput(inputByKey.get(entity.entity_key)!), "Entity classification", entity.entity_key));
    }});
    const factsInput = buildFactVisibilityInput(graph); const facts: CampaignEnrichmentOutput["classification"]["facts"] = [];
    for (let index = 0; index < factsInput.length; index += FACT_CLASSIFICATION_BATCH_SIZE) { const batchInput = factsInput.slice(index, index + FACT_CLASSIFICATION_BATCH_SIZE); const batchIndex = Math.floor(index / FACT_CLASSIFICATION_BATCH_SIZE); const result = await checkpointedExactBatch<z.infer<typeof factVisibilitySchema>>({ parse, usage, store: options.checkpointStore, context: options.checkpointContext, report: checkpointReport, system: FACT_VISIBILITY_SYSTEM_PROMPT, payload: { facts: batchInput }, schema: factVisibilitySchema, name: "fact_visibility", field: "fact_key", expected: batchInput.map((fact) => fact.key), label: "fact classification", batchNumber: batchIndex + 1, operationType: "fact_visibility", operationKey: String(batchIndex), select: (output) => output.facts }); facts.push(...result.facts); }
    const relationshipInput = buildRelationshipVisibilityInput(graph); const relationships: CampaignEnrichmentOutput["classification"]["relationships"] = [];
    for (let index = 0; index < relationshipInput.length; index += RELATIONSHIP_CLASSIFICATION_BATCH_SIZE) { const batchInput = relationshipInput.slice(index, index + RELATIONSHIP_CLASSIFICATION_BATCH_SIZE); const batchIndex = Math.floor(index / RELATIONSHIP_CLASSIFICATION_BATCH_SIZE); const result = await checkpointedExactBatch<z.infer<typeof relationshipVisibilitySchema>>({ parse, usage, store: options.checkpointStore, context: options.checkpointContext, report: checkpointReport, system: RELATIONSHIP_VISIBILITY_SYSTEM_PROMPT, payload: { relationships: batchInput }, schema: relationshipVisibilitySchema, name: "relationship_visibility", field: "relationship_key", expected: batchInput.map((relationship) => relationship.key), label: "relationship classification", batchNumber: batchIndex + 1, operationType: "relationship_visibility", operationKey: String(batchIndex), select: (output) => output.relationships }); relationships.push(...result.relationships); }
    const classification = { entities: entities.entities, facts, relationships };
    const classified = applyCampaignEnrichment(graph, { classification, gmSummaries: { summaries: graph.entities.map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) }, playerSummaries: { summaries: graph.entities.filter((entity) => classification.entities.find((item) => item.entity_key === entity.key)?.visibility === "player_visible").map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) }, gmOverview: { overview: null, evidence_ids: [] }, playerOverview: { overview: null, evidence_ids: [] } });
    const gmSummaries = await summarizeBatches(parse, GM_SUMMARY_SYSTEM_PROMPT, buildEntitySummaryInput(classified, "gm"), "gm_entity_summaries", usage, "gm_summary", options.checkpointStore, options.checkpointContext, checkpointReport);
    const playerSummaries = await summarizeBatches(parse, PLAYER_SUMMARY_SYSTEM_PROMPT, buildEntitySummaryInput(classified, "player"), "player_entity_summaries", usage, "player_summary", options.checkpointStore, options.checkpointContext, checkpointReport);
    const gmInput = buildCampaignOverviewInput({ ...classified, entities: classified.entities.map((entity) => ({ ...entity, gmSummary: gmSummaries.summaries.find((summary) => summary.entity_key === entity.key)?.summary ?? null })) }, "gm");
    const gmOverviewOutput = await checkpointedSingle({ parse, usage, store: options.checkpointStore, context: options.checkpointContext, report: checkpointReport, system: GM_OVERVIEW_SYSTEM_PROMPT, payload: gmInput, schema: campaignOverviewSchema, name: "gm_campaign_overview", operationType: "gm_overview", validate: (output) => validateOwnedEvidence(output.evidence_ids, evidenceIdsForOverviewInput(gmInput), "GM overview", "campaign") });
    const playerInput = buildCampaignOverviewInput({ ...classified, entities: classified.entities.map((entity) => ({ ...entity, playerSummary: playerSummaries.summaries.find((summary) => summary.entity_key === entity.key)?.summary ?? null })) }, "player");
    const playerOverviewOutput = await checkpointedSingle({ parse, usage, store: options.checkpointStore, context: options.checkpointContext, report: checkpointReport, system: PLAYER_OVERVIEW_SYSTEM_PROMPT, payload: playerInput, schema: campaignOverviewSchema, name: "player_campaign_overview", operationType: "player_overview", validate: (output) => validateOwnedEvidence(output.evidence_ids, evidenceIdsForOverviewInput(playerInput), "Player overview", "campaign") });
    const output = { classification, gmSummaries: { summaries: gmSummaries.summaries }, playerSummaries: { summaries: playerSummaries.summaries }, gmOverview: gmOverviewOutput, playerOverview: playerOverviewOutput };
    return { graph: applyCampaignEnrichment(graph, output), output, usage, checkpointReport };
  } catch (error) { throw new EnrichmentFailure(error instanceof Error ? error.message : "Unknown enrichment failure", usage, checkpointReport); }
}
