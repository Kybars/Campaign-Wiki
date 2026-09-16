import type { EntityType } from "@/lib/db/types";
import { ENTITY_TYPES } from "@/lib/entities";
import { isEntityProminence, isKnowledgeVisibility, isQuestStatus, type EntityProminence, type KnowledgeVisibility, type QuestStatus } from "@/lib/knowledge/types";

export type EntityCurationPatch =
  | { field: "type"; value: EntityType }
  | { field: "prominence"; value: EntityProminence | null }
  | { field: "visibility"; value: KnowledgeVisibility }
  | { field: "quest_status"; value: QuestStatus | null };

export function parseEntityCurationPatch(value: unknown): EntityCurationPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { field, value: fieldValue } = value as Record<string, unknown>;
  if (field === "type" && typeof fieldValue === "string" && ENTITY_TYPES.includes(fieldValue as EntityType)) return { field, value: fieldValue as EntityType };
  if (field === "prominence" && (fieldValue === null || isEntityProminence(fieldValue))) return { field, value: fieldValue };
  if (field === "visibility" && isKnowledgeVisibility(fieldValue)) return { field, value: fieldValue };
  if (field === "quest_status" && (fieldValue === null || isQuestStatus(fieldValue))) return { field, value: fieldValue };
  return null;
}

export function entityCurationUpdate(patch: EntityCurationPatch) {
  return patch.field === "type"
    ? { type: patch.value, type_is_manual: true } as const
    : patch.field === "prominence"
      ? { prominence: patch.value, prominence_is_manual: true } as const
      : patch.field === "visibility"
        ? { visibility: patch.value, visibility_is_manual: true } as const
        : { quest_status: patch.value, quest_status_is_manual: true } as const;
}

export function relationshipVisibilityBlockers(source: { name: string; visibility: KnowledgeVisibility }, target: { name: string; visibility: KnowledgeVisibility }): string[] {
  return [source, target].filter((entity) => entity.visibility !== "player_visible").map((entity) => `${entity.name} is not visible to players.`);
}
