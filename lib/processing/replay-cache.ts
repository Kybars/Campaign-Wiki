import { chunkExtractionSchema, reconciliationDecisionSchema, type ReconciliationDecision } from "@/lib/ai/schemas";
import type { Json } from "@/lib/db/types";
import { aggregateCandidates } from "@/lib/graph/aggregate";
import type { DeterministicGroup } from "@/lib/graph/types";
import { RICH_EXTRACTION_CACHE_SCHEMA_VERSION } from "@/lib/processing/cache-version";

export interface CachedChunkPayload {
  chunk_id: string;
  validated_output: Json;
}

function withLegacyEntityFields(value: Json, cacheSchemaVersion: number): Json {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  const entities = Array.isArray(value.entities)
    ? value.entities.map((entity) => {
        if (!entity || Array.isArray(entity) || typeof entity !== "object") return entity;
        return {
          ...entity,
          roles: Array.isArray(entity.roles) ? entity.roles : [],
          facts: cacheSchemaVersion < RICH_EXTRACTION_CACHE_SCHEMA_VERSION && !Array.isArray(entity.facts)
            ? []
            : entity.facts,
        };
      })
    : value.entities;
  return { ...value, entities };
}

function withLegacyReconciliationFields(value: Json, groups: DeterministicGroup[]): Json {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  const canonicalEntities = Array.isArray(value.canonical_entities)
    ? value.canonical_entities.map((entity) => {
        if (!entity || Array.isArray(entity) || typeof entity !== "object") return entity;
        let type = entity.type;
        if (typeof type !== "string") {
          const groupIds = Array.isArray(entity.group_ids)
            ? entity.group_ids.filter((groupId): groupId is string => typeof groupId === "string")
            : [];
          const matchingTypes = new Set(groups.filter((group) => groupIds.includes(group.id)).map((group) => group.type));
          if (matchingTypes.size !== 1) {
            throw new Error("Legacy reconciliation decision has no unambiguous canonical type; refresh reconciliation to replay it safely");
          }
          type = [...matchingTypes][0];
        }
        return {
          ...entity,
          type,
          roles: Array.isArray(entity.roles) ? entity.roles : [],
          identity_evidence: Array.isArray(entity.identity_evidence) ? entity.identity_evidence : [],
        };
      })
    : value.canonical_entities;
  return { ...value, canonical_entities: canonicalEntities };
}

export function aggregateCachedChunks(chunks: CachedChunkPayload[], cacheSchemaVersion = 1) {
  if (chunks.length === 0) throw new Error("Extraction cache contains no chunks");
  return aggregateCandidates(chunks.map((chunk) => ({
    chunkId: chunk.chunk_id,
    ...chunkExtractionSchema.parse(withLegacyEntityFields(chunk.validated_output, cacheSchemaVersion)),
  })));
}

export function parseCachedReconciliation(
  decision: Json,
  groups: DeterministicGroup[] = [],
): ReconciliationDecision | undefined {
  return decision === null ? undefined : reconciliationDecisionSchema.parse(withLegacyReconciliationFields(decision, groups));
}
