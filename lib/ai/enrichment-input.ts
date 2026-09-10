import { createHash } from "node:crypto";
import type { SourceEvidence } from "@/lib/ai/schemas";
import type { CanonicalGraph } from "@/lib/graph/types";

export interface EvidenceCatalogEntry {
  id: string;
  ownerKey: string;
  source: SourceEvidence;
}

function evidenceId(ownerKind: string, ownerKey: string, source: SourceEvidence, index: number) {
  return `${ownerKind}:${ownerKey}:${source.page_number}:${index}`;
}

export function buildEvidenceCatalog(graph: CanonicalGraph): EvidenceCatalogEntry[] {
  return [
    ...graph.entities.flatMap((entity) => entity.sources.map((source, index) => ({ id: evidenceId("entity", entity.key, source, index), ownerKey: entity.key, source }))),
    ...graph.facts.flatMap((fact) => fact.evidence.flatMap((source, index) => source.pageNumber && source.supportingText ? [{
      id: evidenceId("fact", `${fact.entityKey}:${fact.stableKey}`, { page_number: source.pageNumber, supporting_text: source.supportingText }, index),
      ownerKey: `${fact.entityKey}:${fact.stableKey}`,
      source: { page_number: source.pageNumber, supporting_text: source.supportingText },
    }] : [])),
    ...graph.relationships.flatMap((relationship) => relationship.sources.map((source, index) => ({ id: evidenceId("relationship", relationship.key, source, index), ownerKey: relationship.key, source }))),
  ];
}

function sortedGraphProjection(graph: CanonicalGraph) {
  return {
    entities: graph.entities.map(({ key, name, type, roles, aliases, sources }) => ({ key, name, type, roles, aliases, sources })).sort((a, b) => a.key.localeCompare(b.key)),
    facts: graph.facts.map(({ entityKey, stableKey, fieldKey, content, evidence }) => ({ entityKey, stableKey, fieldKey, content, evidence })).sort((a, b) => a.stableKey.localeCompare(b.stableKey)),
    relationships: graph.relationships.map(({ key, sourceEntityKey, targetEntityKey, relationshipType, description, sources }) => ({ key, sourceEntityKey, targetEntityKey, relationshipType, description, sources })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function enrichmentGraphFingerprint(graph: CanonicalGraph): string {
  return createHash("sha256").update(JSON.stringify(sortedGraphProjection(graph))).digest("hex");
}

export function buildClassificationInput(graph: CanonicalGraph) {
  const catalog = buildEvidenceCatalog(graph);
  return {
    entities: graph.entities.map((entity) => ({ key: entity.key, name: entity.name, type: entity.type, roles: entity.roles, aliases: entity.aliases, evidence: catalog.filter((item) => item.ownerKey === entity.key) })),
    facts: graph.facts.map((fact) => ({ key: `${fact.entityKey}:${fact.stableKey}`, entity_key: fact.entityKey, stable_key: fact.stableKey, field: fact.fieldKey, content: fact.content, evidence: catalog.filter((item) => item.ownerKey === `${fact.entityKey}:${fact.stableKey}`) })),
    relationships: graph.relationships.map((relationship) => ({ key: relationship.key, source_entity_key: relationship.sourceEntityKey, target_entity_key: relationship.targetEntityKey, type: relationship.relationshipType, description: relationship.description, evidence: catalog.filter((item) => item.ownerKey === relationship.key) })),
  };
}

export function buildEntityClassificationInput(graph: CanonicalGraph) {
  const input = buildClassificationInput(graph);
  return { entities: input.entities, campaign_context: { entity_count: graph.entities.length, fact_count: graph.facts.length, relationship_count: graph.relationships.length } };
}

export function buildFactVisibilityInput(graph: CanonicalGraph) {
  return buildClassificationInput(graph).facts;
}

export function buildRelationshipVisibilityInput(graph: CanonicalGraph) {
  const input = buildClassificationInput(graph);
  const names = new Map(input.entities.map((entity) => [entity.key, entity.name]));
  return input.relationships.map((relationship) => ({ ...relationship, source_name: names.get(relationship.source_entity_key), target_name: names.get(relationship.target_entity_key) }));
}

export function buildEntitySummaryInput(graph: CanonicalGraph, mode: "gm" | "player") {
  const visibleEntities = new Set(graph.entities.filter((entity) => mode === "gm" || entity.visibility === "player_visible").map((entity) => entity.key));
  const catalog = buildEvidenceCatalog(graph);
  return graph.entities.filter((entity) => visibleEntities.has(entity.key)).map((entity) => ({
    key: entity.key,
    name: entity.name,
    type: entity.type,
    evidence: catalog.filter((item) => item.ownerKey === entity.key),
    facts: graph.facts.filter((fact) => fact.entityKey === entity.key && (mode === "gm" || fact.visibility === "player_visible")).map((fact) => ({ key: fact.stableKey, field: fact.fieldKey, content: fact.content, evidence: catalog.filter((item) => item.ownerKey === `${fact.entityKey}:${fact.stableKey}`) })),
    relationships: graph.relationships.filter((relationship) => (relationship.sourceEntityKey === entity.key || relationship.targetEntityKey === entity.key) && (mode === "gm" || (relationship.visibility === "player_visible" && visibleEntities.has(relationship.sourceEntityKey) && visibleEntities.has(relationship.targetEntityKey)))).map((relationship) => ({ key: relationship.key, source: relationship.sourceEntityKey, target: relationship.targetEntityKey, type: relationship.relationshipType, description: relationship.description, evidence: catalog.filter((item) => item.ownerKey === relationship.key) })),
  }));
}

export function buildCampaignOverviewInput(graph: CanonicalGraph, mode: "gm" | "player") {
  return { entities: buildEntitySummaryInput(graph, mode).map((entity) => ({ ...entity, summary: graph.entities.find((item) => item.key === entity.key)?.[mode === "gm" ? "gmSummary" : "playerSummary"] ?? null })) };
}
