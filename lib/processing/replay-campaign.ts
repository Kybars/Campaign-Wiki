import "server-only";

import type { ReconciliationDecision } from "@/lib/ai/schemas";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import { summarizeModelUsage } from "@/lib/ai/usage";
import { enrichmentGraphFingerprint } from "@/lib/ai/enrichment-input";
import { parseCampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import type { ModelCallUsage } from "@/lib/ai/usage";
import {
  loadCampaignAndDocument,
  loadLatestCompleteExtractionCache,
  loadCompleteEnrichmentCache,
  persistCanonicalGraph,
  recordProcessingRun,
  saveReconciliationCacheResult,
  updateCampaign,
} from "@/lib/db/repository";
import type { Json } from "@/lib/db/types";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { applyCampaignEnrichment } from "@/lib/graph/enrichment";
import { applyLeanGraphDefaults, buildLeanDiagnostics } from "@/lib/graph/lean";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { aggregateCachedChunks, parseCachedReconciliation } from "@/lib/processing/replay-cache";
import { RICH_EXTRACTION_CACHE_SCHEMA_VERSION } from "@/lib/processing/cache-version";
import { resolveProcessingMode, type ProcessingMode } from "@/lib/processing/mode";
import { assertAIProviderPersistenceAllowed, getAIProviderConfig } from "@/lib/env";
import { getStructuredModelProvider } from "@/lib/ai/structured-model-provider-runtime";

function mergeDiagnostics(current: Json, replay: Json): Json {
  if (current !== null && !Array.isArray(current) && typeof current === "object") return { ...current, replay };
  return { replay };
}

export async function replayCampaignFromCache(campaignId: string, options: { refreshReconciliation?: boolean; processingMode?: ProcessingMode } = {}) {
  const startedAt = Date.now();
  const processingMode = resolveProcessingMode(options.processingMode);
  const { campaign, document } = await loadCampaignAndDocument(campaignId);
  const cache = await loadLatestCompleteExtractionCache(campaignId);
  if (cache.run.document_id !== document.id) throw new Error("Extraction cache belongs to a different campaign document");
  if (![1, 2, 3, RICH_EXTRACTION_CACHE_SCHEMA_VERSION].includes(cache.run.cache_schema_version)) {
    throw new Error(`Unsupported extraction cache schema version ${cache.run.cache_schema_version}`);
  }

  await recordProcessingRun(campaignId, "replay", "started", {
    input: { processingMode, cacheRunId: cache.run.id, refreshReconciliation: options.refreshReconciliation === true },
  });

  try {
    const aggregate = aggregateCachedChunks(cache.chunks, cache.run.cache_schema_version);
    const groups = buildDeterministicGroups(aggregate);
    let decision: ReconciliationDecision | undefined;
    let reconciliationApiCalls = 0;
    const replayUsage: ModelCallUsage[] = [];

    if (options.refreshReconciliation) {
      const providerConfig = getAIProviderConfig("reconciliation");
      assertAIProviderPersistenceAllowed(providerConfig);
      const refreshed = await reconcileGroupsWithAI(groups, getStructuredModelProvider("reconciliation"));
      await saveReconciliationCacheResult(cache.run.id, refreshed);
      decision = refreshed.decision;
      reconciliationApiCalls = refreshed.usage ? 1 : 0;
      if (refreshed.usage) replayUsage.push(refreshed.usage);
    } else {
      if (!cache.reconciliation && groups.length > 1) {
        throw new Error("Extraction candidates are cached, but no reconciliation decision is cached. Re-run with --refresh-reconciliation to make only that model call.");
      }
      decision = cache.reconciliation ? parseCachedReconciliation(cache.reconciliation.decision, groups) : undefined;
    }

    const canonicalGraph = buildCanonicalGraph(aggregate, decision);
    const graphFingerprint = enrichmentGraphFingerprint(canonicalGraph);
    const enrichmentCache = processingMode === "full"
      ? await loadCompleteEnrichmentCache(campaignId, document.id, graphFingerprint)
      : undefined;
    if (processingMode === "full" && !enrichmentCache && cache.run.cache_schema_version >= RICH_EXTRACTION_CACHE_SCHEMA_VERSION) {
      throw new Error("Full replay requires a matching complete enrichment result. Select lean replay or run full processing first.");
    }
    const output = enrichmentCache?.output ? parseCampaignEnrichmentOutput(enrichmentCache.output) : undefined;
    const graph = processingMode === "lean"
      ? applyLeanGraphDefaults(canonicalGraph)
      : output ? applyCampaignEnrichment(canonicalGraph, output) : canonicalGraph;
    await persistCanonicalGraph(campaignId, document.id, graph);
    const replayDiagnostics = {
      cacheRunId: cache.run.id,
      extractionApiCalls: 0,
      reconciliationApiCalls,
      mode: "replay" as const,
      processingMode,
      enrichmentRequired: processingMode === "full",
      cacheSchemaVersion: cache.run.cache_schema_version,
      cacheHits: cache.chunks.length,
      cacheMisses: 0,
      richFactReplay: cache.run.cache_schema_version >= RICH_EXTRACTION_CACHE_SCHEMA_VERSION,
      enrichmentApiCalls: 0,
      enrichmentCacheHits: output ? 1 : 0,
      openAIGenerationCallsAfterReconciliation: 0,
      graphFingerprint,
      candidateEntityCount: aggregate.entities.length,
      canonicalEntityCount: graph.entities.length,
      ...graph.factAggregationDiagnostics,
      relationshipCount: graph.relationships.length,
      discardedRelationshipCount: graph.discardedRelationships.length,
      locationHierarchyDiagnostics: graph.locationHierarchyDiagnostics,
      durationMs: Date.now() - startedAt,
      ...(processingMode === "lean" ? buildLeanDiagnostics(graph) : {}),
    };
    await updateCampaign(campaignId, {
      status: "complete",
      processing_stage: "Wiki replayed from extraction cache",
      error_message: null,
      processing_diagnostics: mergeDiagnostics(campaign.processing_diagnostics, replayDiagnostics as unknown as Json),
    });
    await recordProcessingRun(campaignId, "replay", "complete", {
      output: {
        ...replayDiagnostics,
        modelUsage: summarizeModelUsage("reconciliation", replayUsage),
      } as unknown as Json,
    });
    return replayDiagnostics;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown replay failure";
    await recordProcessingRun(campaignId, "replay", "failed", { error: message });
    throw error;
  }
}
