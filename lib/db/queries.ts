import "server-only";

import { createAdminClient, requireData } from "@/lib/db/client";
import type { EntityRole, EntityType } from "@/lib/db/types";
import { filterEntitiesBySearchTerm } from "@/lib/entities";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";
import { relationshipsForEntity } from "@/lib/relationships/view";

function deduplicateSources<T extends { document_id: string; page_number: number; supporting_text: string }>(sources: T[]): T[] {
  const unique = new Map<string, T>();
  for (const source of sources) {
    const key = `${source.document_id}:${source.page_number}:${source.supporting_text.trim()}`;
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
}

export async function getCampaign(campaignId: string) {
  const client = createAdminClient();
  const result = await client.from("campaigns").select("*").eq("id", campaignId).single();
  return requireData(result.data, result.error, "Load campaign");
}

export async function getCampaigns() {
  const client = createAdminClient();
  const [campaignResult, entityResult] = await Promise.all([
    client
      .from("campaigns")
      .select("id,name,status,error_message,processing_stage,created_at")
      .order("created_at", { ascending: false }),
    client.from("entities").select("campaign_id"),
  ]);
  const campaigns = requireData(campaignResult.data, campaignResult.error, "Load campaigns");
  const entities = requireData(entityResult.data, entityResult.error, "Count campaign entities");
  const entityCounts = new Map<string, number>();

  for (const entity of entities) {
    entityCounts.set(entity.campaign_id, (entityCounts.get(entity.campaign_id) ?? 0) + 1);
  }

  return campaigns.map((campaign) => ({
    ...campaign,
    entityCount: entityCounts.get(campaign.id) ?? 0,
  }));
}

export async function getCampaignEntities(campaignId: string, type?: EntityType, role?: EntityRole) {
  const client = createAdminClient();
  let query = client.from("entities").select("id,name,type,roles,aliases,summary").eq("campaign_id", campaignId);
  if (type) query = query.eq("type", type);
  if (role) query = query.contains("roles", [role]);
  const result = await query.order("name");
  return requireData(result.data, result.error, "Load campaign entities");
}

export async function searchCampaignEntities(campaignId: string, term: string) {
  const entities = await getCampaignEntities(campaignId);
  return filterEntitiesBySearchTerm(entities, term);
}

export async function getEntityDetail(campaignId: string, entityId: string) {
  const client = createAdminClient();
  const entityResult = await client.from("entities").select("*").eq("campaign_id", campaignId).eq("id", entityId).single();
  const entity = requireData(entityResult.data, entityResult.error, "Load entity");

  const relationshipQuery = client.from("relationships").select("*").eq("campaign_id", campaignId);
  const relationshipPromise = entity.type === "location"
    ? relationshipQuery
    : relationshipQuery.or(`source_entity_id.eq.${entity.id},target_entity_id.eq.${entity.id}`);
  const locationPromise = entity.type === "location"
    ? client.from("entities").select("id,name").eq("campaign_id", campaignId).eq("type", "location")
    : Promise.resolve({ data: [], error: null });
  const [allRelationshipResult, entitySourcesResult, locationResult] = await Promise.all([
    relationshipPromise,
    client.from("entity_sources").select("*").eq("entity_id", entityId).order("page_number"),
    locationPromise,
  ]);
  const allRelationships = requireData(allRelationshipResult.data, allRelationshipResult.error, "Load relationships");
  const locations = requireData(locationResult.data, locationResult.error, "Load campaign locations");
  const relevant = relationshipsForEntity(allRelationships, entityId);
  const relatedIds = [...new Set(relevant.map((relationship) => relationship.relatedEntityId))];
  const relatedResult = relatedIds.length
    ? await client.from("entities").select("id,name,type").in("id", relatedIds)
    : { data: [], error: null };
  const related = requireData(relatedResult.data, relatedResult.error, "Load related entities");
  const relatedById = new Map(related.map((item) => [item.id, item]));

  const relationshipIds = [...new Set(relevant.flatMap((relationship) => relationship.relationshipIds))];
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
  const hierarchy = entity.type === "location"
    ? buildLocationHierarchy(
        locations,
        allRelationships.map((relationship) => ({
          id: relationship.id,
          sourceId: relationship.source_entity_id,
          targetId: relationship.target_entity_id,
          relationshipType: relationship.relationship_type,
          confidence: relationship.confidence,
        })),
      )
    : undefined;

  return {
    entity,
    locationHierarchy: hierarchy ? {
      parent: hierarchy.getParent(entityId),
      children: hierarchy.getChildren(entityId),
      isRoot: hierarchy.getParent(entityId) === undefined,
      isOrphan: hierarchy.getOrphans().some((location) => location.id === entityId),
    } : undefined,
    sources: entitySources.map((source) => ({ ...source, filename: filenameById.get(source.document_id) ?? "Campaign PDF" })),
    relationships: relevant.map((relationship) => ({
      ...relationship,
      relatedEntity: relatedById.get(relationship.relatedEntityId),
      sources: deduplicateSources(relationshipSources
        .filter((source) => relationship.relationshipIds.includes(source.relationship_id)))
        .map((source) => ({ ...source, filename: filenameById.get(source.document_id) ?? "Campaign PDF" })),
    })),
  };
}
