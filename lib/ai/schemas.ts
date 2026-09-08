import { z } from "zod";
import { FACT_FIELD_KEYS_BY_ENTITY_TYPE, type FactEntityType } from "@/lib/knowledge/fields";

export const entityTypeSchema = z.enum(["npc", "deity", "location", "faction", "item", "event", "quest", "other"]);
export const entityRoleSchema = z.enum(["enemy"]);
export const sourceEvidenceSchema = z.object({
  page_number: z.number().int().positive(),
  supporting_text: z.string().min(8).max(1200),
});

const candidateFactIdentitySchema = z.object({
  temporary_id: z.string().min(1).max(100),
  content: z.string().min(1).max(1600),
  sources: z.array(sourceEvidenceSchema).min(1).max(12),
});

function candidateEntityForType<T extends FactEntityType>(type: T) {
  return z.object({
    temporary_id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    type: z.literal(type),
    roles: z.array(entityRoleSchema).max(10),
    aliases: z.array(z.string().min(1).max(200)).max(20),
    // Retained for v0.2 article/cache compatibility. Rich canonical summaries are
    // deliberately deferred to Milestone 2.
    summary: z.string().min(1).max(1200),
    sources: z.array(sourceEvidenceSchema).min(1).max(20),
    facts: z.array(candidateFactIdentitySchema.extend({
      field_key: z.enum(FACT_FIELD_KEYS_BY_ENTITY_TYPE[type]),
    })).max(80),
  });
}

export const candidateEntitySchema = z.discriminatedUnion("type", [
  candidateEntityForType("npc"),
  candidateEntityForType("deity"),
  candidateEntityForType("location"),
  candidateEntityForType("faction"),
  candidateEntityForType("item"),
  candidateEntityForType("event"),
  candidateEntityForType("quest"),
  candidateEntityForType("other"),
]);

export const candidateRelationshipSchema = z.object({
  source_temporary_id: z.string().min(1).max(100),
  target_temporary_id: z.string().min(1).max(100),
  relationship_type: z.string().min(1).max(100),
  description: z.string().min(1).max(1200),
  confidence: z.number().min(0).max(1),
  sources: z.array(sourceEvidenceSchema).min(1).max(20),
});

export const chunkExtractionSchema = z.object({
  entities: z.array(candidateEntitySchema),
  relationships: z.array(candidateRelationshipSchema),
});

export const reconciliationDecisionSchema = z.object({
  canonical_entities: z.array(
    z.object({
      canonical_id: z.string().min(1),
      name: z.string().min(1).max(200),
      group_ids: z.array(z.string().min(1)).min(1),
      type: entityTypeSchema,
      roles: z.array(entityRoleSchema).max(10),
      aliases: z.array(z.string().min(1).max(200)),
      summary: z.string().min(1).max(1200),
      identity_evidence: z.array(sourceEvidenceSchema).max(20),
    }),
  ),
});

export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;
export type EntityRole = z.infer<typeof entityRoleSchema>;
export type CandidateEntity = z.infer<typeof candidateEntitySchema>;
export type CandidateFact = CandidateEntity["facts"][number];
export type CandidateRelationship = z.infer<typeof candidateRelationshipSchema>;
export type ChunkExtraction = z.infer<typeof chunkExtractionSchema>;
export type ReconciliationDecision = z.infer<typeof reconciliationDecisionSchema>;
