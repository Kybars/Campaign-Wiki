import "server-only";

import { EnrichmentFailure, enrichCanonicalGraphWithAI, expectedEnrichmentCallBreakdown } from "@/lib/ai/enrich";
import { enrichmentGraphFingerprint } from "@/lib/ai/enrichment-input";
import { getOpenAIEnv } from "@/lib/env";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildEnrichmentDiagnostics } from "@/lib/graph/enrichment";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { aggregateCachedChunks, parseCachedReconciliation } from "@/lib/processing/replay-cache";
import { RICH_EXTRACTION_CACHE_SCHEMA_VERSION } from "@/lib/processing/cache-version";
import { createEnrichmentCacheRun, finishEnrichmentCacheRun, loadCampaignAndDocument, loadLatestCompleteExtractionCache, persistCanonicalGraph, recordProcessingRun, updateCampaign } from "@/lib/db/repository";
import { summarizeModelUsage } from "@/lib/ai/usage";
import type { Json } from "@/lib/db/types";

export const TEST_THREE_CAMPAIGN_ID = "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4";
const TEST_TWO_CAMPAIGN_ID = "a13d54b5-74e6-45e3-9f7f-9dcad214d7d3";

export async function preflightCachedRecovery(campaignId: string) {
  if (campaignId === TEST_TWO_CAMPAIGN_ID) throw new Error("Test 2 is immutable and cannot be recovered");
  const { campaign, document } = await loadCampaignAndDocument(campaignId);
  if (campaign.status !== "failed") throw new Error("Cached recovery only accepts a failed campaign");
  const cache = await loadLatestCompleteExtractionCache(campaignId);
  if (cache.run.document_id !== document.id) throw new Error("Extraction cache belongs to a different campaign document");
  if (cache.run.cache_schema_version !== RICH_EXTRACTION_CACHE_SCHEMA_VERSION) throw new Error(`Incompatible extraction cache schema version ${cache.run.cache_schema_version}`);
  const metadata = cache.run.chunking_metadata as { chunkCount?: number };
  const expectedChunks = metadata.chunkCount;
  if (!expectedChunks || cache.chunks.length !== expectedChunks || cache.chunks.some((chunk, index) => chunk.chunk_index !== index)) throw new Error("Extraction cache chunks are incomplete or have missing indexes");
  if (!cache.reconciliation?.decision) throw new Error("Cached recovery requires a saved reconciliation decision");
  const aggregate = aggregateCachedChunks(cache.chunks, cache.run.cache_schema_version);
  const groups = buildDeterministicGroups(aggregate);
  const decision = parseCachedReconciliation(cache.reconciliation.decision, groups);
  const graph = buildCanonicalGraph(aggregate, decision);
  if (campaignId === TEST_THREE_CAMPAIGN_ID && (graph.entities.length !== 112 || graph.relationships.length !== 145)) throw new Error(`Cached Test 3 graph mismatch: expected 112 entities and 145 relationships, received ${graph.entities.length} and ${graph.relationships.length}`);
  const playerVisibleEstimate = graph.entities.length;
  const callBreakdown = expectedEnrichmentCallBreakdown(graph.entities.length, graph.facts.length, graph.relationships.length, playerVisibleEstimate);
  const expectedEnrichmentCalls = Object.values(callBreakdown).reduce((sum, count) => sum + count, 0);
  if (expectedEnrichmentCalls > 40) throw new Error(`Expected enrichment call count ${expectedEnrichmentCalls} exceeds the safety cap`);
  return { campaign, document, cache, aggregate, graph, graphFingerprint: enrichmentGraphFingerprint(graph), callBreakdown, expectedEnrichmentCalls };
}

export async function recoverCampaignFromCachedExtraction(campaignId: string, options: { execute?: boolean } = {}) {
  const preflight = await preflightCachedRecovery(campaignId);
  const report = { campaign: preflight.campaign.name, campaignId, extractionCacheId: preflight.cache.run.id, extraction: "REUSE" as const, reconciliation: "REUSE" as const, extractionApiCalls: 0, reconciliationApiCalls: 0, canonicalEntities: preflight.graph.entities.length, canonicalFacts: preflight.graph.facts.length, canonicalRelationships: preflight.graph.relationships.length, graphFingerprint: preflight.graphFingerprint, enrichmentModel: getOpenAIEnv().OPENAI_ENRICHMENT_MODEL, expectedEnrichmentCallBreakdown: preflight.callBreakdown, expectedEnrichmentCalls: preflight.expectedEnrichmentCalls, persistence: options.execute ? "will run after successful enrichment" : "dry-run; no writes or model calls" };
  if (!options.execute) return report;
  await recordProcessingRun(campaignId, "cached_recovery", "started", { input: { extractionCacheId: preflight.cache.run.id, extractionApiCalls: 0, reconciliationApiCalls: 0 } });
  await updateCampaign(campaignId, { status: "reconciling", processing_stage: "Reusing cached campaign knowledge", error_message: null });
  const cacheId = await createEnrichmentCacheRun(campaignId, preflight.document.id, preflight.cache.run.id, report.enrichmentModel, preflight.graphFingerprint);
  try {
    await recordProcessingRun(campaignId, "cached_extraction_reuse", "complete", { output: { cacheRunId: preflight.cache.run.id, apiCalls: 0 } });
    await recordProcessingRun(campaignId, "cached_reconciliation_reuse", "complete", { output: { apiCalls: 0, canonicalEntities: preflight.graph.entities.length, canonicalRelationships: preflight.graph.relationships.length } });
    await updateCampaign(campaignId, { processing_stage: "Classifying cached campaign knowledge" });
    const enriched = await enrichCanonicalGraphWithAI(preflight.graph);
    const usage = summarizeModelUsage("enrichment", enriched.usage);
    await finishEnrichmentCacheRun(cacheId, "complete", enriched.output, usage as unknown as Json);
    await recordProcessingRun(campaignId, "recovery_enrichment", "complete", { output: { modelUsage: usage, ...buildEnrichmentDiagnostics(enriched.graph) } as unknown as Json });
    await updateCampaign(campaignId, { status: "persisting", processing_stage: "Building wiki from cached campaign knowledge" });
    await persistCanonicalGraph(campaignId, preflight.document.id, enriched.graph);
    const diagnostics = { ...report, mode: "cached-enrichment-recovery", originalExtractionCacheId: preflight.cache.run.id, originalReconciliationReused: true, modelUsage: usage, ...buildEnrichmentDiagnostics(enriched.graph), initialFailedEnrichmentUsage: "unmeasured historical usage" };
    await updateCampaign(campaignId, { status: "complete", processing_stage: "Wiki generated", error_message: null, processing_diagnostics: diagnostics as unknown as Json });
    await recordProcessingRun(campaignId, "cached_recovery", "complete", { output: diagnostics as unknown as Json });
    return { ...diagnostics, enrichmentCacheId: cacheId };
  } catch (error) {
    const usage = error instanceof EnrichmentFailure ? error.usage : [];
    const message = error instanceof Error ? error.message : "Unknown cached recovery failure";
    await finishEnrichmentCacheRun(cacheId, "failed", undefined, summarizeModelUsage("enrichment", usage) as unknown as Json, message).catch(() => undefined);
    await updateCampaign(campaignId, { status: "failed", processing_stage: "Cached enrichment recovery failed", error_message: message }).catch(() => undefined);
    await recordProcessingRun(campaignId, "cached_recovery", "failed", { error: message, output: { modelUsage: summarizeModelUsage("enrichment", usage) } as unknown as Json });
    throw error;
  }
}
