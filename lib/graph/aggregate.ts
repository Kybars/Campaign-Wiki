import type { CandidateAggregate, ChunkCandidateResult } from "@/lib/graph/types";

export function aggregateCandidates(results: ChunkCandidateResult[]): CandidateAggregate {
  const entities = results.flatMap((result) =>
    result.entities.map((entity) => ({
      ...entity,
      id: `${result.chunkId}:${entity.temporary_id}`,
      chunkId: result.chunkId,
      temporaryId: entity.temporary_id,
    })),
  );
  const relationships = results.flatMap((result, resultIndex) =>
    result.relationships.map((relationship, relationshipIndex) => ({
      ...relationship,
      id: `${result.chunkId}:relationship-${resultIndex}-${relationshipIndex}`,
      chunkId: result.chunkId,
      sourceCandidateId: `${result.chunkId}:${relationship.source_temporary_id}`,
      targetCandidateId: `${result.chunkId}:${relationship.target_temporary_id}`,
    })),
  );
  return { entities, relationships };
}
