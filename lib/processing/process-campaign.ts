import "server-only";

import { extractChunksLimited } from "@/lib/ai/extract";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import {
  claimCampaignForProcessing,
  createExtractionCacheRun,
  finishExtractionCacheRun,
  loadCampaignForProcessing,
  persistCanonicalGraph,
  recordProcessingRun,
  saveExtractionCacheChunk,
  saveReconciliationCacheResult,
  updateCampaign,
} from "@/lib/db/repository";
import { getOpenAIEnv, getProcessingEnv } from "@/lib/env";
import { summarizeModelUsage } from "@/lib/ai/usage";
import type { Json } from "@/lib/db/types";
import { aggregateCandidates } from "@/lib/graph/aggregate";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { chunkPages } from "@/lib/pdf/chunk-pages";

export async function processCampaign(campaignId: string) {
  const startedAt = Date.now();
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
    const chunking = { targetCharacters: getProcessingEnv().PDF_CHUNK_TARGET_CHARACTERS, overlapPages: 1 };
    const chunks = chunkPages(pages, chunking);
    cacheRunId = await createExtractionCacheRun(
      campaignId,
      document.id,
      getOpenAIEnv().OPENAI_EXTRACTION_MODEL,
      { ...chunking, pageCount: pages.length, chunkCount: chunks.length },
    );
    await recordProcessingRun(campaignId, "candidate_extraction", "started", { input: { pageCount: pages.length, chunkCount: chunks.length } });
    const extracted = await extractChunksLimited(chunks, undefined, async (result, chunk, index) => {
      await saveExtractionCacheChunk(cacheRunId!, result, index, chunk.pages.map((page) => page.pageNumber));
    });
    await finishExtractionCacheRun(cacheRunId, "complete");
    cacheComplete = true;
    const rejectedSources = extracted.reduce((count, chunk) => count + chunk.diagnostics.length, 0);
    const aggregate = aggregateCandidates(extracted.map((chunk) => ({ chunkId: chunk.chunkId, ...chunk.extraction })));
    const extractionUsage = summarizeModelUsage("candidate_extraction", extracted.map((chunk) => chunk.usage));
    await recordProcessingRun(campaignId, "candidate_extraction", "complete", {
      output: {
        mode: "live",
        cacheHits: 0,
        cacheMisses: chunks.length,
        entityCandidates: aggregate.entities.length,
        factCandidates: aggregate.entities.reduce((count, entity) => count + (entity.facts?.length ?? 0), 0),
        relationshipCandidates: aggregate.relationships.length,
        rejectedItems: rejectedSources,
        modelUsage: extractionUsage,
      } as unknown as Json,
    });

    await updateCampaign(campaignId, { status: "reconciling", processing_stage: "Connecting campaign information" });
    const groups = buildDeterministicGroups(aggregate);
    const reconciliation = await reconcileGroupsWithAI(groups);
    await saveReconciliationCacheResult(cacheRunId, reconciliation);
    const graph = buildCanonicalGraph(aggregate, reconciliation.decision);
    const reconciliationUsage = summarizeModelUsage("reconciliation", reconciliation.usage ? [reconciliation.usage] : []);
    await recordProcessingRun(campaignId, "reconciliation", "complete", {
      input: { candidateEntities: aggregate.entities.length, deterministicGroups: groups.length },
      output: {
        canonicalEntities: graph.entities.length,
        ...graph.factAggregationDiagnostics,
        resolvedRelationships: graph.relationships.length,
        discardedRelationships: graph.discardedRelationships.length,
        locationHierarchyDiagnostics: graph.locationHierarchyDiagnostics,
        modelUsage: reconciliationUsage,
      } as unknown as Json,
    });

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
      modelUsage: [extractionUsage, reconciliationUsage],
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
      await recordProcessingRun(campaignId, "pipeline", "failed", { error: message });
    }
    throw error;
  }
}
