import { normalizeRelationshipType } from "@/lib/graph/normalize";

/** Semantic equivalence and inverse direction are decided by the bounded,
 * evidence-aware relationship reconciliation stage. This layer only performs
 * whitespace/case normalization for stable instance identity. */
export interface NormalizedRelationshipFact {
  sourceId: string; targetId: string; semanticType: string; canonicalType: string;
  forwardLabel: string; inverseLabel: string; normalizedInputType: string;
  knownInverse: boolean; reversed: boolean; directional: boolean; symmetric: boolean;
}

export interface RelationshipPresentation { relationshipType: string; forwardLabel: string; inverseLabel: string; }

export function normalizeRelationshipFact(sourceId: string, targetId: string, relationshipType: string): NormalizedRelationshipFact {
  const canonicalType = relationshipType.trim().replace(/\s+/gu, " ");
  const normalizedInputType = normalizeRelationshipType(canonicalType);
  return {
    sourceId, targetId, semanticType: `literal:${normalizedInputType}`, canonicalType,
    forwardLabel: canonicalType, inverseLabel: canonicalType, normalizedInputType,
    knownInverse: false, reversed: false, directional: true, symmetric: false,
  };
}

export function relationshipPresentation(facts: NormalizedRelationshipFact[]): RelationshipPresentation {
  const first = facts[0];
  if (!first) throw new Error("At least one relationship fact is required");
  return { relationshipType: first.canonicalType, forwardLabel: first.canonicalType, inverseLabel: first.canonicalType };
}

export function relationshipSemanticKey(fact: NormalizedRelationshipFact): string {
  return `${fact.sourceId}|${fact.targetId}|${fact.semanticType}`;
}
