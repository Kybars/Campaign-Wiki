import type { Json } from "@/lib/db/types";
import type { CanonicalGraph } from "@/lib/graph/types";

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function canonicalGraphPersistencePayload(graph: CanonicalGraph) {
  return {
    entities: graph.entities.map((entity) => defined({
      key: entity.key,
      name: entity.name,
      normalizedName: entity.normalizedName,
      type: entity.type,
      roles: entity.roles,
      aliases: entity.aliases,
      summary: entity.summary,
      gmSummary: entity.gmSummary,
      gmSummarySources: entity.gmSummarySources,
      playerSummary: entity.playerSummary,
      playerSummarySources: entity.playerSummarySources,
      visibility: entity.visibility,
      prominence: entity.prominence,
      prominenceReason: entity.prominenceReason,
      sources: entity.sources,
      metadata: {
        candidateIds: entity.candidateIds,
        mergeReason: entity.mergeReason,
        reconciliationEvidence: entity.reconciliationEvidence,
        roleSources: entity.roleSources,
        prominenceEvidence: entity.prominenceEvidence,
      },
    })),
    relationships: graph.relationships.map((relationship) => defined({
      ...relationship,
      visibility: relationship.visibility,
      origin: relationship.origin,
      metadata: {
        candidateRelationshipIds: relationship.candidateRelationshipIds,
        normalization: relationship.normalization,
      },
    })),
    facts: graph.facts.map((fact) => defined({
      ...fact,
      evidence: fact.evidence.map((evidence) => defined(evidence)),
    })),
    campaignOverview: graph.campaignOverview ? {
      gm: graph.campaignOverview.gm,
      gmSources: graph.campaignOverview.gmSources,
      player: graph.campaignOverview.player,
      playerSources: graph.campaignOverview.playerSources,
    } : undefined,
  } satisfies { entities: Json[]; relationships: Json[]; facts: Json[]; campaignOverview?: Json };
}
