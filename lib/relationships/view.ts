export interface RelationshipRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  description: string;
  confidence: number;
}

const inverseLabels: Record<string, string> = {
  owns: "owned by",
  "member of": "has member",
  "sibling of": "sibling of",
  "located in": "contains",
  "created by": "created",
  serves: "served by",
  needs: "needed by",
};

export function relationshipsForEntity<T extends RelationshipRow>(relationships: T[], entityId: string) {
  return relationships
    .filter((relationship) => relationship.source_entity_id === entityId || relationship.target_entity_id === entityId)
    .map((relationship) => {
      const outgoing = relationship.source_entity_id === entityId;
      return {
        ...relationship,
        outgoing,
        relatedEntityId: outgoing ? relationship.target_entity_id : relationship.source_entity_id,
        displayLabel: outgoing
          ? relationship.relationship_type
          : (inverseLabels[relationship.relationship_type.toLocaleLowerCase("en-US")] ?? `connected via ${relationship.relationship_type}`),
      };
    });
}
