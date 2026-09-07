import type { SourceEvidence } from "@/lib/ai/schemas";
import type { CandidateAggregate, CanonicalRelationship } from "@/lib/graph/types";
import {
  normalizeRelationshipFact,
  relationshipPresentation,
  relationshipSemanticKey,
  type NormalizedRelationshipFact,
} from "@/lib/relationships/normalize";

function mergeSources(existing: SourceEvidence[], incoming: SourceEvidence[]): SourceEvidence[] {
  const keys = new Set(existing.map((source) => `${source.page_number}:${source.supporting_text.trim()}`));
  const merged = [...existing];
  for (const source of incoming) {
    const key = `${source.page_number}:${source.supporting_text.trim()}`;
    if (keys.has(key)) continue;
    keys.add(key);
    merged.push(source);
  }
  return merged;
}

export function resolveRelationships(
  aggregate: CandidateAggregate,
  candidateToCanonical: Map<string, string>,
): { relationships: CanonicalRelationship[]; discarded: Array<{ id: string; reason: string }> } {
  const bySemanticKey = new Map<string, CanonicalRelationship>();
  const factsBySemanticKey = new Map<string, NormalizedRelationshipFact[]>();
  const discarded: Array<{ id: string; reason: string }> = [];

  for (const candidate of aggregate.relationships) {
    const source = candidateToCanonical.get(candidate.sourceCandidateId);
    const target = candidateToCanonical.get(candidate.targetCandidateId);
    if (!source || !target) {
      discarded.push({ id: candidate.id, reason: "unresolved endpoint" });
      continue;
    }
    if (source === target) {
      discarded.push({ id: candidate.id, reason: "endpoints reconciled to the same entity" });
      continue;
    }
    const fact = normalizeRelationshipFact(source, target, candidate.relationship_type);
    const semanticKey = relationshipSemanticKey(fact);
    const existing = bySemanticKey.get(semanticKey);
    if (existing) {
      const facts = [...(factsBySemanticKey.get(semanticKey) ?? []), fact];
      factsBySemanticKey.set(semanticKey, facts);
      const presentation = relationshipPresentation(facts);
      existing.sources = mergeSources(existing.sources, candidate.sources);
      existing.confidence = Math.max(existing.confidence, candidate.confidence);
      existing.candidateRelationshipIds.push(candidate.id);
      if (candidate.description.length > existing.description.length) existing.description = candidate.description;
      existing.relationshipType = presentation.relationshipType;
      existing.normalization.forwardLabel = presentation.forwardLabel;
      existing.normalization.inverseLabel = presentation.inverseLabel;
      if (!existing.normalization.originalRelationshipTypes.includes(candidate.relationship_type.trim())) {
        existing.normalization.originalRelationshipTypes.push(candidate.relationship_type.trim());
      }
      if (!existing.normalization.descriptions.includes(candidate.description)) {
        existing.normalization.descriptions.push(candidate.description);
      }
      continue;
    }
    factsBySemanticKey.set(semanticKey, [fact]);
    const presentation = relationshipPresentation([fact]);
    bySemanticKey.set(semanticKey, {
      key: `relationship-${bySemanticKey.size + 1}`,
      sourceEntityKey: fact.sourceId,
      targetEntityKey: fact.targetId,
      relationshipType: presentation.relationshipType,
      description: candidate.description,
      confidence: candidate.confidence,
      sources: [...candidate.sources],
      candidateRelationshipIds: [candidate.id],
      normalization: {
        semanticType: fact.semanticType,
        forwardLabel: presentation.forwardLabel,
        inverseLabel: presentation.inverseLabel,
        originalRelationshipTypes: [candidate.relationship_type.trim()],
        descriptions: [candidate.description],
      },
    });
  }
  return { relationships: [...bySemanticKey.values()], discarded };
}
