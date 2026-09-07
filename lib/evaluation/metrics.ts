import type { CandidateAggregate, CanonicalGraph } from "@/lib/graph/types";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";

export function buildEvaluationMetrics(aggregate: CandidateAggregate, graph: CanonicalGraph) {
  const hierarchy = buildLocationHierarchy(
    graph.entities.filter((entity) => entity.type === "location").map((entity) => ({ id: entity.key, name: entity.name })),
    graph.relationships.map((relationship) => ({ id: relationship.key, sourceId: relationship.sourceEntityKey, targetId: relationship.targetEntityKey, relationshipType: relationship.relationshipType, confidence: relationship.confidence })),
  );
  const entityTypeCounts = Object.fromEntries(graph.entities.reduce((counts, entity) => {
    counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()));
  const roleCounts = Object.fromEntries(graph.entities.flatMap((entity) => entity.roles).reduce((counts, role) => {
    counts.set(role, (counts.get(role) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()));
  return {
    candidateEntityCount: aggregate.entities.length,
    canonicalEntityCount: graph.entities.length,
    duplicateCandidatesResolved: aggregate.entities.length - graph.entities.length,
    candidateRelationshipCount: aggregate.relationships.length,
    relationshipsCreated: graph.relationships.length,
    relationshipsDeduplicatedOrDiscarded: aggregate.relationships.length - graph.relationships.length,
    rejectedRelationshipCount: graph.discardedRelationships.length,
    entitySourceEvidenceCount: graph.entities.reduce((count, entity) => count + entity.sources.length, 0),
    relationshipSourceEvidenceCount: graph.relationships.reduce((count, relationship) => count + relationship.sources.length, 0),
    hierarchyEdges: hierarchy.selectedRelationshipIds.size,
    hierarchyRoots: hierarchy.getRoots().length,
    entityTypeCounts,
    roleCounts,
  };
}
