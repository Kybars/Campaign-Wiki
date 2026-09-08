import { richFactCachedChunks } from "@/fixtures/rich-fact-cache";
import type { CampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import { buildEvidenceCatalog } from "@/lib/ai/enrichment-input";
import { buildCanonicalGraph } from "@/lib/graph/build";
import type { CanonicalEntity, CanonicalGraph } from "@/lib/graph/types";
import { aggregateCachedChunks } from "@/lib/processing/replay-cache";
import { RICH_EXTRACTION_CACHE_SCHEMA_VERSION } from "@/lib/processing/cache-version";

const source = (page_number: number, supporting_text: string) => ({ page_number, supporting_text });

function extraEntity(key: string, name: string, sources: ReturnType<typeof source>[]): CanonicalEntity {
  return { key, name, normalizedName: name.toLowerCase(), type: "npc", roles: [], roleSources: {}, aliases: [], summary: `${name} appears.`, sources, candidateIds: [key], reconciliationEvidence: sources, mergeReason: "deterministic" };
}

export function enrichmentFixtureGraph(): CanonicalGraph {
  const graph = buildCanonicalGraph(aggregateCachedChunks(richFactCachedChunks, RICH_EXTRACTION_CACHE_SCHEMA_VERSION));
  graph.entities.push(
    extraEntity("fixture-brutus", "Brutus", [source(3, "Brutus follows Colinus."), source(8, "Brutus sleeps by the fire."), source(12, "Brutus barks at strangers.")]),
    extraEntity("fixture-villain", "Veiled Master", [source(20, "The Veiled Master secretly caused the Night of Ash.")]),
    extraEntity("fixture-titan", "Titan of Glass", [source(21, "A mighty Titan of Glass stands inactive beyond the map.")]),
  );
  graph.facts.push({ entityKey: "canonical-1", stableKey: "fixture-visible-warning", fieldKey: "knowledge", content: "A public warning names Veiled Master", visibility: "dm_only", origin: "document", evidence: [{ origin: "document", pageNumber: 22, supportingText: "The public warning names the Veiled Master." }] });
  graph.relationships.push({ key: "fixture-hidden-target", sourceEntityKey: "canonical-1", targetEntityKey: "fixture-villain", relationshipType: "opposes", description: "Mira publicly opposes the Veiled Master", confidence: 0.9, sources: [source(22, "Mira publicly opposes the Veiled Master.")], candidateRelationshipIds: ["fixture-hidden-target"], normalization: { semanticType: "opposes", forwardLabel: "opposes", inverseLabel: "opposed by", originalRelationshipTypes: ["opposes"], descriptions: ["Mira publicly opposes the Veiled Master"] } });
  return graph;
}

export function enrichmentFixtureOutput(graph: CanonicalGraph = enrichmentFixtureGraph()): CampaignEnrichmentOutput {
  const catalog = buildEvidenceCatalog(graph);
  const firstEvidence = (ownerKey: string) => catalog.find((entry) => entry.ownerKey === ownerKey)!.id;
  const evidenceForFact = (content: string) => {
    const fact = graph.facts.find((item) => item.content === content)!;
    return firstEvidence(`${fact.entityKey}:${fact.stableKey}`);
  };
  const playerEntities = new Set(["canonical-1", "canonical-2", "canonical-6", "canonical-7", "canonical-9", "fixture-brutus"]);
  const prominence = (key: string) => key === "canonical-1" || key === "canonical-7" ? "major" as const : key === "canonical-2" || key === "canonical-6" || key === "canonical-9" ? "supporting" as const : "minor" as const;
  const publicFact = (field: string, key: string) => ["occupation", "purpose", "objective", "appearance"].includes(field) || key === "fixture-visible-warning";
  const publicRelationship = (key: string) => ["relationship-2", "relationship-4", "relationship-6", "relationship-7", "relationship-8", "fixture-hidden-target"].includes(key);
  return {
    classification: {
      entities: graph.entities.map((entity) => ({ entity_key: entity.key, prominence: prominence(entity.key), prominence_reason: entity.key === "fixture-brutus" ? "Frequently present but incidental pet" : entity.key === "canonical-7" ? "Late but pivotal artifact" : entity.key === "fixture-titan" ? "Powerful but incidental" : "Campaign-relative fixture judgment", prominence_evidence_ids: [firstEvidence(entity.key)], visibility: playerEntities.has(entity.key) ? "player_visible" : "dm_only" })),
      facts: graph.facts.map((fact) => ({ fact_key: `${fact.entityKey}:${fact.stableKey}`, visibility: publicFact(fact.fieldKey, fact.stableKey) ? "player_visible" : "dm_only" })),
      relationships: graph.relationships.map((relationship) => ({ relationship_key: relationship.key, visibility: publicRelationship(relationship.key) ? "player_visible" : "dm_only" })),
    },
    gmSummaries: { summaries: graph.entities.map((entity) => ({ entity_key: entity.key, summary: entity.key === "canonical-1" ? "Mira is a hunter; reports call her missing or presumed dead." : null, evidence_ids: entity.key === "canonical-1" ? [evidenceForFact("a hunter"), evidenceForFact("Missing"), evidenceForFact("Presumed dead")] : [] })) },
    playerSummaries: { summaries: graph.entities.filter((entity) => playerEntities.has(entity.key)).map((entity) => ({ entity_key: entity.key, summary: entity.key === "canonical-1" ? "Mira is a hunter who opposes the Veiled Master." : null, evidence_ids: entity.key === "canonical-1" ? [evidenceForFact("a hunter"), firstEvidence("canonical-1:fixture-visible-warning")] : [] })) },
    gmOverview: { overview: "The Veiled Master secretly caused the Night of Ash.", evidence_ids: [firstEvidence("fixture-villain")] },
    playerOverview: { overview: "Mira is a hunter.", evidence_ids: [evidenceForFact("a hunter")] },
  };
}
