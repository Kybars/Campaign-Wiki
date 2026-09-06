import { z } from "zod";

export const entityTypeSchema = z.enum(["npc", "deity", "location", "faction", "item", "event", "quest", "other"]);
export const entityRoleSchema = z.enum(["enemy"]);
export const sourceEvidenceSchema = z.object({
  page_number: z.number().int().positive(),
  supporting_text: z.string().min(8).max(1200),
});

export const candidateEntitySchema = z.object({
  temporary_id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: entityTypeSchema,
  roles: z.array(entityRoleSchema).max(10),
  aliases: z.array(z.string().min(1).max(200)).max(20),
  summary: z.string().min(1).max(1200),
  sources: z.array(sourceEvidenceSchema).min(1).max(20),
});

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
export type CandidateRelationship = z.infer<typeof candidateRelationshipSchema>;
export type ChunkExtraction = z.infer<typeof chunkExtractionSchema>;
export type ReconciliationDecision = z.infer<typeof reconciliationDecisionSchema>;
