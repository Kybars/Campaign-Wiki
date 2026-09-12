export interface RecallReferenceEntity {
  name: string;
  expectedType: "npc" | "deity" | "location" | "faction" | "item" | "event" | "quest";
  sourcePage: number;
  supportingText: string;
  historicalTest3: "present" | "missing";
}

// This is a curated source-backed reference set, not a claim that Test 2 is
// complete ground truth. Missing rows document the historical model-recall gap;
// normal deterministic tests validate the benchmark and prompt contract, not a
// model behavior that can only be measured by an explicitly authorized run.
export const recallReferenceEntities: RecallReferenceEntity[] = [
  { name: "Xancrown", expectedType: "npc", sourcePage: 6, supportingText: "Xancrown, a mighty plague demon", historicalTest3: "present" },
  { name: "Ralekai Gravemore", expectedType: "npc", sourcePage: 9, supportingText: "Ralekai eventually found the star elf barrows", historicalTest3: "present" },
  { name: "Beatrice Sharp", expectedType: "npc", sourcePage: 51, supportingText: "murdered his wife, Beatrice", historicalTest3: "missing" },
  { name: "Jeanas Clocker", expectedType: "npc", sourcePage: 59, supportingText: "Jeanas Clocker, the leader of Sweetwater's refugees", historicalTest3: "present" },
  { name: "Jesper Clocker", expectedType: "npc", sourcePage: 61, supportingText: "Jeanas' son Jesper", historicalTest3: "missing" },
  { name: "Brinner's Brews", expectedType: "location", sourcePage: 45, supportingText: "Brinner’s Brews is the best, and only, option", historicalTest3: "missing" },
  { name: "Village Council", expectedType: "faction", sourcePage: 27, supportingText: "The current Village Council is led by Villagemaster Bjalien Viadas", historicalTest3: "missing" },
  { name: "Birthwitch family signet ring", expectedType: "item", sourcePage: 43, supportingText: "the Birthwitch family signet ring", historicalTest3: "missing" },
  { name: "Gem of brightness", expectedType: "item", sourcePage: 39, supportingText: "a gem of brightness that has 39 charges remaining", historicalTest3: "missing" },
  { name: "Feed the Hungry", expectedType: "quest", sourcePage: 39, supportingText: "recover this food from the goblins", historicalTest3: "missing" },
  { name: "Food Riot", expectedType: "event", sourcePage: 71, supportingText: "Food Riot", historicalTest3: "missing" },
  { name: "Salu", expectedType: "deity", sourcePage: 50, supportingText: "Salu, goddess of life, birth, medicine, and the sun", historicalTest3: "present" },
  { name: "Cay Naja", expectedType: "deity", sourcePage: 94, supportingText: "their god of death, Cay Naja", historicalTest3: "present" },
];

export const recallIdentityRules = {
  mustRemainDistinct: [["Jeanas Clocker", "Jesper Clocker"]],
  mustMergeAndRetype: [{ sourceName: "Cay Naja", sourceTypes: ["npc", "other"], canonicalType: "deity" }],
  mustMerge: [{ sourceNames: ["Fire and Grind: Miller and Bakery", "Phelm and Messa's bakery"], canonicalName: "Fire and Grind" }],
} as const;
