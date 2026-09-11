import type { CanonicalGraph } from "@/lib/graph/types";

export function applyLeanGraphDefaults(graph: CanonicalGraph): CanonicalGraph {
  return {
    ...graph,
    entities: graph.entities.map((entity) => ({
      ...entity,
      visibility: "dm_only",
      prominence: null,
      prominenceReason: null,
      prominenceEvidence: [],
      gmSummary: entity.summary,
      gmSummarySources: entity.sources,
      playerSummary: null,
      playerSummarySources: [],
    })),
    facts: graph.facts.map((fact) => ({ ...fact, visibility: "dm_only" })),
    relationships: graph.relationships.map((relationship) => ({ ...relationship, visibility: "dm_only" })),
    campaignOverview: { gm: null, gmSources: [], player: null, playerSources: [] },
    knowledgeConsistencyDiagnostics: [],
  };
}

export function buildLeanDiagnostics(graph: CanonicalGraph) {
  return {
    processingMode: "lean" as const,
    enrichmentRequired: false,
    enrichmentCalls: 0,
    openAIGenerationCallsAfterReconciliation: 0,
    prominenceMode: "unclassified" as const,
    prominenceCounts: {
      major: graph.entities.filter((entity) => entity.prominence === "major").length,
      supporting: graph.entities.filter((entity) => entity.prominence === "supporting").length,
      minor: graph.entities.filter((entity) => entity.prominence === "minor").length,
      unclassified: graph.entities.filter((entity) => entity.prominence == null).length,
    },
    visibilityMode: "dm_only_default" as const,
    visibilityCounts: {
      entities: { dmOnly: graph.entities.filter((entity) => entity.visibility === "dm_only").length, playerVisible: graph.entities.filter((entity) => entity.visibility === "player_visible").length },
      facts: { dmOnly: graph.facts.filter((fact) => fact.visibility === "dm_only").length, playerVisible: graph.facts.filter((fact) => fact.visibility === "player_visible").length },
      relationships: { dmOnly: graph.relationships.filter((relationship) => relationship.visibility === "dm_only").length, playerVisible: graph.relationships.filter((relationship) => relationship.visibility === "player_visible").length },
    },
    summaryMode: "canonical_source_summary_only" as const,
    summaries: { gmFallbacks: graph.entities.filter((entity) => Boolean(entity.gmSummary)).length, player: graph.entities.filter((entity) => Boolean(entity.playerSummary)).length },
    overviewMode: "none" as const,
    overviews: { gm: Boolean(graph.campaignOverview?.gm), player: Boolean(graph.campaignOverview?.player) },
  };
}
