import "server-only";

import type { Database, Json } from "@/lib/db/types";
import { createAdminClient, requireData } from "@/lib/db/client";
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

export async function loadCampaignForProcessing(campaignId: string) {
  const client = createAdminClient();
  const campaignResult = await client.from("campaigns").select("*").eq("id", campaignId).single();
  const campaign = requireData(campaignResult.data, campaignResult.error, "Load campaign");
  const documentResult = await client.from("documents").select("*").eq("campaign_id", campaignId).single();
  const document = requireData(documentResult.data, documentResult.error, "Load document");
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
    aliases: entity.aliases,
    summary: entity.summary,
    sources: entity.sources,
    metadata: { candidateIds: entity.candidateIds, mergeReason: entity.mergeReason },
  }));
  const relationships = graph.relationships.map((relationship) => ({
    ...relationship,
    metadata: { candidateRelationshipIds: relationship.candidateRelationshipIds },
  }));
  const { data, error } = await client.rpc("replace_campaign_graph", {
    p_campaign_id: campaignId,
    p_document_id: documentId,
    p_entities: entities as Json,
    p_relationships: relationships as Json,
  });
  return requireData(data, error, "Persist canonical graph");
}
