import type { SourceEvidence } from "@/lib/ai/schemas";
import type { CampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import { buildEvidenceCatalog } from "@/lib/ai/enrichment-input";
import type { CanonicalGraph, KnowledgeConsistencyDiagnostic } from "@/lib/graph/types";

function exactMap<T extends { [key: string]: unknown }>(items: T[], key: keyof T, expected: string[], label: string) {
  const map = new Map(items.map((item) => [String(item[key]), item]));
  if (map.size !== items.length || map.size !== expected.length || expected.some((id) => !map.has(id))) {
    throw new Error(`Enrichment ${label} assignments must contain every canonical ${label} exactly once`);
  }
  return map;
}

function sourcesFor(ids: string[], allowedIds: Set<string>, catalog: Map<string, SourceEvidence>): SourceEvidence[] {
  const unique = [...new Set(ids)];
  for (const id of unique) if (!allowedIds.has(id) || !catalog.has(id)) throw new Error(`Enrichment cited unavailable evidence ${id}`);
  return unique.map((id) => catalog.get(id)!);
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function mentions(text: string, entity: { name: string; aliases: string[] }) {
  const haystack = ` ${normalized(text)} `;
  return [entity.name, ...entity.aliases].some((name) => {
    const needle = normalized(name);
    return needle.length >= 3 && haystack.includes(` ${needle} `);
  });
}

export function findKnowledgeConsistencyDiagnostics(graph: CanonicalGraph): KnowledgeConsistencyDiagnostic[] {
  const hidden = graph.entities.filter((entity) => entity.visibility === "dm_only");
  const hiddenFacts = graph.facts.filter((fact) => fact.visibility === "dm_only");
  const diagnostics: KnowledgeConsistencyDiagnostic[] = [];
  for (const fact of graph.facts.filter((item) => item.visibility === "player_visible")) {
    for (const entity of hidden) if (mentions(fact.content, entity)) diagnostics.push({ kind: "visible_fact_references_hidden_entity", ownerKey: fact.stableKey, referencedEntityKey: entity.key, detail: `${fact.fieldKey} references ${entity.name}` });
  }
  for (const relationship of graph.relationships.filter((item) => item.visibility === "player_visible")) {
    for (const endpoint of [relationship.sourceEntityKey, relationship.targetEntityKey]) if (hidden.some((entity) => entity.key === endpoint)) diagnostics.push({ kind: "visible_relationship_references_hidden_entity", ownerKey: relationship.key, referencedEntityKey: endpoint, detail: "Visible relationship has a DM-only endpoint" });
  }
  for (const entity of graph.entities.filter((item) => item.playerSummary)) {
    const unsafeEntity = hidden.find((hiddenEntity) => mentions(entity.playerSummary!, hiddenEntity));
    const unsafeFact = hiddenFacts.find((fact) => normalized(entity.playerSummary!).includes(normalized(fact.content)));
    if (unsafeEntity || unsafeFact) diagnostics.push({ kind: "player_summary_references_hidden_knowledge", ownerKey: entity.key, referencedEntityKey: unsafeEntity?.key, detail: "Player summary mentions DM-only knowledge" });
  }
  if (graph.campaignOverview?.player) {
    const unsafeEntity = hidden.find((entity) => mentions(graph.campaignOverview!.player!, entity));
    const unsafeFact = hiddenFacts.find((fact) => normalized(graph.campaignOverview!.player!).includes(normalized(fact.content)));
    if (unsafeEntity || unsafeFact) diagnostics.push({ kind: "player_overview_references_hidden_knowledge", ownerKey: "campaign", referencedEntityKey: unsafeEntity?.key, detail: "Player overview mentions DM-only knowledge" });
  }
  return diagnostics;
}

export function buildEnrichmentDiagnostics(graph: CanonicalGraph) {
  const count = <T>(items: T[], select: (item: T) => string | null | undefined) => Object.fromEntries(["dm_only", "player_visible"].map((value) => [value, items.filter((item) => select(item) === value).length]));
  return {
    enrichedEntityCount: graph.entities.length,
    prominenceCounts: Object.fromEntries(["major", "supporting", "minor"].map((value) => [value, graph.entities.filter((entity) => entity.prominence === value).length])),
    visibilityCounts: {
      entities: count(graph.entities, (entity) => entity.visibility),
      facts: count(graph.facts, (fact) => fact.visibility),
      relationships: count(graph.relationships, (relationship) => relationship.visibility),
    },
    playerSummariesGenerated: graph.entities.filter((entity) => entity.playerSummary).length,
    playerSummariesOmitted: graph.entities.filter((entity) => !entity.playerSummary).length,
    consistencyWarnings: graph.knowledgeConsistencyDiagnostics ?? [],
  };
}

export function applyCampaignEnrichment(graph: CanonicalGraph, output: CampaignEnrichmentOutput): CanonicalGraph {
  const catalogEntries = buildEvidenceCatalog(graph);
  const catalog = new Map(catalogEntries.map((entry) => [entry.id, entry.source]));
  const entityAssignments = exactMap(output.classification.entities, "entity_key", graph.entities.map((entity) => entity.key), "entity");
  const factAssignments = exactMap(output.classification.facts, "fact_key", graph.facts.map((fact) => `${fact.entityKey}:${fact.stableKey}`), "fact");
  const relationshipAssignments = exactMap(output.classification.relationships, "relationship_key", graph.relationships.map((relationship) => relationship.key), "relationship");
  const gmSummaries = exactMap(output.gmSummaries.summaries, "entity_key", graph.entities.map((entity) => entity.key), "GM summary");
  const visibleEntityKeys = graph.entities.map((entity) => entity.key).filter((key) => entityAssignments.get(key)!.visibility === "player_visible");
  const playerSummaries = exactMap(output.playerSummaries.summaries, "entity_key", visibleEntityKeys, "Player summary");

  const entities = graph.entities.map((entity) => {
    const assignment = entityAssignments.get(entity.key)!;
    const gm = gmSummaries.get(entity.key)!;
    const player = playerSummaries.get(entity.key);
    const localEvidence = new Set(catalogEntries.filter((item) => item.ownerKey === entity.key || graph.facts.some((fact) => fact.entityKey === entity.key && `${fact.entityKey}:${fact.stableKey}` === item.ownerKey) || graph.relationships.some((relationship) => (relationship.sourceEntityKey === entity.key || relationship.targetEntityKey === entity.key) && relationship.key === item.ownerKey)).map((item) => item.id));
    const playerEvidence = new Set(catalogEntries.filter((item) => item.ownerKey === entity.key || graph.facts.some((fact) => fact.entityKey === entity.key && factAssignments.get(`${fact.entityKey}:${fact.stableKey}`)?.visibility === "player_visible" && `${fact.entityKey}:${fact.stableKey}` === item.ownerKey) || graph.relationships.some((relationship) => relationshipAssignments.get(relationship.key)?.visibility === "player_visible" && (relationship.sourceEntityKey === entity.key || relationship.targetEntityKey === entity.key) && relationship.key === item.ownerKey)).map((item) => item.id));
    return {
      ...entity,
      visibility: assignment.visibility,
      prominence: assignment.prominence,
      prominenceReason: assignment.prominence_reason,
      prominenceEvidence: sourcesFor(assignment.prominence_evidence_ids, localEvidence, catalog),
      gmSummary: gm.summary,
      gmSummarySources: sourcesFor(gm.evidence_ids, localEvidence, catalog),
      playerSummary: player?.summary ?? null,
      playerSummarySources: player ? sourcesFor(player.evidence_ids, playerEvidence, catalog) : [],
    };
  });
  const facts = graph.facts.map((fact) => ({ ...fact, visibility: factAssignments.get(`${fact.entityKey}:${fact.stableKey}`)!.visibility }));
  const relationships = graph.relationships.map((relationship) => ({ ...relationship, visibility: relationshipAssignments.get(relationship.key)!.visibility }));
  const allEvidence = new Set(catalog.keys());
  const visibleKeys = new Set(entities.filter((entity) => entity.visibility === "player_visible").map((entity) => entity.key));
  const playerSafeEvidence = new Set(catalogEntries.filter((entry) => visibleKeys.has(entry.ownerKey) || facts.some((fact) => fact.visibility === "player_visible" && `${fact.entityKey}:${fact.stableKey}` === entry.ownerKey) || relationships.some((relationship) => relationship.visibility === "player_visible" && visibleKeys.has(relationship.sourceEntityKey) && visibleKeys.has(relationship.targetEntityKey) && relationship.key === entry.ownerKey)).map((entry) => entry.id));
  const enriched: CanonicalGraph = {
    ...graph,
    entities,
    facts,
    relationships,
    campaignOverview: {
      gm: output.gmOverview.overview,
      gmSources: sourcesFor(output.gmOverview.evidence_ids, allEvidence, catalog),
      player: output.playerOverview.overview,
      playerSources: sourcesFor(output.playerOverview.evidence_ids, playerSafeEvidence, catalog),
    },
  };
  enriched.knowledgeConsistencyDiagnostics = findKnowledgeConsistencyDiagnostics(enriched);
  return enriched;
}
