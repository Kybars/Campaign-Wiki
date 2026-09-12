import "server-only";

import { extractChunksLimited } from "@/lib/ai/extract";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import { EnrichmentFailure, enrichCanonicalGraphWithAI } from "@/lib/ai/enrich";
import { enrichmentGraphFingerprint } from "@/lib/ai/enrichment-input";
import { parseCampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import {
  claimCampaignForProcessing,
  createExtractionCacheRun,
  createEnrichmentCacheRun,
  finishExtractionCacheRun,
  finishEnrichmentCacheRun,
  loadCampaignForProcessing,
  loadCompleteEnrichmentCache,
  persistCanonicalGraph,
  recordProcessingRun,
  saveExtractionCacheChunk,
  saveReconciliationCacheResult,
  updateCampaign,
} from "@/lib/db/repository";
import { assertAIProviderPersistenceAllowed, getAIProviderConfig, getProcessingEnv } from "@/lib/env";
import { getStructuredModelProvider } from "@/lib/ai/structured-model-provider-runtime";
import { summarizeModelUsage, type ModelCallUsage } from "@/lib/ai/usage";
import type { Json } from "@/lib/db/types";
import { aggregateCandidates } from "@/lib/graph/aggregate";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { applyCampaignEnrichment, buildEnrichmentDiagnostics } from "@/lib/graph/enrichment";
import { applyLeanGraphDefaults, buildLeanDiagnostics } from "@/lib/graph/lean";
import type { CanonicalGraph } from "@/lib/graph/types";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { chunkPages } from "@/lib/pdf/chunk-pages";
import { resolveProcessingMode, type ProcessingMode } from "@/lib/processing/mode";
import { databaseCheckpointStore } from "@/lib/processing/checkpoint-store";

export async function processCampaign(campaignId: string, options: { processingMode?: ProcessingMode } = {}) {
  const startedAt = Date.now();
  const processingMode = resolveProcessingMode(options.processingMode);
  let ownsProcessing = false;
  let cacheRunId: string | undefined;
  let cacheComplete = false;
  try {
    const { campaign, document, pages } = await loadCampaignForProcessing(campaignId);
    if (campaign.status === "complete") return { alreadyComplete: true };
    if (!(["uploaded", "failed"] as string[]).includes(campaign.status)) throw new Error(`Campaign is already processing (${campaign.status})`);
    if (pages.length === 0) throw new Error("Campaign document has no extracted pages");

    if (!(await claimCampaignForProcessing(campaignId))) throw new Error("Campaign was claimed by another processing request");
    ownsProcessing = true;
    const checkpointStore = databaseCheckpointStore();
    const extractionProvider = getStructuredModelProvider("extraction");
    const reconciliationProvider = getStructuredModelProvider("reconciliation");
    assertAIProviderPersistenceAllowed(getAIProviderConfig("extraction"));
    assertAIProviderPersistenceAllowed(getAIProviderConfig("reconciliation"));
    const chunking = { targetCharacters: getProcessingEnv().PDF_CHUNK_TARGET_CHARACTERS, overlapPages: 1 };
    const chunks = chunkPages(pages, chunking);
    cacheRunId = await createExtractionCacheRun(
      campaignId,
      document.id,
      extractionProvider.providerId === "local" ? `local:${extractionProvider.modelId}` : extractionProvider.modelId,
      { ...chunking, pageCount: pages.length, chunkCount: chunks.length },
    );
    await recordProcessingRun(campaignId, "candidate_extraction", "started", { input: { processingMode, pageCount: pages.length, chunkCount: chunks.length } });
    const extracted = await extractChunksLimited(chunks, undefined, async (result, chunk, index) => {
      await saveExtractionCacheChunk(cacheRunId!, result, index, chunk.pages.map((page) => page.pageNumber));
    }, extractionProvider, { campaignId, documentId: document.id, processingMode, store: checkpointStore });
    await finishExtractionCacheRun(cacheRunId, "complete");
    cacheComplete = true;
    const rejectedSources = extracted.reduce((count, chunk) => count + chunk.diagnostics.length, 0);
    const aggregate = aggregateCandidates(extracted.map((chunk) => ({ chunkId: chunk.chunkId, ...chunk.extraction })));
    const extractionCalls = extracted.filter((chunk) => chunk.checkpointStatus !== "REUSE").map((chunk) => chunk.usage);
    const extractionUsage = summarizeModelUsage("candidate_extraction", extractionCalls);
    await recordProcessingRun(campaignId, "candidate_extraction", "complete", {
      output: {
        mode: "live",
        processingMode,
        provider: extractionProvider.providerId,
        model: extractionProvider.modelId,
        cacheHits: extracted.filter((chunk) => chunk.checkpointStatus === "REUSE").length,
        cacheMisses: extractionCalls.length,
        entityCandidates: aggregate.entities.length,
        factCandidates: aggregate.entities.reduce((count, entity) => count + (entity.facts?.length ?? 0), 0),
        relationshipCandidates: aggregate.relationships.length,
        rejectedItems: rejectedSources,
        modelUsage: extractionUsage,
      } as unknown as Json,
    });

    await updateCampaign(campaignId, { status: "reconciling", processing_stage: "Connecting campaign information" });
    const groups = buildDeterministicGroups(aggregate);
    const reconciliation = await reconcileGroupsWithAI(groups, reconciliationProvider, { campaignId, documentId: document.id, sourceExtractionCacheId: cacheRunId, store: checkpointStore });
    await saveReconciliationCacheResult(cacheRunId, reconciliation);
    const canonicalGraph = buildCanonicalGraph(aggregate, reconciliation.decision);
    const reconciliationUsage = summarizeModelUsage("reconciliation", reconciliation.usage ? [reconciliation.usage] : []);
    await recordProcessingRun(campaignId, "reconciliation", "complete", {
      input: { candidateEntities: aggregate.entities.length, deterministicGroups: groups.length },
      output: {
        canonicalEntities: canonicalGraph.entities.length,
        processingMode,
        provider: reconciliationProvider.providerId,
        model: reconciliationProvider.modelId,
        ...canonicalGraph.factAggregationDiagnostics,
        resolvedRelationships: canonicalGraph.relationships.length,
        discardedRelationships: canonicalGraph.discardedRelationships.length,
        locationHierarchyDiagnostics: canonicalGraph.locationHierarchyDiagnostics,
        modelUsage: reconciliationUsage,
      } as unknown as Json,
    });

    const graphFingerprint = enrichmentGraphFingerprint(canonicalGraph);
    let graph: CanonicalGraph;
    let enrichmentCalls: ModelCallUsage[] = [];
    let enrichmentCheckpointReport: Array<{ status: "REUSE" | "RUN" }> = [];
    let openAIGenerationCallsAfterReconciliation = 0;
    let enrichmentDiagnostics: ReturnType<typeof buildEnrichmentDiagnostics> | ReturnType<typeof buildLeanDiagnostics>;
    if (processingMode === "lean") {
      graph = applyLeanGraphDefaults(canonicalGraph);
      enrichmentDiagnostics = buildLeanDiagnostics(graph);
      await recordProcessingRun(campaignId, "enrichment", "complete", { output: {
        ...enrichmentDiagnostics,
        mode: "skipped_by_processing_mode",
        cacheHits: 0,
        cacheMisses: 0,
        provider: null,
        model: null,
        modelUsage: summarizeModelUsage("enrichment", []),
      } as unknown as Json });
    } else {
      await updateCampaign(campaignId, { processing_stage: "Classifying campaign knowledge" });
      const enrichmentProvider = getAIProviderConfig("enrichment");
      assertAIProviderPersistenceAllowed(enrichmentProvider);
      const enrichmentStructuredProvider = getStructuredModelProvider("enrichment");
      const enrichmentModel = enrichmentProvider.providerId === "openai" ? enrichmentProvider.modelId : `local:${enrichmentProvider.modelId}`;
      const cachedEnrichment = await loadCompleteEnrichmentCache(campaignId, document.id, graphFingerprint, enrichmentModel);
      let enrichmentMode: "live" | "replay" = "replay";
      if (cachedEnrichment?.output) {
        graph = applyCampaignEnrichment(canonicalGraph, parseCampaignEnrichmentOutput(cachedEnrichment.output));
      } else {
        enrichmentMode = "live";
        const enrichmentCacheId = await createEnrichmentCacheRun(campaignId, document.id, cacheRunId, enrichmentModel, graphFingerprint);
        try {
          const enriched = await enrichCanonicalGraphWithAI(canonicalGraph, { provider: enrichmentStructuredProvider, checkpointStore, checkpointContext: { campaignId, documentId: document.id, sourceExtractionCacheId: cacheRunId, processingMode: "full", providerId: enrichmentStructuredProvider.providerId, modelId: enrichmentStructuredProvider.modelId, graphFingerprint } });
          graph = enriched.graph;
          enrichmentCalls = enriched.usage;
          enrichmentCheckpointReport = enriched.checkpointReport ?? [];
          const usage = summarizeModelUsage("enrichment", enrichmentCalls);
          await finishEnrichmentCacheRun(enrichmentCacheId, "complete", enriched.output, usage as unknown as Json);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown enrichment failure";
          enrichmentCalls = error instanceof EnrichmentFailure ? error.usage : enrichmentCalls;
          await finishEnrichmentCacheRun(enrichmentCacheId, "failed", undefined, summarizeModelUsage("enrichment", enrichmentCalls) as unknown as Json, message).catch(() => undefined);
          throw error;
        }
      }
      enrichmentDiagnostics = buildEnrichmentDiagnostics(graph);
      const enrichmentUsage = summarizeModelUsage("enrichment", enrichmentCalls);
      openAIGenerationCallsAfterReconciliation = enrichmentProvider.providerId === "openai" ? enrichmentCalls.length : 0;
      await recordProcessingRun(campaignId, "enrichment", "complete", { output: {
        processingMode,
        enrichmentRequired: true,
        enrichmentCalls: enrichmentCalls.length,
        openAIGenerationCallsAfterReconciliation,
        mode: enrichmentMode,
        cacheHits: enrichmentMode === "replay" ? 1 : enrichmentCheckpointReport.filter((item) => item.status === "REUSE").length,
        cacheMisses: enrichmentMode === "live" ? enrichmentCalls.length : 0,
        modelUsage: enrichmentUsage,
        provider: enrichmentProvider.providerId,
        model: enrichmentProvider.modelId,
        ...enrichmentDiagnostics,
        checkpointReport: enrichmentCheckpointReport,
      } as unknown as Json });
    }
    const enrichmentUsage = summarizeModelUsage("enrichment", enrichmentCalls);

    await updateCampaign(campaignId, { status: "persisting", processing_stage: "Building wiki" });
    await persistCanonicalGraph(campaignId, document.id, graph);
    const durationMs = Date.now() - startedAt;
    const diagnostics = {
      pageCount: pages.length,
      chunkCount: chunks.length,
      candidateEntityCount: aggregate.entities.length,
      canonicalEntityCount: graph.entities.length,
      ...graph.factAggregationDiagnostics,
      relationshipCount: graph.relationships.length,
      discardedRelationshipCount: graph.discardedRelationships.length,
      locationHierarchyDiagnostics: graph.locationHierarchyDiagnostics,
      rejectedSourceCount: rejectedSources,
      modelUsage: [extractionUsage, reconciliationUsage, enrichmentUsage],
      knowledgeConsistencyDiagnostics: graph.knowledgeConsistencyDiagnostics,
      processingMode,
      enrichmentRequired: processingMode === "full",
      enrichmentCalls: enrichmentCalls.length,
      openAIGenerationCallsAfterReconciliation,
      graphFingerprint,
      enrichmentDiagnostics,
      mode: "live",
      cacheHits: 0,
      cacheMisses: chunks.length,
      durationMs,
    };
    await updateCampaign(campaignId, { status: "complete", processing_stage: "Wiki generated", processing_diagnostics: diagnostics as unknown as Json });
    return diagnostics;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown campaign processing failure";
    if (cacheRunId && !cacheComplete) await finishExtractionCacheRun(cacheRunId, "failed", message).catch(() => undefined);
    if (ownsProcessing) {
      await updateCampaign(campaignId, { status: "failed", processing_stage: "Processing failed", error_message: message }).catch(() => undefined);
      await recordProcessingRun(campaignId, "pipeline", "failed", { input: { processingMode }, error: message });
    }
    throw error;
  }
}
