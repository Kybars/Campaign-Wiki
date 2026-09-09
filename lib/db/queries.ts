import "server-only";

import { createAdminClient, requireData } from "@/lib/db/client";
import type { Database, EntityRole, EntityType } from "@/lib/db/types";
import { filterEntitiesBySearchTerm } from "@/lib/entities";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";
import { relationshipsForEntity } from "@/lib/relationships/view";
import { visibleEntities, visibleFacts, visibleRelationships, visibleSummary, type CampaignViewMode } from "@/lib/campaign-view";

type EntitySourceRow = Database["public"]["Tables"]["entity_sources"]["Row"];
type RelationshipSourceRow = Database["public"]["Tables"]["relationship_sources"]["Row"];
type DocumentEntitySource = EntitySourceRow & { origin: "document"; document_id: string; page_number: number; supporting_text: string };
type DocumentRelationshipSource = RelationshipSourceRow & { origin: "document"; document_id: string; page_number: number; supporting_text: string };

function isDocumentEntitySource(source: EntitySourceRow): source is DocumentEntitySource {
  return source.origin === "document"
    && source.document_id !== null
    && source.page_number !== null
    && source.supporting_text !== null;
}

function isDocumentRelationshipSource(source: RelationshipSourceRow): source is DocumentRelationshipSource {
  return source.origin === "document"
    && source.document_id !== null
    && source.page_number !== null
    && source.supporting_text !== null;
}

function deduplicateSources<T extends { document_id: string; page_number: number; supporting_text: string }>(sources: T[]): T[] {
  const unique = new Map<string, T>();
  for (const source of sources) {
    const key = `${source.document_id}:${source.page_number}:${source.supporting_text.trim()}`;
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
}

export async function getCampaign(campaignId: string, viewMode: CampaignViewMode = "dm") {
  const client = createAdminClient();
  const result = await client.from("campaigns").select("*").eq("id", campaignId).single();
  const campaign = requireData(result.data, result.error, "Load campaign");
  const { gm_overview, player_overview, ...safeCampaign } = campaign;
  return { ...safeCampaign, overview: viewMode === "dm" ? gm_overview : player_overview };
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

export async function getCampaignEntities(campaignId: string, type?: EntityType, role?: EntityRole, viewMode: CampaignViewMode = "dm") {
  const client = createAdminClient();
  let query = client.from("entities").select("id,name,type,roles,aliases,summary,gm_summary,player_summary,visibility,prominence").eq("campaign_id", campaignId);
  if (type) query = query.eq("type", type);
  if (role) query = query.contains("roles", [role]);
  if (viewMode === "player") query = query.eq("visibility", "player_visible");
  const result = await query.order("name");
  return visibleEntities(requireData(result.data, result.error, "Load campaign entities"), viewMode)
    .map((entity) => {
      const { gm_summary, player_summary, summary: legacySummary, ...safeEntity } = entity;
      return { ...safeEntity, summary: visibleSummary({ ...safeEntity, gm_summary, player_summary, summary: legacySummary }, viewMode) };
    });
}

export async function searchCampaignEntities(campaignId: string, term: string, viewMode: CampaignViewMode = "dm") {
  const entities = await getCampaignEntities(campaignId, undefined, undefined, viewMode);
  return filterEntitiesBySearchTerm(entities, term);
}

export async function getCampaignLocationHierarchy(campaignId: string, viewMode: CampaignViewMode = "dm") {
  const client = createAdminClient();
  const [locationsResult, relationshipsResult] = await Promise.all([
    client.from("entities").select("id,name,visibility").eq("campaign_id", campaignId).eq("type", "location").order("name"),
    client.from("relationships").select("id,source_entity_id,target_entity_id,relationship_type,confidence,visibility").eq("campaign_id", campaignId),
  ]);
  const locations = requireData(locationsResult.data, locationsResult.error, "Load campaign locations");
  const relationships = requireData(relationshipsResult.data, relationshipsResult.error, "Load campaign containment relationships");
  const visibleLocations = visibleEntities(locations.map((location) => ({ ...location, type: "location" as const, roles: [], aliases: [] })), viewMode);
  const visibleRelationshipsForView = visibleRelationships(relationships, locations.map((location) => ({ ...location, type: "location" as const, roles: [], aliases: [] })), viewMode);
  return buildLocationHierarchy(visibleLocations, visibleRelationshipsForView.map((relationship) => ({
    id: relationship.id,
    sourceId: relationship.source_entity_id,
    targetId: relationship.target_entity_id,
    relationshipType: relationship.relationship_type,
    confidence: relationship.confidence,
    visibility: relationship.visibility,
  })));
}

export async function getEntityDetail(campaignId: string, entityId: string, viewMode: CampaignViewMode = "dm") {
  const client = createAdminClient();
  let entityQuery = client.from("entities").select("*").eq("campaign_id", campaignId).eq("id", entityId);
  if (viewMode === "player") entityQuery = entityQuery.eq("visibility", "player_visible");
  const entityResult = await entityQuery.single();
  const entity = requireData(entityResult.data, entityResult.error, "Load entity");

  const relationshipQuery = client.from("relationships").select("*").eq("campaign_id", campaignId);
  const relationshipPromise = entity.type === "location"
    ? relationshipQuery
    : relationshipQuery.or(`source_entity_id.eq.${entity.id},target_entity_id.eq.${entity.id}`);
  const [allRelationshipResult, entitySourcesResult, factResult, allEntitiesResult] = await Promise.all([
    relationshipPromise,
    client.from("entity_sources").select("*").eq("entity_id", entityId).order("page_number"),
    client.from("entity_facts").select("*").eq("entity_id", entityId).order("sort_order").order("id"),
    client.from("entities").select("id,name,type,roles,aliases,visibility").eq("campaign_id", campaignId),
  ]);
  const allRelationships = requireData(allRelationshipResult.data, allRelationshipResult.error, "Load relationships");
  const allEntities = requireData(allEntitiesResult.data, allEntitiesResult.error, "Load campaign entities");
  const facts = visibleFacts(requireData(factResult.data, factResult.error, "Load entity facts"), allEntities, viewMode);
  const safeRelationships = visibleRelationships(allRelationships, allEntities, viewMode);
  const relevant = relationshipsForEntity(safeRelationships, entityId);
  const relatedIds = [...new Set(relevant.map((relationship) => relationship.relatedEntityId))];
  const relatedResult = relatedIds.length
    ? await client.from("entities").select("id,name,type,roles,aliases,summary,gm_summary,player_summary,visibility").in("id", relatedIds)
    : { data: [], error: null };
  const related = requireData(relatedResult.data, relatedResult.error, "Load related entities");
  const relatedFactsResult = relatedIds.length
    ? await client.from("entity_facts").select("id,entity_id,field_key,content,structured_value,visibility,sort_order").in("entity_id", relatedIds).order("sort_order").order("id")
    : { data: [], error: null };
  const relatedFacts = visibleFacts(requireData(relatedFactsResult.data, relatedFactsResult.error, "Load related entity facts"), allEntities, viewMode);
  const relatedById = new Map(related.map((item) => {
    const { gm_summary, player_summary, summary: legacySummary, ...safeEntity } = item;
    return [item.id, {
      ...safeEntity,
      summary: visibleSummary({ ...safeEntity, gm_summary, player_summary, summary: legacySummary }, viewMode),
      previewFacts: relatedFacts.filter((fact) => fact.entity_id === item.id).slice(0, 3).map((fact) => fact.content),
    }];
  }));

  const relationshipIds = [...new Set(relevant.flatMap((relationship) => relationship.relationshipIds))];
  const relationshipSourcesResult = relationshipIds.length
    ? await client.from("relationship_sources").select("*").in("relationship_id", relationshipIds).order("page_number")
    : { data: [], error: null };
  const relationshipSources = requireData(
    relationshipSourcesResult.data,
    relationshipSourcesResult.error,
    "Load relationship sources",
  ) as RelationshipSourceRow[];
  const factIds = facts.map((fact) => fact.id);
  const factEvidenceResult = factIds.length
    ? await client.from("fact_evidence").select("*").in("fact_id", factIds).order("page_number")
    : { data: [], error: null };
  const factEvidence = requireData(factEvidenceResult.data, factEvidenceResult.error, "Load fact evidence");
  const entitySources = requireData(
    entitySourcesResult.data,
    entitySourcesResult.error,
    "Load entity sources",
  ) as EntitySourceRow[];
  const documentEntitySources = entitySources.filter(isDocumentEntitySource);
  const documentRelationshipSources = relationshipSources.filter(isDocumentRelationshipSource);
  const documentIds = [...new Set([
    ...documentEntitySources.map((source) => source.document_id),
    ...documentRelationshipSources.map((source) => source.document_id),
    ...factEvidence.flatMap((source) => source.document_id ? [source.document_id] : []),
  ])];
  const documentsResult = documentIds.length
    ? await client.from("documents").select("id,filename").in("id", documentIds)
    : { data: [], error: null };
  const documents = requireData(documentsResult.data, documentsResult.error, "Load source documents");
  const filenameById = new Map(documents.map((document) => [document.id, document.filename]));
  const safeLocations = visibleEntities(allEntities.filter((item) => item.type === "location"), viewMode);
  const hierarchy = entity.type === "location"
    ? buildLocationHierarchy(
        safeLocations,
        visibleRelationships(allRelationships, allEntities, viewMode).map((relationship) => ({
          id: relationship.id,
          sourceId: relationship.source_entity_id,
          targetId: relationship.target_entity_id,
          relationshipType: relationship.relationship_type,
          confidence: relationship.confidence,
          visibility: relationship.visibility,
        })),
      )
    : undefined;

  return {
    entity: (() => {
      const { gm_summary, player_summary, summary: legacySummary, ...safeEntity } = entity;
      return { ...safeEntity, summary: visibleSummary({ ...safeEntity, gm_summary, player_summary, summary: legacySummary }, viewMode) };
    })(),
    locationHierarchy: hierarchy ? {
      parent: hierarchy.getParent(entityId),
      children: hierarchy.getChildren(entityId),
      path: hierarchy.getPath(entityId),
      isRoot: hierarchy.getParent(entityId) === undefined,
      isOrphan: hierarchy.getOrphans().some((location) => location.id === entityId),
    } : undefined,
    // Legacy entity excerpts are not fact-scoped, so Player View omits them fail-closed.
    sources: viewMode === "dm" ? documentEntitySources.map((source) => ({ ...source, filename: filenameById.get(source.document_id) ?? "Campaign PDF" })) : [],
    facts: facts.map((fact) => ({
      id: fact.id,
      stableKey: fact.stable_key,
      fieldKey: fact.field_key,
      content: fact.content,
      structuredValue: fact.structured_value,
      visibility: fact.visibility,
      origin: fact.origin,
      sortOrder: fact.sort_order,
      context: fact.context,
      evidence: factEvidence.filter((evidence) => evidence.fact_id === fact.id
        && evidence.document_id !== null && evidence.page_number !== null && evidence.supporting_text !== null).map((evidence) => ({
        id: evidence.id,
        document_id: evidence.document_id!,
        filename: filenameById.get(evidence.document_id!) ?? "Campaign PDF",
        page_number: evidence.page_number!,
        supporting_text: evidence.supporting_text!,
      })),
    })),
    relationships: relevant.map((relationship) => ({
      ...relationship,
      relatedEntity: relatedById.get(relationship.relatedEntityId),
      sources: deduplicateSources(documentRelationshipSources
        .filter((source) => relationship.relationshipIds.includes(source.relationship_id)))
        .map((source) => ({ ...source, filename: filenameById.get(source.document_id) ?? "Campaign PDF" })),
    })),
  };
}
