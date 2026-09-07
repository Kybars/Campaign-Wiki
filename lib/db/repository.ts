import "server-only";

import type { Database, Json } from "@/lib/db/types";
import { createAdminClient, requireData } from "@/lib/db/client";
import type { ExtractedChunk } from "@/lib/ai/extract";
import type { ReconciliationResult } from "@/lib/ai/reconcile";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { CanonicalGraph } from "@/lib/graph/types";
import type { DocumentPage } from "@/lib/pdf/types";

export async function updateCampaign(campaignId: string, values: Database["public"]["Tables"]["campaigns"]["Update"]) {
  const client = createAdminClient();
  const { error } = await client.from("campaigns").update(values).eq("id", campaignId);
  if (error) throw new Error(`Update campaign: ${error.message}`);
}

export async function claimCampaignForProcessing(campaignId: string): Promise<boolean> {
  const client = createAdminClient();
  const { data, error } = await client
    .from("campaigns")
    .update({ status: "extracting_candidates", processing_stage: "Finding campaign entities", error_message: null })
    .eq("id", campaignId)
    .in("status", ["uploaded", "failed"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Claim campaign processing: ${error.message}`);
  return data !== null;
}

export async function recordProcessingRun(
  campaignId: string,
  stage: string,
  status: "started" | "complete" | "failed",
  metadata: { input?: Json; output?: Json; error?: string } = {},
) {
  const client = createAdminClient();
  const { error } = await client.from("processing_runs").insert({
    campaign_id: campaignId,
    stage,
    status,
    input_metadata: metadata.input ?? {},
    output_metadata: metadata.output ?? {},
    error_message: metadata.error ?? null,
  });
  if (error) console.error("Could not save processing diagnostic", { campaignId, stage, message: error.message });
}

function usageColumns(usage: ModelCallUsage | undefined) {
  return {
    model: usage?.model ?? null,
    response_id: usage?.responseId ?? null,
    input_tokens: usage?.inputTokens ?? null,
    cached_input_tokens: usage?.cachedInputTokens ?? null,
    cache_write_tokens: usage?.cacheWriteTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
    estimated_cost_usd: usage?.estimatedCostUsd ?? null,
  };
}

export async function createExtractionCacheRun(
  campaignId: string,
  documentId: string,
  extractionModel: string,
  chunkingMetadata: Json,
): Promise<string> {
  const client = createAdminClient();
  const { data, error } = await client.from("extraction_cache_runs").insert({
    campaign_id: campaignId,
    document_id: documentId,
    status: "started",
    extraction_model: extractionModel,
    cache_schema_version: 3,
    chunking_metadata: chunkingMetadata,
  }).select("id").single();
  return requireData(data, error, "Create extraction cache run").id;
}

export async function saveExtractionCacheChunk(
  cacheRunId: string,
  result: ExtractedChunk,
  chunkIndex: number,
  pageNumbers: number[],
) {
  const client = createAdminClient();
  const { error } = await client.from("extraction_cache_chunks").insert({
    cache_run_id: cacheRunId,
    chunk_id: result.chunkId,
    chunk_index: chunkIndex,
    page_numbers: pageNumbers,
    raw_output: result.rawExtraction as Json,
    validated_output: result.extraction as Json,
    validation_diagnostics: result.diagnostics as unknown as Json,
    ...usageColumns(result.usage),
    model: result.usage.model,
  });
  if (error) throw new Error(`Save extraction cache chunk: ${error.message}`);
}

export async function finishExtractionCacheRun(cacheRunId: string, status: "complete" | "failed", errorMessage?: string) {
  const client = createAdminClient();
  const { error } = await client.from("extraction_cache_runs").update({
    status,
    error_message: errorMessage ?? null,
    completed_at: new Date().toISOString(),
  }).eq("id", cacheRunId);
  if (error) throw new Error(`Finish extraction cache run: ${error.message}`);
}

export async function saveReconciliationCacheResult(cacheRunId: string, result: ReconciliationResult) {
  const client = createAdminClient();
  const { error } = await client.from("reconciliation_cache_results").insert({
    cache_run_id: cacheRunId,
    decision: (result.decision ?? null) as Json,
    ...usageColumns(result.usage),
  });
  if (error) throw new Error(`Save reconciliation cache result: ${error.message}`);
}

export async function loadLatestCompleteExtractionCache(campaignId: string) {
  const client = createAdminClient();
  const runResult = await client.from("extraction_cache_runs")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runResult.error) throw new Error(`Load extraction cache run: ${runResult.error.message}`);
  const run = runResult.data;
  if (!run) throw new Error(`Campaign ${campaignId} has no complete extraction cache and cannot be replayed`);
  const chunksResult = await client.from("extraction_cache_chunks")
    .select("*")
    .eq("cache_run_id", run.id)
    .order("chunk_index");
  const chunks = requireData(chunksResult.data, chunksResult.error, "Load extraction cache chunks");
  const reconciliationResult = await client.from("reconciliation_cache_results")
    .select("*")
    .eq("cache_run_id", run.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reconciliationResult.error) throw new Error(`Load reconciliation cache result: ${reconciliationResult.error.message}`);
  return { run, chunks, reconciliation: reconciliationResult.data };
}

export async function loadCampaignAndDocument(campaignId: string) {
  const client = createAdminClient();
  const campaignResult = await client.from("campaigns").select("*").eq("id", campaignId).single();
  const campaign = requireData(campaignResult.data, campaignResult.error, "Load campaign");
  const documentResult = await client.from("documents").select("*").eq("campaign_id", campaignId).single();
  const document = requireData(documentResult.data, documentResult.error, "Load document");
  return { campaign, document };
}

export async function loadCampaignForProcessing(campaignId: string) {
  const client = createAdminClient();
  const { campaign, document } = await loadCampaignAndDocument(campaignId);
  const pagesResult = await client.from("document_pages").select("page_number,text").eq("document_id", document.id).order("page_number");
  const pages = requireData(pagesResult.data, pagesResult.error, "Load document pages").map(
    (page): DocumentPage => ({ pageNumber: page.page_number, text: page.text }),
  );
  return { campaign, document, pages };
}

export async function persistCanonicalGraph(campaignId: string, documentId: string, graph: CanonicalGraph) {
  const client = createAdminClient();
  const entities = graph.entities.map((entity) => ({
    key: entity.key,
    name: entity.name,
    normalizedName: entity.normalizedName,
    type: entity.type,
    roles: entity.roles,
    aliases: entity.aliases,
    summary: entity.summary,
    sources: entity.sources,
    metadata: {
      candidateIds: entity.candidateIds,
      mergeReason: entity.mergeReason,
      reconciliationEvidence: entity.reconciliationEvidence,
      roleSources: entity.roleSources,
    },
  }));
  const relationships = graph.relationships.map((relationship) => ({
    ...relationship,
    metadata: {
      candidateRelationshipIds: relationship.candidateRelationshipIds,
      normalization: relationship.normalization,
    },
  }));
  const { data, error } = await client.rpc("replace_campaign_graph", {
    p_campaign_id: campaignId,
    p_document_id: documentId,
    p_entities: entities as Json,
    p_relationships: relationships as Json,
  });
  return requireData(data, error, "Persist canonical graph");
}
