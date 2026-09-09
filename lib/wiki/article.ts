import type { EntityType } from "@/lib/db/types";

export interface ArticleFact {
  id: string;
  fieldKey: string;
  content: string;
  sortOrder: number;
}

export interface ArticleSection<T extends ArticleFact = ArticleFact> {
  title: string;
  facts: T[];
}

const SECTION_FIELDS: Record<EntityType, ReadonlyArray<readonly [string, readonly string[]]>> = {
  npc: [
    ["Appearance & manner", ["appearance", "first_impression", "mannerism", "voice"]],
    ["Personality", ["personality", "value", "belief", "flaw", "fear"]],
    ["Goals & motivations", ["goal", "motivation", "wants_from_party"]],
    ["Background", ["background"]], ["Knowledge", ["knowledge"]], ["Capabilities", ["capability"]], ["Hooks", ["hook"]],
  ],
  location: [
    ["First impression", ["first_impression", "appearance", "scale", "layout", "sensory_detail"]],
    ["Atmosphere", ["atmosphere"]], ["Purpose", ["purpose", "common_activity"]], ["Important features", ["important_feature"]], ["Hooks", ["hook"]],
  ],
  deity: [
    ["Appearance & manifestations", ["manifestation"]], ["Iconography", ["iconography", "symbol"]], ["Temperament", ["personality"]],
    ["Values & teachings", ["value", "teaching"]], ["Rituals & festivals", ["ritual", "festival"]], ["Hooks", ["hook"]],
  ],
  faction: [
    ["Purpose & ideology", ["purpose", "ideology"]], ["Goals", ["goal"]], ["Organization", ["structure", "membership_requirement"]],
    ["Headquarters & territory", ["territory"]], ["Resources & capabilities", ["resource"]], ["Symbols & appearance", ["symbol", "color", "uniform"]],
    ["Reputation", ["reputation"]], ["Methods", ["method"]], ["History", ["history"]], ["Current situation", ["current_situation"]],
    ["Party relationship", ["party_awareness", "party_standing", "standing_reason", "privilege", "restriction", "obligation"]], ["Hooks", ["hook"]],
  ],
  item: [
    ["Appearance", ["appearance", "material", "inscription"]], ["History & origin", ["history", "origin"]], ["Stats", ["mechanics"]],
    ["Powers & benefits", ["special_power"]], ["Drawbacks & curses", ["drawback", "curse", "cost"]], ["Activation & usage", ["activation", "usage_requirement"]],
    ["Lore", ["lore"]], ["Hooks", ["hook"]],
  ],
  quest: [
    ["Objective", ["objective"]], ["Stakes", ["stakes"]], ["Reward", ["reward"]], ["How it begins", ["hook"]], ["Outcome & consequences", ["outcome", "consequence"]],
  ],
  event: [
    ["What happened", ["what_happened"]], ["Chronology", ["exact_date", "relative_chronology", "chronology_context", "chronology_sequence", "chronology_uncertainty"]],
    ["Causes", ["cause"]], ["Consequences", ["consequence"]],
  ],
  other: [["Details", ["detail"]], ["Hooks", ["hook"]]],
};

const QUICK_FIELDS: Record<EntityType, readonly string[]> = {
  npc: ["occupation", "social_role", "status"], location: ["place_kind", "status"], deity: ["domain", "status"],
  faction: ["faction_type", "status", "party_standing"], item: ["item_type", "status"], quest: ["objective", "status"],
  event: ["exact_date", "relative_chronology", "status"], other: ["status"],
};

export function articleQuickFacts<T extends ArticleFact>(type: EntityType, facts: readonly T[]): T[] {
  const order = QUICK_FIELDS[type];
  return facts.filter((fact) => order.includes(fact.fieldKey)).sort((a, b) => order.indexOf(a.fieldKey) - order.indexOf(b.fieldKey) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export function articleSections<T extends ArticleFact>(type: EntityType, facts: readonly T[]): ArticleSection<T>[] {
  const quick = new Set(articleQuickFacts(type, facts).map((fact) => fact.id));
  return SECTION_FIELDS[type].map(([title, fields]) => ({
    title,
    facts: facts.filter((fact) => !quick.has(fact.id) && fields.includes(fact.fieldKey))
      .sort((a, b) => fields.indexOf(a.fieldKey) - fields.indexOf(b.fieldKey) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
  })).filter((section) => section.facts.length > 0);
}

export function factLabel(fieldKey: string): string {
  const labels: Record<string, string> = {
    social_role: "Role", first_impression: "First impression", mannerism: "Mannerism", wants_from_party: "Wants from the party",
    place_kind: "Kind", common_activity: "Activity", important_feature: "Feature", faction_type: "Type", membership_requirement: "Membership",
    party_awareness: "Party awareness", party_standing: "Party standing", standing_reason: "Reason", special_power: "Power", usage_requirement: "Requirement",
    exact_date: "Date", relative_chronology: "Timing", chronology_context: "Context", chronology_sequence: "Sequence", chronology_uncertainty: "Uncertainty",
    what_happened: "What happened",
  };
  return labels[fieldKey] ?? fieldKey.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
