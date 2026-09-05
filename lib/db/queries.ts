import "server-only";

import { createAdminClient, requireData } from "@/lib/db/client";
import type { EntityType } from "@/lib/db/types";
import { relationshipsForEntity } from "@/lib/relationships/view";

export async function getCampaign(campaignId: string) {
  const client = createAdminClient();
  const result = await client.from("campaigns").select("*").eq("id", campaignId).single();
  return requireData(result.data, result.error, "Load campaign");
}

export async function getCampaignEntities(campaignId: string, type?: EntityType) {
  const client = createAdminClient();
  let query = client.from("entities").select("id,name,type,aliases,summary").eq("campaign_id", campaignId);
  if (type) query = query.eq("type", type);
  const result = await query.order("name");
  return requireData(result.data, result.error, "Load campaign entities");
}

export async function searchCampaignEntities(campaignId: string, term: string) {
  const normalizedTerm = term.trim().toLocaleLowerCase("en-US");
  if (!normalizedTerm) return [];
  const entities = await getCampaignEntities(campaignId);
  return entities.filter((entity) =>
    entity.name.toLocaleLowerCase("en-US").includes(normalizedTerm)
    || entity.aliases.some((alias) => alias.toLocaleLowerCase("en-US").includes(normalizedTerm)),
  );
}

export async function getEntityDetail(campaignId: string, entityId: string) {
  const client = createAdminClient();
  const entityResult = await client.from("entities").select("*").eq("campaign_id", campaignId).eq("id", entityId).single();
  const entity = requireData(entityResult.data, entityResult.error, "Load entity");

  const [allRelationshipResult, entitySourcesResult] = await Promise.all([
    client
      .from("relationships")
      .select("*")
      .eq("campaign_id", campaignId)
      .or(`source_entity_id.eq.${entity.id},target_entity_id.eq.${entity.id}`),
    client.from("entity_sources").select("*").eq("entity_id", entityId).order("page_number"),
  ]);
  const allRelationships = requireData(allRelationshipResult.data, allRelationshipResult.error, "Load relationships");
  const relevant = relationshipsForEntity(allRelationships, entityId);
  const relatedIds = [...new Set(relevant.map((relationship) => relationship.relatedEntityId))];
  const relatedResult = relatedIds.length
    ? await client.from("entities").select("id,name,type").in("id", relatedIds)
    : { data: [], error: null };
  const related = requireData(relatedResult.data, relatedResult.error, "Load related entities");
  const relatedById = new Map(related.map((item) => [item.id, item]));

  const relationshipIds = relevant.map((relationship) => relationship.id);
  const relationshipSourcesResult = relationshipIds.length
    ? await client.from("relationship_sources").select("*").in("relationship_id", relationshipIds).order("page_number")
    : { data: [], error: null };
  const relationshipSources = requireData(relationshipSourcesResult.data, relationshipSourcesResult.error, "Load relationship sources");
  const entitySources = requireData(entitySourcesResult.data, entitySourcesResult.error, "Load entity sources");
  const documentIds = [...new Set([...entitySources, ...relationshipSources].map((source) => source.document_id))];
  const documentsResult = documentIds.length
    ? await client.from("documents").select("id,filename").in("id", documentIds)
    : { data: [], error: null };
  const documents = requireData(documentsResult.data, documentsResult.error, "Load source documents");
  const filenameById = new Map(documents.map((document) => [document.id, document.filename]));

  return {
    entity,
    sources: entitySources.map((source) => ({ ...source, filename: filenameById.get(source.document_id) ?? "Campaign PDF" })),
    relationships: relevant.map((relationship) => ({
      ...relationship,
      relatedEntity: relatedById.get(relationship.relatedEntityId),
      sources: relationshipSources
        .filter((source) => source.relationship_id === relationship.id)
        .map((source) => ({ ...source, filename: filenameById.get(source.document_id) ?? "Campaign PDF" })),
    })),
  };
}
