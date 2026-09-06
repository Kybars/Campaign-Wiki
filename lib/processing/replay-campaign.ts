import "server-only";

import type { ReconciliationDecision } from "@/lib/ai/schemas";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import { summarizeModelUsage } from "@/lib/ai/usage";
import type { ModelCallUsage } from "@/lib/ai/usage";
import {
  loadCampaignAndDocument,
  loadLatestCompleteExtractionCache,
  persistCanonicalGraph,
  recordProcessingRun,
  saveReconciliationCacheResult,
  updateCampaign,
} from "@/lib/db/repository";
import type { Json } from "@/lib/db/types";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { aggregateCachedChunks, parseCachedReconciliation } from "@/lib/processing/replay-cache";

function mergeDiagnostics(current: Json, replay: Json): Json {
  if (current !== null && !Array.isArray(current) && typeof current === "object") return { ...current, replay };
  return { replay };
}

export async function replayCampaignFromCache(campaignId: string, options: { refreshReconciliation?: boolean } = {}) {
  const startedAt = Date.now();
  const { campaign, document } = await loadCampaignAndDocument(campaignId);
  const cache = await loadLatestCompleteExtractionCache(campaignId);
  if (cache.run.document_id !== document.id) throw new Error("Extraction cache belongs to a different campaign document");
  if (cache.run.cache_schema_version !== 1) throw new Error(`Unsupported extraction cache schema version ${cache.run.cache_schema_version}`);

  await recordProcessingRun(campaignId, "replay", "started", {
    input: { cacheRunId: cache.run.id, refreshReconciliation: options.refreshReconciliation === true },
  });

  try {
    const aggregate = aggregateCachedChunks(cache.chunks);
    const groups = buildDeterministicGroups(aggregate);
    let decision: ReconciliationDecision | undefined;
    let reconciliationApiCalls = 0;
    const replayUsage: ModelCallUsage[] = [];

    if (options.refreshReconciliation) {
      const refreshed = await reconcileGroupsWithAI(groups);
      await saveReconciliationCacheResult(cache.run.id, refreshed);
      decision = refreshed.decision;
      reconciliationApiCalls = refreshed.usage ? 1 : 0;
      if (refreshed.usage) replayUsage.push(refreshed.usage);
    } else {
      if (!cache.reconciliation && groups.length > 1) {
        throw new Error("Extraction candidates are cached, but no reconciliation decision is cached. Re-run with --refresh-reconciliation to make only that model call.");
      }
      decision = cache.reconciliation ? parseCachedReconciliation(cache.reconciliation.decision) : undefined;
    }

    const graph = buildCanonicalGraph(aggregate, decision);
    await persistCanonicalGraph(campaignId, document.id, graph);
    const replayDiagnostics = {
      cacheRunId: cache.run.id,
      extractionApiCalls: 0,
      reconciliationApiCalls,
      candidateEntityCount: aggregate.entities.length,
      canonicalEntityCount: graph.entities.length,
      relationshipCount: graph.relationships.length,
      discardedRelationshipCount: graph.discardedRelationships.length,
      durationMs: Date.now() - startedAt,
    };
    await updateCampaign(campaignId, {
      status: "complete",
      processing_stage: "Wiki replayed from extraction cache",
      error_message: null,
      processing_diagnostics: mergeDiagnostics(campaign.processing_diagnostics, replayDiagnostics),
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
