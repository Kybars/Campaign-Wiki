import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/ai/client";
import { campaignOverviewSchema, entityClassificationSchema, entitySummariesSchema, factVisibilitySchema, relationshipVisibilitySchema, type CampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import { buildCampaignOverviewInput, buildEntityClassificationInput, buildEntitySummaryInput, buildFactVisibilityInput, buildRelationshipVisibilityInput } from "@/lib/ai/enrichment-input";
import { ENTITY_CLASSIFICATION_SYSTEM_PROMPT, FACT_VISIBILITY_SYSTEM_PROMPT, GM_OVERVIEW_SYSTEM_PROMPT, GM_SUMMARY_SYSTEM_PROMPT, PLAYER_OVERVIEW_SYSTEM_PROMPT, PLAYER_SUMMARY_SYSTEM_PROMPT, RELATIONSHIP_VISIBILITY_SYSTEM_PROMPT } from "@/lib/ai/enrichment-prompts";
import { modelCallUsage, type ModelCallUsage } from "@/lib/ai/usage";
import { getOpenAIEnv } from "@/lib/env";
import { applyCampaignEnrichment } from "@/lib/graph/enrichment";
import type { CanonicalGraph } from "@/lib/graph/types";

export const ENTITY_SUMMARY_BATCH_SIZE = 12;
export const FACT_CLASSIFICATION_BATCH_SIZE = 100;
export const RELATIONSHIP_CLASSIFICATION_BATCH_SIZE = 60;

export class EnrichmentFailure extends Error {
  constructor(message: string, readonly usage: ModelCallUsage[]) { super(message); }
}

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

type Parse = <T>(system: string, payload: unknown, schema: Parameters<typeof zodTextFormat>[0], name: string) => Promise<{ output: T; usage: ModelCallUsage }>;
const liveParse = async <T>(system: string, payload: unknown, schema: Parameters<typeof zodTextFormat>[0], name: string): Promise<{ output: T; usage: ModelCallUsage }> => {
  const response = await getOpenAIClient().responses.parse({ model: getOpenAIEnv().OPENAI_ENRICHMENT_MODEL, input: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }], text: { format: zodTextFormat(schema, name) } });
  if (!response.output_parsed) throw new Error(`Model returned no parsed ${name} result`);
  return { output: response.output_parsed as T, usage: modelCallUsage(response.model, response.id, response.usage) };
};
async function exactBatch<T extends { [key: string]: unknown }>(parse: Parse, usage: ModelCallUsage[], system: string, payload: unknown, schema: Parameters<typeof zodTextFormat>[0], name: string, field: string, expected: string[], label: string, batchNumber: number, select: (output: T) => { [key: string]: unknown }[], validate?: (output: T) => void) {
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
type EvidenceRecord = { evidence: { id: string }[]; facts?: { evidence: { id: string }[] }[]; relationships?: { evidence: { id: string }[] }[] };
export function evidenceIdsForEntityClassificationInput(entity: EvidenceRecord) { return new Set(entity.evidence.map((evidence) => evidence.id)); }
export function evidenceIdsForSummaryEntityInput(entity: EvidenceRecord) { return new Set([entity.evidence, ...(entity.facts ?? []).map((fact) => fact.evidence), ...(entity.relationships ?? []).map((relationship) => relationship.evidence)].flat().map((evidence) => evidence.id)); }
function evidenceIdsForOverviewInput(input: { entities: EvidenceRecord[] }) { return new Set(input.entities.flatMap((entity) => [...evidenceIdsForSummaryEntityInput(entity)])); }
export function validateOwnedEvidence(ids: string[], allowed: Set<string>, label: string, owner: string) { for (const id of ids) if (!allowed.has(id)) throw new Error(`${label} ${owner} cited unavailable or cross-owner evidence ${id}`); }
async function summarizeBatches(parse: Parse, system: string, input: ReturnType<typeof buildEntitySummaryInput>, name: string, usage: ModelCallUsage[]) {
  const summaries: CampaignEnrichmentOutput["gmSummaries"]["summaries"] = [];
  for (let index = 0; index < input.length; index += ENTITY_SUMMARY_BATCH_SIZE) {
    const batchInput = input.slice(index, index + ENTITY_SUMMARY_BATCH_SIZE);
    const batch = await exactBatch<CampaignEnrichmentOutput["gmSummaries"]>(parse, usage, system, batchInput, entitySummariesSchema, name, "entity_key", batchInput.map((entity) => entity.key), "summary", Math.floor(index / ENTITY_SUMMARY_BATCH_SIZE) + 1, (output) => output.summaries, (output) => {
      const inputByKey = new Map(batchInput.map((entity) => [entity.key, entity]));
      output.summaries.forEach((summary) => validateOwnedEvidence(summary.evidence_ids, evidenceIdsForSummaryEntityInput(inputByKey.get(summary.entity_key)!), `${name} summary`, summary.entity_key));
    });
    summaries.push(...batch.summaries);
  }
  return { summaries };
}
export async function enrichCanonicalGraphWithAI(graph: CanonicalGraph, options: { parse?: Parse } = {}): Promise<{ graph: CanonicalGraph; output: CampaignEnrichmentOutput; usage: ModelCallUsage[] }> {
  const parse = options.parse ?? liveParse; const usage: ModelCallUsage[] = [];
  try {
    const entityInput = buildEntityClassificationInput(graph);
    const entities = await exactBatch<CampaignEnrichmentOutput["classification"]>(parse, usage, ENTITY_CLASSIFICATION_SYSTEM_PROMPT, entityInput, entityClassificationSchema, "entity_classification", "entity_key", graph.entities.map((entity) => entity.key), "entity classification", 1, (output) => output.entities, (output) => {
      const inputByKey = new Map(entityInput.entities.map((entity) => [entity.key, entity]));
      output.entities.forEach((entity) => validateOwnedEvidence(entity.prominence_evidence_ids, evidenceIdsForEntityClassificationInput(inputByKey.get(entity.entity_key)!), "Entity classification", entity.entity_key));
    });
    const factsInput = buildFactVisibilityInput(graph); const facts: CampaignEnrichmentOutput["classification"]["facts"] = [];
    for (let index = 0; index < factsInput.length; index += FACT_CLASSIFICATION_BATCH_SIZE) { const batchInput = factsInput.slice(index, index + FACT_CLASSIFICATION_BATCH_SIZE); const result = await exactBatch<CampaignEnrichmentOutput["classification"]>(parse, usage, FACT_VISIBILITY_SYSTEM_PROMPT, { facts: batchInput }, factVisibilitySchema, "fact_visibility", "fact_key", batchInput.map((fact) => fact.key), "fact classification", Math.floor(index / FACT_CLASSIFICATION_BATCH_SIZE) + 1, (output) => output.facts); facts.push(...result.facts); }
    const relationshipInput = buildRelationshipVisibilityInput(graph); const relationships: CampaignEnrichmentOutput["classification"]["relationships"] = [];
    for (let index = 0; index < relationshipInput.length; index += RELATIONSHIP_CLASSIFICATION_BATCH_SIZE) { const batchInput = relationshipInput.slice(index, index + RELATIONSHIP_CLASSIFICATION_BATCH_SIZE); const result = await exactBatch<CampaignEnrichmentOutput["classification"]>(parse, usage, RELATIONSHIP_VISIBILITY_SYSTEM_PROMPT, { relationships: batchInput }, relationshipVisibilitySchema, "relationship_visibility", "relationship_key", batchInput.map((relationship) => relationship.key), "relationship classification", Math.floor(index / RELATIONSHIP_CLASSIFICATION_BATCH_SIZE) + 1, (output) => output.relationships); relationships.push(...result.relationships); }
    const classification = { entities: entities.entities, facts, relationships };
    const classified = applyCampaignEnrichment(graph, { classification, gmSummaries: { summaries: graph.entities.map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) }, playerSummaries: { summaries: graph.entities.filter((entity) => classification.entities.find((item) => item.entity_key === entity.key)?.visibility === "player_visible").map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) }, gmOverview: { overview: null, evidence_ids: [] }, playerOverview: { overview: null, evidence_ids: [] } });
    const gmSummaries = await summarizeBatches(parse, GM_SUMMARY_SYSTEM_PROMPT, buildEntitySummaryInput(classified, "gm"), "gm_entity_summaries", usage);
    const playerSummaries = await summarizeBatches(parse, PLAYER_SUMMARY_SYSTEM_PROMPT, buildEntitySummaryInput(classified, "player"), "player_entity_summaries", usage);
    const gmInput = buildCampaignOverviewInput({ ...classified, entities: classified.entities.map((entity) => ({ ...entity, gmSummary: gmSummaries.summaries.find((summary) => summary.entity_key === entity.key)?.summary ?? null })) }, "gm");
    const gmOverview = await parse<CampaignEnrichmentOutput["gmOverview"]>(GM_OVERVIEW_SYSTEM_PROMPT, gmInput, campaignOverviewSchema, "gm_campaign_overview"); usage.push(gmOverview.usage); validateOwnedEvidence(gmOverview.output.evidence_ids, evidenceIdsForOverviewInput(gmInput), "GM overview", "campaign");
    const playerInput = buildCampaignOverviewInput({ ...classified, entities: classified.entities.map((entity) => ({ ...entity, playerSummary: playerSummaries.summaries.find((summary) => summary.entity_key === entity.key)?.summary ?? null })) }, "player");
    const playerOverview = await parse<CampaignEnrichmentOutput["playerOverview"]>(PLAYER_OVERVIEW_SYSTEM_PROMPT, playerInput, campaignOverviewSchema, "player_campaign_overview"); usage.push(playerOverview.usage); validateOwnedEvidence(playerOverview.output.evidence_ids, evidenceIdsForOverviewInput(playerInput), "Player overview", "campaign");
    const output = { classification, gmSummaries: { summaries: gmSummaries.summaries }, playerSummaries: { summaries: playerSummaries.summaries }, gmOverview: gmOverview.output, playerOverview: playerOverview.output };
    return { graph: applyCampaignEnrichment(graph, output), output, usage };
  } catch (error) { throw new EnrichmentFailure(error instanceof Error ? error.message : "Unknown enrichment failure", usage); }
}
