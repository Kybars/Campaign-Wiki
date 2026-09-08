export const FACT_FIELD_KEYS_BY_ENTITY_TYPE = {
  npc: [
    "occupation",
    "social_role",
    "appearance",
    "first_impression",
    "mannerism",
    "voice",
    "personality",
    "value",
    "belief",
    "flaw",
    "fear",
    "goal",
    "motivation",
    "wants_from_party",
    "background",
    "knowledge",
    "capability",
    "status",
    "hook",
  ],
  location: [
    "place_kind",
    "first_impression",
    "appearance",
    "scale",
    "layout",
    "sensory_detail",
    "atmosphere",
    "purpose",
    "common_activity",
    "important_feature",
    "status",
    "hook",
  ],
  deity: [
    "domain",
    "manifestation",
    "iconography",
    "personality",
    "value",
    "teaching",
    "symbol",
    "ritual",
    "festival",
    "status",
    "hook",
  ],
  faction: [
    "faction_type",
    "purpose",
    "ideology",
    "goal",
    "membership_requirement",
    "structure",
    "territory",
    "resource",
    "symbol",
    "color",
    "uniform",
    "reputation",
    "method",
    "history",
    "current_situation",
    "status",
    "hook",
    "party_awareness",
    "party_standing",
    "standing_reason",
    "privilege",
    "restriction",
    "obligation",
  ],
  item: [
    "item_type",
    "appearance",
    "material",
    "inscription",
    "history",
    "origin",
    "status",
    "mechanics",
    "special_power",
    "cost",
    "drawback",
    "curse",
    "activation",
    "usage_requirement",
    "lore",
    "hook",
  ],
  quest: [
    "objective",
    "stakes",
    "reward",
    "status",
    "outcome",
    "consequence",
    "hook",
  ],
  event: [
    "what_happened",
    "exact_date",
    "relative_chronology",
    "chronology_context",
    "chronology_sequence",
    "chronology_uncertainty",
    "cause",
    "consequence",
    "status",
  ],
  other: ["detail", "status", "hook"],
} as const;

export type FactEntityType = keyof typeof FACT_FIELD_KEYS_BY_ENTITY_TYPE;
export type FactFieldKey = (typeof FACT_FIELD_KEYS_BY_ENTITY_TYPE)[FactEntityType][number];

export const RELATIONSHIP_BACKED_CONCEPTS = [
  "faction membership",
  "residence/workplace/main location",
  "location containment and ownership",
  "saints, avatars, chosen, clergy, worshippers, holy places, and relics",
  "faction leadership, members, allies, enemies, headquarters, and controlled locations",
  "item creator, owners, and current location",
  "questgiver and involved people, places, items, and factions",
  "event location, participants, and connected entities",
] as const;

export function factFieldsForEntityType(type: FactEntityType): readonly FactFieldKey[] {
  return FACT_FIELD_KEYS_BY_ENTITY_TYPE[type];
}

export function isFactFieldForEntityType(type: FactEntityType, field: string): field is FactFieldKey {
  return (FACT_FIELD_KEYS_BY_ENTITY_TYPE[type] as readonly string[]).includes(field);
}

export function chronologyKindForField(field: FactFieldKey): string | undefined {
  switch (field) {
    case "exact_date": return "exact";
    case "relative_chronology": return "relative";
    case "chronology_context": return "era";
    case "chronology_sequence": return "sequence";
    case "chronology_uncertainty": return "uncertainty";
    default: return undefined;
  }
}
