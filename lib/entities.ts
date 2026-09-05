import type { EntityType } from "@/lib/db/types";

export const ENTITY_TYPES: EntityType[] = ["npc", "location", "faction", "item", "event", "quest", "other"];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  npc: "NPCs",
  location: "Locations",
  faction: "Factions",
  item: "Items",
  event: "Events",
  quest: "Quests",
  other: "Other",
};

export function isEntityType(value: string): value is EntityType {
  return ENTITY_TYPES.includes(value as EntityType);
}
