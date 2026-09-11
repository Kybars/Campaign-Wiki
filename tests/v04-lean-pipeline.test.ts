import { enrichmentFixtureGraph, enrichmentFixtureOutput } from "@/fixtures/enrichment-cache";
import { visibleEntities, visibleFacts, visibleRelationships, visibleSummary } from "@/lib/campaign-view";
import { prominenceGroup, prominenceGroupLabel } from "@/lib/entities";
import { applyCampaignEnrichment } from "@/lib/graph/enrichment";
import { applyLeanGraphDefaults, buildLeanDiagnostics } from "@/lib/graph/lean";
import { canonicalGraphPersistencePayload } from "@/lib/graph/persistence";
import { resolveProcessingMode } from "@/lib/processing/mode";
import { describe, expect, it } from "vitest";

describe("v0.4 lean graph behavior", () => {
  it("defaults processing to lean and rejects unknown modes", () => {
    expect(resolveProcessingMode(undefined)).toBe("lean");
    expect(resolveProcessingMode("full")).toBe("full");
    expect(() => resolveProcessingMode("assisted")).toThrow(/Unsupported campaign processing mode/);
  });

  it("clears stale enriched visibility, prominence, Player prose, and overviews explicitly", () => {
    const canonical = enrichmentFixtureGraph();
    const stale = applyCampaignEnrichment(canonical, enrichmentFixtureOutput(canonical));
    expect(stale.entities.some((entity) => entity.visibility === "player_visible")).toBe(true);
    expect(stale.campaignOverview?.player).toBeTruthy();

    const lean = applyLeanGraphDefaults(stale);
    expect(lean.entities.every((entity) => entity.visibility === "dm_only" && entity.prominence === null && entity.prominenceReason === null)).toBe(true);
    expect(lean.entities.every((entity) => entity.gmSummary === entity.summary && entity.playerSummary === null && entity.playerSummarySources?.length === 0)).toBe(true);
    expect(lean.facts.every((fact) => fact.visibility === "dm_only")).toBe(true);
    expect(lean.relationships.every((relationship) => relationship.visibility === "dm_only")).toBe(true);
    expect(lean.campaignOverview).toEqual({ gm: null, gmSources: [], player: null, playerSources: [] });

    const payload = canonicalGraphPersistencePayload(lean);
    expect(payload.entities.every((entity) => entity.visibility === "dm_only" && entity.prominence === null && entity.playerSummary === null)).toBe(true);
    expect(payload.campaignOverview).toEqual({ gm: null, gmSources: [], player: null, playerSources: [] });
  });

  it("keeps the rich GM graph useful while Player View fails closed", () => {
    const graph = applyLeanGraphDefaults(enrichmentFixtureGraph());
    expect(graph.facts.length).toBeGreaterThan(0);
    expect(graph.relationships.length).toBeGreaterThan(0);
    expect(graph.entities.some((entity) => entity.type === "quest")).toBe(true);
    expect(graph.entities.some((entity) => entity.type === "event")).toBe(true);
    const readEntities = graph.entities.map((entity) => ({ id: entity.key, name: entity.name, type: entity.type, roles: entity.roles, aliases: entity.aliases, visibility: entity.visibility!, gm_summary: entity.gmSummary, player_summary: entity.playerSummary, summary: entity.summary }));
    expect(visibleEntities(readEntities, "player")).toEqual([]);
    expect(visibleFacts(graph.facts.map((fact) => ({ visibility: fact.visibility!, content: fact.content, structured_value: fact.structuredValue ?? null })), readEntities, "player")).toEqual([]);
    expect(visibleRelationships(graph.relationships.map((relationship) => ({ visibility: relationship.visibility!, source_entity_id: relationship.sourceEntityKey, target_entity_id: relationship.targetEntityKey })), readEntities, "player")).toEqual([]);
    expect(visibleSummary(readEntities[0], "dm")).toBe(graph.entities[0].summary);
    expect(visibleSummary(readEntities[0], "player")).toBe("");
  });

  it("reports zero enrichment calls and renders null prominence honestly", () => {
    const diagnostics = buildLeanDiagnostics(applyLeanGraphDefaults(enrichmentFixtureGraph()));
    expect(diagnostics).toMatchObject({ processingMode: "lean", enrichmentRequired: false, enrichmentCalls: 0, openAIGenerationCallsAfterReconciliation: 0, prominenceMode: "unclassified", visibilityMode: "dm_only_default", overviewMode: "none" });
    expect(diagnostics.prominenceCounts.unclassified).toBeGreaterThan(0);
    expect(diagnostics.visibilityCounts.entities.playerVisible).toBe(0);
    expect(prominenceGroup(null)).toBe("unclassified");
    expect(prominenceGroupLabel("unclassified")).toBe("Unclassified");
    expect(prominenceGroup(null)).not.toBe("minor");
  });
});
