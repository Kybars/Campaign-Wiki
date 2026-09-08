import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/ai/client";
import { campaignClassificationSchema, campaignOverviewSchema, entitySummariesSchema, type CampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import { buildCampaignOverviewInput, buildClassificationInput, buildEntitySummaryInput } from "@/lib/ai/enrichment-input";
import { CLASSIFICATION_SYSTEM_PROMPT, GM_OVERVIEW_SYSTEM_PROMPT, GM_SUMMARY_SYSTEM_PROMPT, PLAYER_OVERVIEW_SYSTEM_PROMPT, PLAYER_SUMMARY_SYSTEM_PROMPT } from "@/lib/ai/enrichment-prompts";
import { modelCallUsage, type ModelCallUsage } from "@/lib/ai/usage";
import { getOpenAIEnv } from "@/lib/env";
import { applyCampaignEnrichment } from "@/lib/graph/enrichment";
import type { CanonicalGraph } from "@/lib/graph/types";

const ENTITY_SUMMARY_BATCH_SIZE = 12;

export function expectedEnrichmentCallCount(entityCount: number, playerVisibleEntityCount: number) {
  return 3 + Math.ceil(entityCount / ENTITY_SUMMARY_BATCH_SIZE) + Math.ceil(playerVisibleEntityCount / ENTITY_SUMMARY_BATCH_SIZE);
}

async function parse<T>(system: string, payload: unknown, schema: Parameters<typeof zodTextFormat>[0], name: string): Promise<{ output: T; usage: ModelCallUsage }> {
  const response = await getOpenAIClient().responses.parse({
    model: getOpenAIEnv().OPENAI_ENRICHMENT_MODEL,
    input: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }],
    text: { format: zodTextFormat(schema, name) },
  });
  if (!response.output_parsed) throw new Error(`Model returned no parsed ${name} result`);
  return { output: response.output_parsed as T, usage: modelCallUsage(response.model, response.id, response.usage) };
}

async function summarizeBatches(system: string, input: ReturnType<typeof buildEntitySummaryInput>, name: string) {
  const summaries: CampaignEnrichmentOutput["gmSummaries"]["summaries"] = [];
  const usage: ModelCallUsage[] = [];
  for (let index = 0; index < input.length; index += ENTITY_SUMMARY_BATCH_SIZE) {
    const batch = await parse<CampaignEnrichmentOutput["gmSummaries"]>(system, input.slice(index, index + ENTITY_SUMMARY_BATCH_SIZE), entitySummariesSchema, `${name}_${Math.floor(index / ENTITY_SUMMARY_BATCH_SIZE) + 1}`);
    summaries.push(...batch.output.summaries);
    usage.push(batch.usage);
  }
  return { output: { summaries }, usage };
}

export async function enrichCanonicalGraphWithAI(graph: CanonicalGraph): Promise<{ graph: CanonicalGraph; output: CampaignEnrichmentOutput; usage: ModelCallUsage[] }> {
  const classification = await parse<CampaignEnrichmentOutput["classification"]>(CLASSIFICATION_SYSTEM_PROMPT, buildClassificationInput(graph), campaignClassificationSchema, "campaign_knowledge_classification");
  const classified = applyCampaignEnrichment(graph, { classification: classification.output, gmSummaries: { summaries: graph.entities.map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) }, playerSummaries: { summaries: graph.entities.filter((entity) => classification.output.entities.find((item) => item.entity_key === entity.key)?.visibility === "player_visible").map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) }, gmOverview: { overview: null, evidence_ids: [] }, playerOverview: { overview: null, evidence_ids: [] } });
  const gmSummaries = await summarizeBatches(GM_SUMMARY_SYSTEM_PROMPT, buildEntitySummaryInput(classified, "gm"), "gm_entity_summaries");
  const playerSummaries = await summarizeBatches(PLAYER_SUMMARY_SYSTEM_PROMPT, buildEntitySummaryInput(classified, "player"), "player_entity_summaries");
  const gmOverview = await parse<CampaignEnrichmentOutput["gmOverview"]>(GM_OVERVIEW_SYSTEM_PROMPT, buildCampaignOverviewInput({ ...classified, entities: classified.entities.map((entity) => ({ ...entity, gmSummary: gmSummaries.output.summaries.find((summary) => summary.entity_key === entity.key)?.summary ?? null })) }, "gm"), campaignOverviewSchema, "gm_campaign_overview");
  const playerOverview = await parse<CampaignEnrichmentOutput["playerOverview"]>(PLAYER_OVERVIEW_SYSTEM_PROMPT, buildCampaignOverviewInput({ ...classified, entities: classified.entities.map((entity) => ({ ...entity, playerSummary: playerSummaries.output.summaries.find((summary) => summary.entity_key === entity.key)?.summary ?? null })) }, "player"), campaignOverviewSchema, "player_campaign_overview");
  const output = { classification: classification.output, gmSummaries: gmSummaries.output, playerSummaries: playerSummaries.output, gmOverview: gmOverview.output, playerOverview: playerOverview.output };
  return { graph: applyCampaignEnrichment(graph, output), output, usage: [classification.usage, ...gmSummaries.usage, ...playerSummaries.usage, gmOverview.usage, playerOverview.usage] };
}
