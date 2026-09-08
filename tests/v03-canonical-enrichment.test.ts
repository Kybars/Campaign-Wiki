import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { zodTextFormat } from "openai/helpers/zod";
import { enrichmentFixtureGraph, enrichmentFixtureOutput } from "@/fixtures/enrichment-cache";
import { campaignClassificationSchema, campaignOverviewSchema, entitySummariesSchema, parseCampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import { buildCampaignOverviewInput, buildClassificationInput, buildEntitySummaryInput, enrichmentGraphFingerprint } from "@/lib/ai/enrichment-input";
import { CLASSIFICATION_SYSTEM_PROMPT, PLAYER_SUMMARY_SYSTEM_PROMPT } from "@/lib/ai/enrichment-prompts";
import { applyCampaignEnrichment, buildEnrichmentDiagnostics, findKnowledgeConsistencyDiagnostics } from "@/lib/graph/enrichment";
import { canonicalGraphPersistencePayload } from "@/lib/graph/persistence";
import { isEntityProminence, isKnowledgeVisibility } from "@/lib/knowledge/types";
import { ENRICHMENT_CACHE_SCHEMA_VERSION, ENRICHMENT_PROMPT_VERSION } from "@/lib/processing/cache-version";
import { expectedEnrichmentCallCount } from "@/lib/ai/enrich";
import { resolveOpenAIModels } from "@/lib/env";

function enriched() {
  const graph = enrichmentFixtureGraph();
  return applyCampaignEnrichment(graph, enrichmentFixtureOutput(graph));
}

describe("v0.3 Milestone 2 structured campaign classification", () => {
  it("supports exactly the two visibility states", () => {
    expect(isKnowledgeVisibility("dm_only")).toBe(true);
    expect(isKnowledgeVisibility("player_visible")).toBe(true);
    expect(isKnowledgeVisibility("public")).toBe(false);
  });

  it("supports universal major, supporting, and minor prominence", () => {
    expect(["major", "supporting", "minor"].every(isEntityProminence)).toBe(true);
    expect(isEntityProminence("unclassified")).toBe(false);
  });

  it("keeps legacy unclassified state representable as null outside the AI schema", () => {
    expect(enrichmentFixtureGraph().entities.every((entity) => entity.prominence === undefined)).toBe(true);
  });

  it("converts all enrichment schemas to strict structured outputs without a model call", () => {
    expect(zodTextFormat(campaignClassificationSchema, "classification").type).toBe("json_schema");
    expect(zodTextFormat(entitySummariesSchema, "summaries").type).toBe("json_schema");
    expect(zodTextFormat(campaignOverviewSchema, "overview").type).toBe("json_schema");
  });

  it("requires every canonical entity, fact, and relationship exactly once", () => {
    const graph = enrichmentFixtureGraph();
    const output = enrichmentFixtureOutput(graph);
    output.classification.entities.pop();
    expect(() => applyCampaignEnrichment(graph, output)).toThrow(/every canonical entity exactly once/);
  });

  it("rejects unknown evidence IDs rather than persisting invented support", () => {
    const graph = enrichmentFixtureGraph();
    const output = enrichmentFixtureOutput(graph);
    output.classification.entities[0].prominence_evidence_ids = ["made-up"];
    expect(() => applyCampaignEnrichment(graph, output)).toThrow(/unavailable evidence/);
  });

  it("makes campaign-relative judgment explicit in the classification prompt", () => {
    expect(CLASSIFICATION_SYSTEM_PROMPT).toContain("campaign-relative");
    expect(CLASSIFICATION_SYSTEM_PROMPT).toContain("never raw power");
    expect(CLASSIFICATION_SYSTEM_PROMPT).toContain("frequently mentioned pet may be minor");
  });

  it("defaults uncertainty conservatively through explicit model guidance", () => {
    expect(CLASSIFICATION_SYSTEM_PROMPT).toContain("uncertainty means dm_only");
  });

  it("keeps a pivotal entity major despite sparse evidence", () => {
    expect(enriched().entities.find((entity) => entity.name === "Mira Vale")?.prominence).toBe("major");
  });

  it("keeps a frequently mentioned pet minor", () => {
    const brutus = enriched().entities.find((entity) => entity.name === "Brutus")!;
    expect(brutus.sources).toHaveLength(3);
    expect(brutus.prominence).toBe("minor");
  });

  it("keeps a recurring supporting location supporting", () => {
    expect(enriched().entities.find((entity) => entity.name === "Emberwatch")?.prominence).toBe("supporting");
  });

  it("allows a late pivotal artifact to be major", () => {
    expect(enriched().entities.find((entity) => entity.name === "Tideglass Blade")?.prominence).toBe("major");
  });

  it("does not equate power with importance", () => {
    expect(enriched().entities.find((entity) => entity.name === "Titan of Glass")?.prominence).toBe("minor");
  });

  it("stores a diagnostic prominence reason and grounded evidence", () => {
    const blade = enriched().entities.find((entity) => entity.name === "Tideglass Blade")!;
    expect(blade.prominenceReason).toBe("Late but pivotal artifact");
    expect(blade.prominenceEvidence?.[0].supporting_text).toBeTruthy();
  });
});

describe("v0.3 Milestone 2 independent visibility and safety", () => {
  it("classifies entity visibility independently from its facts", () => {
    const graph = enriched();
    const mira = graph.entities.find((entity) => entity.name === "Mira Vale")!;
    expect(mira.visibility).toBe("player_visible");
    expect(graph.facts.filter((fact) => fact.entityKey === mira.key).map((fact) => fact.visibility)).toContain("dm_only");
    expect(graph.facts.filter((fact) => fact.entityKey === mira.key).map((fact) => fact.visibility)).toContain("player_visible");
  });

  it("classifies one normalized relationship once", () => {
    const graph = enriched();
    expect(graph.relationships.filter((relationship) => relationship.key === "relationship-4")).toHaveLength(1);
    expect(graph.relationships.find((relationship) => relationship.key === "relationship-4")?.visibility).toBe("player_visible");
  });

  it("keeps hidden murder-style knowledge DM-only while public ownership can be visible", () => {
    const graph = enriched();
    expect(graph.relationships.find((relationship) => relationship.key === "relationship-4")?.visibility).toBe("player_visible");
    expect(graph.relationships.find((relationship) => relationship.key === "relationship-10")?.visibility).toBe("dm_only");
  });

  it("does not silently cascade a hidden endpoint onto a visible relationship", () => {
    const graph = enriched();
    expect(graph.relationships.find((relationship) => relationship.key === "fixture-hidden-target")?.visibility).toBe("player_visible");
    expect(graph.entities.find((entity) => entity.key === "fixture-villain")?.visibility).toBe("dm_only");
  });

  it("flags visible facts that name a hidden entity", () => {
    expect(enriched().knowledgeConsistencyDiagnostics).toContainEqual(expect.objectContaining({ kind: "visible_fact_references_hidden_entity", referencedEntityKey: "fixture-villain" }));
  });

  it("flags visible relationships with a hidden endpoint", () => {
    expect(enriched().knowledgeConsistencyDiagnostics).toContainEqual(expect.objectContaining({ kind: "visible_relationship_references_hidden_entity", ownerKey: "fixture-hidden-target" }));
  });

  it("flags a player summary that mentions hidden knowledge", () => {
    expect(enriched().knowledgeConsistencyDiagnostics).toContainEqual(expect.objectContaining({ kind: "player_summary_references_hidden_knowledge" }));
  });

  it("gives a DM-only entity no Player summary", () => {
    expect(enriched().entities.find((entity) => entity.name === "Veiled Master")?.playerSummary).toBeNull();
  });

  it("flags a player campaign overview leak", () => {
    const graph = enriched();
    graph.campaignOverview!.player = "The Veiled Master caused the Night of Ash.";
    expect(findKnowledgeConsistencyDiagnostics(graph)).toContainEqual(expect.objectContaining({ kind: "player_overview_references_hidden_knowledge" }));
  });

  it("does not mutate visibility while reporting consistency warnings", () => {
    const graph = enriched();
    findKnowledgeConsistencyDiagnostics(graph);
    expect(graph.entities.find((entity) => entity.key === "fixture-villain")?.visibility).toBe("dm_only");
    expect(graph.relationships.find((relationship) => relationship.key === "fixture-hidden-target")?.visibility).toBe("player_visible");
  });
});

describe("v0.3 Milestone 2 summary isolation, persistence, and replay", () => {
  it("builds GM entity inputs from all supported facts", () => {
    const graph = enriched();
    const mira = buildEntitySummaryInput(graph, "gm").find((entity) => entity.name === "Mira Vale")!;
    expect(mira.facts.some((fact) => fact.content === "Presumed dead")).toBe(true);
  });

  it("builds Player entity inputs only after visibility filtering", () => {
    const graph = enriched();
    const mira = buildEntitySummaryInput(graph, "player").find((entity) => entity.name === "Mira Vale")!;
    expect(mira.facts.some((fact) => fact.content === "Presumed dead")).toBe(false);
    expect(buildEntitySummaryInput(graph, "player").some((entity) => entity.name === "Veiled Master")).toBe(false);
  });

  it("omits inconsistent visible relationships from Player summary input", () => {
    const mira = buildEntitySummaryInput(enriched(), "player").find((entity) => entity.name === "Mira Vale")!;
    expect(mira.relationships.some((relationship) => relationship.key === "fixture-hidden-target")).toBe(false);
  });

  it("uses a separate Player-summary prompt over pre-filtered input", () => {
    expect(PLAYER_SUMMARY_SYSTEM_PROMPT).toContain("already been filtered");
  });

  it("builds campaign Player overview input without hidden entities or facts", () => {
    const input = buildCampaignOverviewInput(enriched(), "player");
    expect(JSON.stringify(input)).not.toContain("Veiled Master secretly caused");
    expect(JSON.stringify(input)).not.toContain("Presumed dead");
  });

  it("keeps GM and Player summaries separate", () => {
    const mira = enriched().entities.find((entity) => entity.name === "Mira Vale")!;
    expect(mira.gmSummary).toContain("missing or presumed dead");
    expect(mira.playerSummary).not.toContain("presumed dead");
  });

  it("keeps GM and Player campaign overviews separate", () => {
    const overview = enriched().campaignOverview!;
    expect(overview.gm).toContain("secretly caused");
    expect(overview.player).not.toContain("secretly caused");
  });

  it("does not falsely resolve conflicting canonical facts in the GM summary", () => {
    const summary = enriched().entities.find((entity) => entity.name === "Mira Vale")!.gmSummary!;
    expect(summary).toContain("missing or presumed dead");
    expect(summary).not.toBe("Mira is presumed dead.");
  });

  it("allows sparse Player-safe evidence to produce null rather than filler", () => {
    const brutus = enriched().entities.find((entity) => entity.name === "Brutus")!;
    expect(brutus.visibility).toBe("player_visible");
    expect(brutus.playerSummary).toBeNull();
  });

  it("persists visibility, prominence, reasons, summaries, and overview evidence", () => {
    const payload = canonicalGraphPersistencePayload(enriched());
    expect(payload.entities.every((entity) => entity.visibility && entity.prominence && "gmSummary" in entity)).toBe(true);
    expect(payload.relationships.every((relationship) => relationship.visibility)).toBe(true);
    expect(payload.facts.every((fact) => fact.visibility)).toBe(true);
    expect(payload.campaignOverview?.gmSources).toHaveLength(1);
  });

  it("keeps canonical IDs and stable fact identities unchanged during enrichment", () => {
    const before = enrichmentFixtureGraph();
    const after = applyCampaignEnrichment(before, enrichmentFixtureOutput(before));
    expect(after.entities.map((entity) => entity.key)).toEqual(before.entities.map((entity) => entity.key));
    expect(after.facts.map((fact) => fact.stableKey)).toEqual(before.facts.map((fact) => fact.stableKey));
  });

  it("has a stable graph fingerprint that excludes enrichment output", () => {
    const before = enrichmentFixtureGraph();
    const after = applyCampaignEnrichment(before, enrichmentFixtureOutput(before));
    expect(enrichmentGraphFingerprint(after)).toBe(enrichmentGraphFingerprint(before));
  });

  it("replays serialized enrichment output deterministically with zero model calls", () => {
    const graph = enrichmentFixtureGraph();
    const cached = JSON.parse(JSON.stringify(enrichmentFixtureOutput(graph)));
    expect(applyCampaignEnrichment(graph, parseCampaignEnrichmentOutput(cached))).toEqual(applyCampaignEnrichment(graph, enrichmentFixtureOutput(graph)));
  });

  it("invalidates enrichment independently through explicit schema and prompt versions", () => {
    expect(ENRICHMENT_CACHE_SCHEMA_VERSION).toBe(1);
    expect(ENRICHMENT_PROMPT_VERSION).toMatch(/^v0\.3-m2-/);
  });

  it("configures enrichment independently with an OPENAI_MODEL fallback", () => {
    expect(resolveOpenAIModels({ OPENAI_MODEL: "fallback" }).OPENAI_ENRICHMENT_MODEL).toBe("fallback");
    expect(resolveOpenAIModels({ OPENAI_MODEL: "fallback", OPENAI_ENRICHMENT_MODEL: "enrich" }).OPENAI_ENRICHMENT_MODEL).toBe("enrich");
  });

  it("constructs one complete canonical classification payload after reconciliation", () => {
    const graph = enrichmentFixtureGraph();
    const input = buildClassificationInput(graph);
    expect(input.entities).toHaveLength(graph.entities.length);
    expect(input.facts).toHaveLength(graph.facts.length);
    expect(input.relationships).toHaveLength(graph.relationships.length);
  });

  it("batches entity summaries instead of making one call per entity", () => {
    expect(expectedEnrichmentCallCount(156, 60)).toBe(21);
    expect(expectedEnrichmentCallCount(156, 60)).toBeLessThan(156);
  });

  it("adds a migration-backed private enrichment cache and overview RPC", () => {
    const migration = readFileSync("supabase/migrations/20260908160000_v03_m2_enrichment_cache.sql", "utf8");
    expect(migration).toContain("create table public.enrichment_cache_runs");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all privileges on table public.enrichment_cache_runs from anon, authenticated");
    expect(migration).toContain("create function public.persist_campaign_overviews");
    expect(migration).toContain("create function public.replace_campaign_graph_with_enrichment");
  });

  it("reports prominence counts across all three classifications", () => {
    expect(buildEnrichmentDiagnostics(enriched()).prominenceCounts).toMatchObject({ major: 2, supporting: 3 });
  });

  it("reports independent entity, fact, and relationship visibility counts", () => {
    const counts = buildEnrichmentDiagnostics(enriched()).visibilityCounts;
    expect(counts.entities.player_visible).toBeGreaterThan(0);
    expect(counts.facts.dm_only).toBeGreaterThan(0);
    expect(counts.relationships.player_visible).toBeGreaterThan(0);
  });

  it("reports generated and omitted Player summaries", () => {
    const diagnostics = buildEnrichmentDiagnostics(enriched());
    expect(diagnostics.playerSummariesGenerated).toBeGreaterThan(0);
    expect(diagnostics.playerSummariesOmitted).toBeGreaterThan(0);
  });

  it("reports hidden-reference warnings without hiding them", () => {
    expect(buildEnrichmentDiagnostics(enriched()).consistencyWarnings.length).toBeGreaterThanOrEqual(3);
  });
});
