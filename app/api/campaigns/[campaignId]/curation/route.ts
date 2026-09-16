import { parseEntityCurationPatch, relationshipVisibilityBlockers } from "@/lib/curation";
import { createAdminClient, requireData } from "@/lib/db/client";
import { updateEntityCuration, updateRelationshipVisibility } from "@/lib/db/repository";
import { isKnowledgeVisibility } from "@/lib/knowledge/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid curation request" }, { status: 400 });
  const record = body as Record<string, unknown>;

  try {
    if (record.kind === "entity" && typeof record.entityId === "string") {
      const patch = parseEntityCurationPatch(record.patch);
      if (!patch) return Response.json({ error: "Invalid entity change" }, { status: 400 });
      const entity = await updateEntityCuration(campaignId, record.entityId, patch);
      return Response.json({ entity });
    }

    if (record.kind === "relationship" && Array.isArray(record.relationshipIds)
      && record.relationshipIds.length > 0
      && record.relationshipIds.every((id) => typeof id === "string")
      && isKnowledgeVisibility(record.visibility)) {
      const relationshipIds = [...new Set(record.relationshipIds as string[])];
      const client = createAdminClient();
      const relationshipResult = await client.from("relationships").select("id,source_entity_id,target_entity_id")
        .eq("campaign_id", campaignId).in("id", relationshipIds);
      const relationships = requireData(relationshipResult.data, relationshipResult.error, "Load relationships for curation");
      if (relationships.length !== relationshipIds.length) return Response.json({ error: "Relationship not found" }, { status: 404 });
      if (record.visibility === "player_visible") {
        const endpointIds = [...new Set(relationships.flatMap((relationship) => [relationship.source_entity_id, relationship.target_entity_id]))];
        const endpointResult = await client.from("entities").select("id,name,visibility").eq("campaign_id", campaignId).in("id", endpointIds);
        const endpoints = requireData(endpointResult.data, endpointResult.error, "Load relationship endpoints");
        const endpointById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
        const blockers = relationships.flatMap((relationship) => {
          const source = endpointById.get(relationship.source_entity_id);
          const target = endpointById.get(relationship.target_entity_id);
          return source && target ? relationshipVisibilityBlockers(source, target) : ["A relationship endpoint is unavailable."];
        });
        if (blockers.length) return Response.json({ error: blockers.join(" ") }, { status: 409 });
      }
      const relationshipsUpdated = await updateRelationshipVisibility(campaignId, relationshipIds, record.visibility);
      return Response.json({ relationships: relationshipsUpdated });
    }
  } catch (error) {
    console.error("Could not save GM curation", error);
    return Response.json({ error: "Could not save this change" }, { status: 500 });
  }
  return Response.json({ error: "Invalid curation request" }, { status: 400 });
}
