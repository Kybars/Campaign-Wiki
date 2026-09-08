import type { ReconciliationDecision } from "@/lib/ai/schemas";
import { applyReconciliation, buildDeterministicGroups } from "@/lib/graph/reconcile";
import { resolveRelationships } from "@/lib/graph/relationships";
import type { CandidateAggregate, CanonicalGraph } from "@/lib/graph/types";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";

export function buildCanonicalGraph(aggregate: CandidateAggregate, decision?: ReconciliationDecision): CanonicalGraph {
  const groups = buildDeterministicGroups(aggregate);
  const reconciled = applyReconciliation(groups, decision);
  const resolved = resolveRelationships(aggregate, reconciled.candidateToCanonical);
  const hierarchy = buildLocationHierarchy(
    reconciled.entities
      .filter((entity) => entity.type === "location")
      .map((entity) => ({ id: entity.key, name: entity.name })),
    resolved.relationships.map((relationship) => ({
      id: relationship.key,
      sourceId: relationship.sourceEntityKey,
      targetId: relationship.targetEntityKey,
      relationshipType: relationship.relationshipType,
      confidence: relationship.confidence,
    })),
  );
  const relationships = resolved.relationships.filter((relationship) =>
    !hierarchy.consideredRelationshipIds.has(relationship.key)
    || hierarchy.selectedRelationshipIds.has(relationship.key),
  );
  return {
    entities: reconciled.entities,
    relationships,
    facts: [],
    discardedRelationships: [
      ...resolved.discarded,
      ...hierarchy.diagnostics.map((item) => ({ id: item.relationshipId, reason: item.reason })),
    ],
    locationHierarchyDiagnostics: hierarchy.diagnostics,
    candidateToCanonical: reconciled.candidateToCanonical,
  };
}
