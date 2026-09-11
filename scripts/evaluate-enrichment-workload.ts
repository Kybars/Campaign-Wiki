import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const {
    buildCampaignOverviewInput,
    buildEntityClassificationInput,
    buildEntitySummaryInput,
    buildFactVisibilityInput,
    buildRelationshipVisibilityInput,
  } = await import("@/lib/ai/enrichment-input");
  const {
    ENTITY_SUMMARY_BATCH_SIZE,
    FACT_CLASSIFICATION_BATCH_SIZE,
    RELATIONSHIP_CLASSIFICATION_BATCH_SIZE,
    expectedEnrichmentCallBreakdown,
  } = await import("@/lib/ai/enrich");
  const { ENRICHMENT_CACHE_SCHEMA_VERSION, ENRICHMENT_PROMPT_VERSION } = await import("@/lib/processing/cache-version");
  const { preflightCachedRecovery, TEST_THREE_CAMPAIGN_ID } = await import("@/lib/processing/recover-campaign");
  const { createAdminClient } = await import("@/lib/db/client");
  const { parseCampaignEnrichmentOutput } = await import("@/lib/ai/enrichment-schemas");
  const { applyCampaignEnrichment } = await import("@/lib/graph/enrichment");

  const { graph, graphFingerprint } = await preflightCachedRecovery(TEST_THREE_CAMPAIGN_ID, { processingMode: "full" });
  const cacheResult = await createAdminClient().from("enrichment_cache_runs")
    .select("id,status,created_at,output,usage_diagnostics")
    .eq("campaign_id", TEST_THREE_CAMPAIGN_ID)
    .order("created_at", { ascending: false });
  if (cacheResult.error) throw new Error(`Load Test 3 enrichment history: ${cacheResult.error.message}`);
  const observedCache = cacheResult.data.find((row) => row.output !== null);
  const observedEnrichedGraph = observedCache?.output
    ? applyCampaignEnrichment(graph, parseCampaignEnrichmentOutput(observedCache.output))
    : undefined;
  const allPlayerVisible = {
    ...graph,
    entities: graph.entities.map((entity) => ({ ...entity, visibility: "player_visible" as const })),
    facts: graph.facts.map((fact) => ({ ...fact, visibility: "player_visible" as const })),
    relationships: graph.relationships.map((relationship) => ({ ...relationship, visibility: "player_visible" as const })),
  };
  const allDmOnly = {
    ...graph,
    entities: graph.entities.map((entity) => ({ ...entity, visibility: "dm_only" as const })),
    facts: graph.facts.map((fact) => ({ ...fact, visibility: "dm_only" as const })),
    relationships: graph.relationships.map((relationship) => ({ ...relationship, visibility: "dm_only" as const })),
  };

  const size = (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    return { characters: serialized.length, utf8Bytes: Buffer.byteLength(serialized, "utf8") };
  };
  const evidenceItems = (value: unknown): number => {
    if (Array.isArray(value)) return value.reduce((count, item) => count + evidenceItems(item), 0);
    if (!value || typeof value !== "object") return 0;
    return Object.entries(value).reduce((count, [key, item]) => count + (key === "evidence" && Array.isArray(item) ? item.length : evidenceItems(item)), 0);
  };
  const namedArrayItems = (value: unknown, name: string): number => {
    if (Array.isArray(value)) return value.reduce((count, item) => count + namedArrayItems(item, name), 0);
    if (!value || typeof value !== "object") return 0;
    return Object.entries(value).reduce((count, [key, item]) => count + (key === name && Array.isArray(item) ? item.length : namedArrayItems(item, name)), 0);
  };
  const payloadMetrics = (payload: unknown) => ({
    entityItems: namedArrayItems(payload, "entities"),
    factItems: namedArrayItems(payload, "facts"),
    relationshipItems: namedArrayItems(payload, "relationships"),
    evidenceItems: evidenceItems(payload),
    ...size(payload),
  });
  const batches = <T>(items: T[], batchSize: number, wrap: (batch: T[]) => unknown = (batch) => batch) =>
    Array.from({ length: Math.ceil(items.length / batchSize) }, (_, index) => {
      const records = items.slice(index * batchSize, (index + 1) * batchSize);
      const payload = wrap(records);
      return { batch: index + 1, records: records.length, expectedResponseItems: records.length, ...payloadMetrics(payload) };
    });

  const entityClassification = buildEntityClassificationInput(graph);
  const facts = buildFactVisibilityInput(graph);
  const relationships = buildRelationshipVisibilityInput(graph);
  const gmSummaries = buildEntitySummaryInput(graph, "gm");
  const playerSummariesUpperBound = buildEntitySummaryInput(allPlayerVisible, "player");
  const playerSummariesSafeDefault = buildEntitySummaryInput(allDmOnly, "player");
  const playerSummariesObserved = observedEnrichedGraph ? buildEntitySummaryInput(observedEnrichedGraph, "player") : undefined;
  const gmOverviewStructural = buildCampaignOverviewInput(graph, "gm");
  const gmOverviewObserved = observedEnrichedGraph ? buildCampaignOverviewInput(observedEnrichedGraph, "gm") : undefined;
  const playerOverviewUpperBound = buildCampaignOverviewInput(allPlayerVisible, "player");
  const playerOverviewSafeDefault = buildCampaignOverviewInput(allDmOnly, "player");
  const playerOverviewObserved = observedEnrichedGraph ? buildCampaignOverviewInput(observedEnrichedGraph, "player") : undefined;

  const projectedScale = [25, 100, 250].map((entityCount) => {
    const factCount = Math.round(entityCount * graph.facts.length / graph.entities.length);
    const relationshipCount = Math.round(entityCount * graph.relationships.length / graph.entities.length);
    return {
      entityCount,
      projectedFactsAtTest3Ratio: factCount,
      projectedRelationshipsAtTest3Ratio: relationshipCount,
      fullCallsAllEntitiesPlayerVisible: Object.values(expectedEnrichmentCallBreakdown(entityCount, factCount, relationshipCount, entityCount)).reduce((sum, count) => sum + count, 0),
      fullCallsAllEntitiesDmOnly: Object.values(expectedEnrichmentCallBreakdown(entityCount, factCount, relationshipCount, 0)).reduce((sum, count) => sum + count, 0),
      leanPostReconciliationCalls: 0,
    };
  });

  console.log(JSON.stringify({
    mode: "zero-model-call Test 3 enrichment workload analysis",
    modelCalls: 0,
    campaignId: TEST_THREE_CAMPAIGN_ID,
    graphFingerprint,
    graph: { entities: graph.entities.length, facts: graph.facts.length, relationships: graph.relationships.length },
    versions: { prompt: ENRICHMENT_PROMPT_VERSION, schema: ENRICHMENT_CACHE_SCHEMA_VERSION },
    observedValidatedOutput: observedCache ? { cacheId: observedCache.id, status: observedCache.status, createdAt: observedCache.created_at, usage: observedCache.usage_diagnostics } : null,
    batchSizes: { entityClassification: graph.entities.length, factVisibility: FACT_CLASSIFICATION_BATCH_SIZE, relationshipVisibility: RELATIONSHIP_CLASSIFICATION_BATCH_SIZE, entitySummaries: ENTITY_SUMMARY_BATCH_SIZE, overviews: 1 },
    stages: {
      entityClassification: [{ batch: 1, records: entityClassification.entities.length, expectedResponseItems: entityClassification.entities.length, ...payloadMetrics(entityClassification) }],
      factVisibility: batches(facts, FACT_CLASSIFICATION_BATCH_SIZE, (batch) => ({ facts: batch })),
      relationshipVisibility: batches(relationships, RELATIONSHIP_CLASSIFICATION_BATCH_SIZE, (batch) => ({ relationships: batch })),
      gmSummaries: batches(gmSummaries, ENTITY_SUMMARY_BATCH_SIZE),
      playerSummariesUpperBound: batches(playerSummariesUpperBound, ENTITY_SUMMARY_BATCH_SIZE),
      playerSummariesSafeDefault: batches(playerSummariesSafeDefault, ENTITY_SUMMARY_BATCH_SIZE),
      playerSummariesObserved: playerSummariesObserved ? batches(playerSummariesObserved, ENTITY_SUMMARY_BATCH_SIZE) : null,
      gmOverviewStructuralWithoutGeneratedSummaries: [{ batch: 1, records: gmOverviewStructural.entities.length, expectedResponseItems: 1, ...payloadMetrics(gmOverviewStructural) }],
      gmOverviewObserved: gmOverviewObserved ? [{ batch: 1, records: gmOverviewObserved.entities.length, expectedResponseItems: 1, ...payloadMetrics(gmOverviewObserved) }] : null,
      playerOverviewUpperBoundWithoutGeneratedSummaries: [{ batch: 1, records: playerOverviewUpperBound.entities.length, expectedResponseItems: 1, ...payloadMetrics(playerOverviewUpperBound) }],
      playerOverviewSafeDefault: [{ batch: 1, records: playerOverviewSafeDefault.entities.length, expectedResponseItems: 1, ...payloadMetrics(playerOverviewSafeDefault) }],
      playerOverviewObserved: playerOverviewObserved ? [{ batch: 1, records: playerOverviewObserved.entities.length, expectedResponseItems: 1, ...payloadMetrics(playerOverviewObserved) }] : null,
    },
    projectedScale,
    caveats: [
      "Player summary and Player overview inputs depend on entity/fact/relationship visibility output, so observed, safe-default, and all-visible measurements are reported where a validated historical output is available.",
      "Overview payloads in the live full pipeline also contain generated summary text; structural sizes here use null summaries and are not token estimates.",
      "Character and UTF-8 byte counts measure JSON payloads only, excluding system prompts and provider request framing.",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
