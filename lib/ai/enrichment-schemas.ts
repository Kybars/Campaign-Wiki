import { z } from "zod";
import { ENTITY_PROMINENCES, KNOWLEDGE_VISIBILITIES } from "@/lib/knowledge/types";

const visibilitySchema = z.enum(KNOWLEDGE_VISIBILITIES);
const prominenceSchema = z.enum(ENTITY_PROMINENCES);

export const campaignClassificationSchema = z.object({
  entities: z.array(z.object({
    entity_key: z.string().min(1),
    prominence: prominenceSchema,
    prominence_reason: z.string().min(1),
    prominence_evidence_ids: z.array(z.string().min(1)),
    visibility: visibilitySchema,
  })),
  facts: z.array(z.object({ fact_key: z.string().min(1), visibility: visibilitySchema })),
  relationships: z.array(z.object({ relationship_key: z.string().min(1), visibility: visibilitySchema })),
});

export const entityClassificationSchema = z.object({
  entities: campaignClassificationSchema.shape.entities,
});
export const factVisibilitySchema = z.object({
  facts: campaignClassificationSchema.shape.facts,
});
export const relationshipVisibilitySchema = z.object({
  relationships: campaignClassificationSchema.shape.relationships,
});

export const entitySummariesSchema = z.object({
  summaries: z.array(z.object({
    entity_key: z.string().min(1),
    summary: z.string().nullable(),
    evidence_ids: z.array(z.string().min(1)),
  })),
});

export const campaignOverviewSchema = z.object({
  overview: z.string().nullable(),
  evidence_ids: z.array(z.string().min(1)),
});

export type CampaignClassification = z.infer<typeof campaignClassificationSchema>;
export type EntitySummaries = z.infer<typeof entitySummariesSchema>;
export type CampaignOverview = z.infer<typeof campaignOverviewSchema>;

export interface CampaignEnrichmentOutput {
  classification: CampaignClassification;
  gmSummaries: EntitySummaries;
  playerSummaries: EntitySummaries;
  gmOverview: CampaignOverview;
  playerOverview: CampaignOverview;
}

export function parseCampaignEnrichmentOutput(value: unknown): CampaignEnrichmentOutput {
  const record = value as Partial<CampaignEnrichmentOutput>;
  return {
    classification: campaignClassificationSchema.parse(record.classification),
    gmSummaries: entitySummariesSchema.parse(record.gmSummaries),
    playerSummaries: entitySummariesSchema.parse(record.playerSummaries),
    gmOverview: campaignOverviewSchema.parse(record.gmOverview),
    playerOverview: campaignOverviewSchema.parse(record.playerOverview),
  };
}
