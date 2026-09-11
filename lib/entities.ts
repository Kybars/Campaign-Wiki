import type { EntityRole, EntityType } from "@/lib/db/types";
import type { EntityProminence } from "@/lib/knowledge/types";

export const ENTITY_TYPES: EntityType[] = ["npc", "deity", "location", "faction", "item", "event", "quest", "other"];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  npc: "NPCs",
  deity: "Deities",
  location: "Locations",
  faction: "Factions",
  item: "Items",
  event: "Events",
  quest: "Quests",
  other: "Other",
};

export const ENTITY_TYPE_SINGULAR_LABELS: Record<EntityType, string> = {
  npc: "NPC",
  deity: "Deity",
  location: "Location",
  faction: "Faction",
  item: "Item",
  event: "Event",
  quest: "Quest",
  other: "Other",
};

export const ENTITY_ROLE_LABELS: Record<EntityRole, string> = { enemy: "Enemy" };

export const PROMINENCE_GROUPS = ["major", "supporting", "minor", "unclassified"] as const;
export type ProminenceGroup = (typeof PROMINENCE_GROUPS)[number];

export function prominenceGroup(prominence: EntityProminence | null | undefined): ProminenceGroup {
  return prominence ?? "unclassified";
}

export function prominenceGroupLabel(group: ProminenceGroup): string {
  return group === "unclassified" ? "Unclassified" : group[0].toLocaleUpperCase("en-US") + group.slice(1);
}

export function hasEntityRole(entity: { roles: EntityRole[] }, role: EntityRole): boolean {
  return entity.roles.includes(role);
}

export function isEntityType(value: string): value is EntityType {
  return ENTITY_TYPES.includes(value as EntityType);
}

export function filterEntitiesBySearchTerm<T extends { name: string; aliases: string[] }>(entities: T[], term: string): T[] {
  const normalizedTerm = term.trim().toLocaleLowerCase("en-US");
  if (!normalizedTerm) return [];
  return entities.filter((entity) =>
    entity.name.toLocaleLowerCase("en-US").includes(normalizedTerm)
    || entity.aliases.some((alias) => alias.toLocaleLowerCase("en-US").includes(normalizedTerm)),
  );
}
