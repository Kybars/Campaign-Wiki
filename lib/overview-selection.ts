import { visibleEntities, type CampaignViewMode, type ReadEntity } from "@/lib/campaign-view";
import { prominenceGroup, prominenceGroupLabel } from "@/lib/entities";
import type { EntityType } from "@/lib/db/types";
import type { QuestStatus } from "@/lib/knowledge/types";

export type OverviewEntry = ReadEntity & { type: EntityType; prominence: "major" | "supporting" | "minor" | null; quest_status: QuestStatus | null };

const alphabetical = <T extends { name: string }>(entries: readonly T[]) => [...entries].sort((left, right) => left.name.localeCompare(right.name, "en-US", { sensitivity: "base" }));

/** Picks only visible Major entries for a compact overview section. */
export function selectProminentOverviewEntries<T extends OverviewEntry>(entries: readonly T[], type: EntityType, viewMode: CampaignViewMode, limit = 4): T[] {
  const visible = visibleEntities([...entries], viewMode).filter((entry) => entry.type === type);
  return alphabetical(visible.filter((entry) => prominenceGroup(entry.prominence) === "major")).slice(0, limit);
}

/** Picks only visible ongoing quests for a compact overview section. */
export function selectQuestOverviewEntries<T extends OverviewEntry>(entries: readonly T[], viewMode: CampaignViewMode, limit = 4): T[] {
  const visibleQuests = visibleEntities([...entries], viewMode).filter((entry) => entry.type === "quest");
  return alphabetical(visibleQuests.filter((entry) => entry.quest_status === "ongoing")).slice(0, limit);
}

export function overviewMetadata(entry: OverviewEntry): string {
  if (entry.type === "quest") return `${questStatusLabel(entry.quest_status)} · Quest`;
  return `${prominenceGroupLabel(prominenceGroup(entry.prominence))} · ${entry.type === "npc" ? "NPC" : entry.type[0].toLocaleUpperCase("en-US") + entry.type.slice(1)}`;
}

/** Front-page cards show only an existing safe summary; they never synthesize a fallback. */
export function overviewSummary(summary: string | undefined): string | null {
  const value = summary?.trim();
  return value || null;
}

export function questStatusLabel(status: QuestStatus | null): string {
  return (status ?? "not_started") === "not_started" ? "Not started" : (status ?? "not_started").replace(/^./, (letter) => letter.toLocaleUpperCase("en-US"));
}

export function overviewCategoryCounts<T extends OverviewEntry>(entries: readonly T[], viewMode: CampaignViewMode, types: readonly EntityType[]): Array<{ type: EntityType; count: number }> {
  const visible = visibleEntities([...entries], viewMode);
  return types.map((type) => ({ type, count: visible.filter((entry) => entry.type === type).length })).filter(({ count }) => count > 0);
}
