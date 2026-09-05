import "server-only";

import { extractChunksLimited } from "@/lib/ai/extract";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import { claimCampaignForProcessing, loadCampaignForProcessing, persistCanonicalGraph, recordProcessingRun, updateCampaign } from "@/lib/db/repository";
import { getProcessingEnv } from "@/lib/env";
import { aggregateCandidates } from "@/lib/graph/aggregate";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { chunkPages } from "@/lib/pdf/chunk-pages";

export async function processCampaign(campaignId: string) {
  const startedAt = Date.now();
  let ownsProcessing = false;
  try {
    const { campaign, document, pages } = await loadCampaignForProcessing(campaignId);
    if (campaign.status === "complete") return { alreadyComplete: true };
    if (!(["uploaded", "failed"] as string[]).includes(campaign.status)) throw new Error(`Campaign is already processing (${campaign.status})`);
    if (pages.length === 0) throw new Error("Campaign document has no extracted pages");

    if (!(await claimCampaignForProcessing(campaignId))) throw new Error("Campaign was claimed by another processing request");
    ownsProcessing = true;
    const chunks = chunkPages(pages, { targetCharacters: getProcessingEnv().PDF_CHUNK_TARGET_CHARACTERS, overlapPages: 1 });
    await recordProcessingRun(campaignId, "candidate_extraction", "started", { input: { pageCount: pages.length, chunkCount: chunks.length } });
    const extracted = await extractChunksLimited(chunks);
    const rejectedSources = extracted.reduce((count, chunk) => count + chunk.diagnostics.length, 0);
    const aggregate = aggregateCandidates(extracted.map((chunk) => ({ chunkId: chunk.chunkId, ...chunk.extraction })));
    await recordProcessingRun(campaignId, "candidate_extraction", "complete", {
      output: { entityCandidates: aggregate.entities.length, relationshipCandidates: aggregate.relationships.length, rejectedItems: rejectedSources },
    });

    await updateCampaign(campaignId, { status: "reconciling", processing_stage: "Connecting campaign information" });
    const groups = buildDeterministicGroups(aggregate);
    const decision = await reconcileGroupsWithAI(groups);
    const graph = buildCanonicalGraph(aggregate, decision);
    await recordProcessingRun(campaignId, "reconciliation", "complete", {
      input: { candidateEntities: aggregate.entities.length, deterministicGroups: groups.length },
      output: { canonicalEntities: graph.entities.length, resolvedRelationships: graph.relationships.length, discardedRelationships: graph.discardedRelationships.length },
    });

    await updateCampaign(campaignId, { status: "persisting", processing_stage: "Building wiki" });
    await persistCanonicalGraph(campaignId, document.id, graph);
    const durationMs = Date.now() - startedAt;
    const diagnostics = {
      pageCount: pages.length,
      chunkCount: chunks.length,
      candidateEntityCount: aggregate.entities.length,
      canonicalEntityCount: graph.entities.length,
      relationshipCount: graph.relationships.length,
      discardedRelationshipCount: graph.discardedRelationships.length,
      rejectedSourceCount: rejectedSources,
      durationMs,
    };
    await updateCampaign(campaignId, { status: "complete", processing_stage: "Wiki generated", processing_diagnostics: diagnostics });
    return diagnostics;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown campaign processing failure";
    if (ownsProcessing) {
      await updateCampaign(campaignId, { status: "failed", processing_stage: "Processing failed", error_message: message }).catch(() => undefined);
      await recordProcessingRun(campaignId, "pipeline", "failed", { error: message });
    }
    throw error;
  }
}
