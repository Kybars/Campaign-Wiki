import {
  normalizeRelationshipFact,
  relationshipPresentation,
  relationshipSemanticKey,
  type NormalizedRelationshipFact,
} from "@/lib/relationships/normalize";

export interface RelationshipRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  description: string;
  confidence: number;
  resolution_metadata?: unknown;
}

interface StoredNormalization {
  forwardLabel: string;
  inverseLabel: string;
}

function storedNormalization(value: unknown): StoredNormalization | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const normalization = (value as Record<string, unknown>).normalization;
  if (!normalization || typeof normalization !== "object" || Array.isArray(normalization)) return undefined;
  const { forwardLabel, inverseLabel } = normalization as Record<string, unknown>;
  if (typeof forwardLabel !== "string" || typeof inverseLabel !== "string") return undefined;
  return { forwardLabel, inverseLabel };
}

function richerDescription(rows: RelationshipRow[]): string {
  return rows.reduce((best, row) => row.description.length > best.length ? row.description : best, "");
}

export function relationshipsForEntity<T extends RelationshipRow>(relationships: T[], entityId: string) {
  const grouped = new Map<string, Array<{ relationship: T; fact: NormalizedRelationshipFact }>>();

  for (const relationship of relationships) {
    if (relationship.source_entity_id !== entityId && relationship.target_entity_id !== entityId) continue;
    const fact = normalizeRelationshipFact(
      relationship.source_entity_id,
      relationship.target_entity_id,
      relationship.relationship_type,
    );
    const key = relationshipSemanticKey(fact);
    const existing = grouped.get(key) ?? [];
    existing.push({ relationship, fact });
    grouped.set(key, existing);
  }

  return [...grouped.values()].map((entries) => {
    const facts = entries.map((entry) => entry.fact);
    const rows = entries.map((entry) => entry.relationship);
    const first = entries[0];
    const presentation = relationshipPresentation(facts);
    const persistedPresentation = entries
      .map((entry) => storedNormalization(entry.relationship.resolution_metadata))
      .find((value) => value !== undefined);
    const outgoing = first.fact.sourceId === entityId;

    return {
      ...first.relationship,
      source_entity_id: first.fact.sourceId,
      target_entity_id: first.fact.targetId,
      relationship_type: presentation.relationshipType,
      description: richerDescription(rows),
      confidence: Math.max(...rows.map((row) => row.confidence)),
      relationshipIds: rows.map((row) => row.id),
      outgoing,
      relatedEntityId: outgoing ? first.fact.targetId : first.fact.sourceId,
      displayLabel: outgoing
        ? (persistedPresentation?.forwardLabel ?? presentation.forwardLabel)
        : (persistedPresentation?.inverseLabel ?? presentation.inverseLabel),
    };
  });
}
