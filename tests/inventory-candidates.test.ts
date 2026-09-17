import { describe, expect, it } from "vitest";
import {
  harvestInventoryCandidates, unionInventoryOutputs, validateCandidateClassifierOutput,
  INVENTORY_CANDIDATE_CONTEXT_MAX_CHARACTERS,
} from "@/lib/ai/inventory-candidates";
import { validateExtractionInventory } from "@/lib/ai/source-validation";

const text = [
  "THE ASHEN ROAD",
  "Queen Mira Vale rules Dawn-Reach beside the Silvercrag Mountains.",
  "The inquisitor is named Zerathi, and Zerathi guards Kael's Gate.",
  "Ordinary travelers cross the road. Page 3",
].join("\n");
const chunk = { id: "candidate-test", pages: [{ pageNumber: 3, text }], characterCount: text.length };

describe("deterministic inventory candidate harvesting", () => {
  it("harvests headings, Title Case spans, single fantasy names, apostrophes, and hyphens", () => {
    const surfaces = harvestInventoryCandidates(chunk).candidates.map((candidate) => candidate.surface);
    expect(surfaces).toEqual(expect.arrayContaining(["THE ASHEN ROAD", "Mira Vale", "Dawn-Reach", "Silvercrag Mountains", "Zerathi", "Kael's Gate"]));
  });

  it("deduplicates repeated names while retaining occurrence and page provenance", () => {
    const result = harvestInventoryCandidates(chunk);
    const zerathi = result.candidates.find((candidate) => candidate.surface === "Zerathi")!;
    expect(zerathi.occurrences).toBe(2);
    expect(zerathi.pages).toEqual([3]);
    expect(zerathi.contexts.every((context) => context.text.length <= INVENTORY_CANDIDATE_CONTEXT_MAX_CHARACTERS)).toBe(true);
  });

  it("suppresses generic sentence-initial and numeric boilerplate", () => {
    const normalized = harvestInventoryCandidates(chunk).candidates.map((candidate) => candidate.normalizedSurface);
    expect(normalized).not.toContain("ordinary");
    expect(normalized).not.toContain("page");
  });

  it("rejects unknown classifier output and grounds accepted output", () => {
    const harvested = harvestInventoryCandidates(chunk).candidates;
    const result = validateCandidateClassifierOutput({ entities: [
      { name: "Mira Vale", type: "npc", page: 3 },
      { name: "Invented Name", type: "npc", page: 3 },
      { name: "Zerathi", type: "npc", page: 4 },
    ] }, harvested);
    expect(result.accepted.entities).toEqual([{ name: "Mira Vale", type: "npc", page: 3 }]);
    expect(result.unknown).toHaveLength(2);
    expect(validateExtractionInventory(result.accepted, chunk).inventory.entities).toHaveLength(1);
  });

  it("unions inferred events without duplicating a lexical event", () => {
    const classified = { entities: [{ name: "Ashen Road Siege", type: "event" as const, page: 3 }] };
    expect(unionInventoryOutputs(classified, { events: [{ name: "Ashen Road Siege", page: 3 }, { name: "Assassination of Mira Vale", page: 3 }] }).entities).toHaveLength(2);
  });
});
