import { chunkExtractionSchema, reconciliationDecisionSchema, type ReconciliationDecision } from "@/lib/ai/schemas";
import type { Json } from "@/lib/db/types";
import { aggregateCandidates } from "@/lib/graph/aggregate";

export interface CachedChunkPayload {
  chunk_id: string;
  validated_output: Json;
}

function withLegacyEntityRoles(value: Json): Json {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  const entities = Array.isArray(value.entities)
    ? value.entities.map((entity) => {
        if (!entity || Array.isArray(entity) || typeof entity !== "object") return entity;
        return { ...entity, roles: Array.isArray(entity.roles) ? entity.roles : [] };
      })
    : value.entities;
  return { ...value, entities };
}

function withLegacyReconciliationRoles(value: Json): Json {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  const canonicalEntities = Array.isArray(value.canonical_entities)
    ? value.canonical_entities.map((entity) => {
        if (!entity || Array.isArray(entity) || typeof entity !== "object") return entity;
        return { ...entity, roles: Array.isArray(entity.roles) ? entity.roles : [] };
      })
    : value.canonical_entities;
  return { ...value, canonical_entities: canonicalEntities };
}

export function aggregateCachedChunks(chunks: CachedChunkPayload[]) {
  if (chunks.length === 0) throw new Error("Extraction cache contains no chunks");
  return aggregateCandidates(chunks.map((chunk) => ({
    chunkId: chunk.chunk_id,
    ...chunkExtractionSchema.parse(withLegacyEntityRoles(chunk.validated_output)),
  })));
}

export function parseCachedReconciliation(decision: Json): ReconciliationDecision | undefined {
  return decision === null ? undefined : reconciliationDecisionSchema.parse(withLegacyReconciliationRoles(decision));
}
