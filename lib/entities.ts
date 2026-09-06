import type { EntityRole, EntityType } from "@/lib/db/types";

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

export function hasEntityRole(entity: { roles: EntityRole[] }, role: EntityRole): boolean {
  return entity.roles.includes(role);
}

export function isEntityType(value: string): value is EntityType {
  return ENTITY_TYPES.includes(value as EntityType);
}
