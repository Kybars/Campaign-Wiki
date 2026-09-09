import type { EntityRole, EntityType } from "@/lib/db/types";
import type { KnowledgeVisibility } from "@/lib/knowledge/types";

/**
 * Player View is a GM preview filter, not authorization.  It keeps spoiler-safe
 * data out of the rendered read model; authenticated sharing is a later feature.
 */
export const CAMPAIGN_VIEW_MODES = ["dm", "player"] as const;
export type CampaignViewMode = (typeof CAMPAIGN_VIEW_MODES)[number];

export function campaignViewMode(value: unknown): CampaignViewMode {
  return value === "player" ? "player" : "dm";
}

export function campaignHref(path: string, viewMode: CampaignViewMode): string {
  if (viewMode === "dm") return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}view=player`;
}

export interface ReadEntity {
  id: string;
  name: string;
  type: EntityType;
  roles: readonly EntityRole[];
  aliases: readonly string[];
  visibility: KnowledgeVisibility;
  gm_summary?: string | null;
  player_summary?: string | null;
  summary?: string;
}

export function visibleEntities<T extends ReadEntity>(entities: T[], viewMode: CampaignViewMode): T[] {
  return viewMode === "dm" ? entities : entities.filter((entity) => entity.visibility === "player_visible");
}

export function visibleSummary(entity: ReadEntity, viewMode: CampaignViewMode): string {
  // There is intentionally no GM/legacy-summary fallback in Player View.
  return viewMode === "dm" ? entity.gm_summary ?? entity.summary ?? "" : entity.player_summary ?? "";
}

export interface ReadRelationship {
  visibility: KnowledgeVisibility;
  source_entity_id: string;
  target_entity_id: string;
}

export function visibleRelationships<T extends ReadRelationship>(
  relationships: T[],
  entities: readonly Pick<ReadEntity, "id" | "visibility">[],
  viewMode: CampaignViewMode,
): T[] {
  if (viewMode === "dm") return relationships;
  const visibleIds = new Set(entities.filter((entity) => entity.visibility === "player_visible").map((entity) => entity.id));
  return relationships.filter((relationship) => relationship.visibility === "player_visible"
    && visibleIds.has(relationship.source_entity_id)
    && visibleIds.has(relationship.target_entity_id));
}

export interface ReadFact {
  visibility: KnowledgeVisibility;
  content: string;
  structured_value: unknown;
}

function mentionsHiddenEntity(value: unknown, hiddenTerms: readonly string[]): boolean {
  if (typeof value === "string") {
    const text = value.toLocaleLowerCase("en-US");
    return hiddenTerms.some((term) => text.includes(term));
  }
  if (Array.isArray(value)) return value.some((item) => mentionsHiddenEntity(item, hiddenTerms));
  if (value && typeof value === "object") return Object.values(value).some((item) => mentionsHiddenEntity(item, hiddenTerms));
  return false;
}

export function visibleFacts<T extends ReadFact>(facts: T[], entities: readonly ReadEntity[], viewMode: CampaignViewMode): T[] {
  if (viewMode === "dm") return facts;
  const hiddenTerms = entities.filter((entity) => entity.visibility === "dm_only")
    .flatMap((entity) => [entity.name, ...entity.aliases])
    .map((term) => term.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean);
  return facts.filter((fact) => fact.visibility === "player_visible"
    && !mentionsHiddenEntity(fact.content, hiddenTerms)
    && !mentionsHiddenEntity(fact.structured_value, hiddenTerms));
}
