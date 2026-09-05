import type { SourceEvidence } from "@/lib/ai/schemas";
import { normalizeRelationshipType } from "@/lib/graph/normalize";
import type { CandidateAggregate, CanonicalRelationship } from "@/lib/graph/types";

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
    const type = candidate.relationship_type.trim();
    const semanticKey = `${source}|${target}|${normalizeRelationshipType(type)}`;
    const existing = bySemanticKey.get(semanticKey);
    if (existing) {
      existing.sources = mergeSources(existing.sources, candidate.sources);
      existing.confidence = Math.max(existing.confidence, candidate.confidence);
      existing.candidateRelationshipIds.push(candidate.id);
      if (candidate.description.length > existing.description.length) existing.description = candidate.description;
      continue;
    }
    bySemanticKey.set(semanticKey, {
      key: `relationship-${bySemanticKey.size + 1}`,
      sourceEntityKey: source,
      targetEntityKey: target,
      relationshipType: type,
      description: candidate.description,
      confidence: candidate.confidence,
      sources: [...candidate.sources],
      candidateRelationshipIds: [candidate.id],
    });
  }
  return { relationships: [...bySemanticKey.values()], discarded };
}
