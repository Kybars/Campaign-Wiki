import type { ReconciliationDecision } from "@/lib/ai/schemas";
import { applyReconciliation, buildDeterministicGroups } from "@/lib/graph/reconcile";
import { resolveRelationships } from "@/lib/graph/relationships";
import type { CandidateAggregate, CanonicalGraph } from "@/lib/graph/types";

export function buildCanonicalGraph(aggregate: CandidateAggregate, decision?: ReconciliationDecision): CanonicalGraph {
  const groups = buildDeterministicGroups(aggregate);
  const reconciled = applyReconciliation(groups, decision);
  const resolved = resolveRelationships(aggregate, reconciled.candidateToCanonical);
  return {
    entities: reconciled.entities,
    relationships: resolved.relationships,
    discardedRelationships: resolved.discarded,
    candidateToCanonical: reconciled.candidateToCanonical,
  };
}
