import type { CandidateAggregate, CanonicalGraph } from "@/lib/graph/types";
import { FACT_FIELD_KEYS_BY_ENTITY_TYPE } from "@/lib/knowledge/fields";
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
  const entityByKey = new Map(graph.entities.map((entity) => [entity.key, entity]));
  const factCountsByEntityType = Object.fromEntries(graph.entities.map((entity) => [entity.type, 0]));
  for (const fact of graph.facts) {
    const entity = entityByKey.get(fact.entityKey);
    if (entity) factCountsByEntityType[entity.type] = (factCountsByEntityType[entity.type] ?? 0) + 1;
  }
  const eventFacts = graph.facts.filter((fact) => entityByKey.get(fact.entityKey)?.type === "event");
  const chronologyFields = new Set(["exact_date", "relative_chronology", "chronology_context", "chronology_sequence", "chronology_uncertainty"]);
  const eventsWithChronology = new Set(eventFacts.filter((fact) => chronologyFields.has(fact.fieldKey)).map((fact) => fact.entityKey));
  const eventCount = graph.entities.filter((entity) => entity.type === "event").length;
  const supportedFactSlots = graph.entities.reduce((total, entity) => total + FACT_FIELD_KEYS_BY_ENTITY_TYPE[entity.type].length, 0);
  const populatedFactFields = new Set(graph.facts.map((fact) => `${fact.entityKey}:${fact.fieldKey}`)).size;
  return {
    candidateEntityCount: aggregate.entities.length,
    canonicalEntityCount: graph.entities.length,
    duplicateCandidatesResolved: aggregate.entities.length - graph.entities.length,
    ...graph.factAggregationDiagnostics,
    candidateRelationshipCount: aggregate.relationships.length,
    relationshipsCreated: graph.relationships.length,
    relationshipsDeduplicatedOrDiscarded: aggregate.relationships.length - graph.relationships.length,
    rejectedRelationshipCount: graph.discardedRelationships.length,
    entitySourceEvidenceCount: graph.entities.reduce((count, entity) => count + entity.sources.length, 0),
    factEvidenceCount: graph.facts.reduce((count, fact) => count + fact.evidence.length, 0),
    relationshipSourceEvidenceCount: graph.relationships.reduce((count, relationship) => count + relationship.sources.length, 0),
    hierarchyEdges: hierarchy.selectedRelationshipIds.size,
    hierarchyRoots: hierarchy.getRoots().length,
    entityTypeCounts,
    factCountsByEntityType,
    roleCounts,
    chronologyCoverage: { knownEvents: eventsWithChronology.size, unknownEvents: eventCount - eventsWithChronology.size, totalEvents: eventCount },
    // The denominator is each canonical entity's allowed rich-fact keys, not text fields in the UI.
    richFactFieldCoverage: { populatedFields: populatedFactFields, supportedSlots: supportedFactSlots, emptyOrUnsupportedSlots: supportedFactSlots - populatedFactFields },
  };
}
