import { describe, expect, it } from "vitest";
import { buildCompletenessSweepInput, INVENTORY_COMPLETENESS_SYSTEM_PROMPT, serializeCompactInventory, validateAndUnionCompleteness } from "@/lib/ai/inventory-completeness";
import { validateExtractionInventory } from "@/lib/ai/source-validation";
import type { PageChunk } from "@/lib/pdf/types";
import { assertGoldReferenceIsolation } from "../scripts/wotbs-stage1";

const chunk: PageChunk = {
  id: "completeness-synthetic",
  pages: [{ pageNumber: 7, text: "Mira Vale guards the Moon Gate. Captain Orin crossed the Ashen Road." }],
  characterCount: 69,
};

function initialInventory() {
  return validateExtractionInventory({ entities: [{ name: "Mira Vale", type: "npc" as const, page: 7 }] }, chunk).inventory;
}

describe("v3 inventory completeness sweep", () => {
  it("serializes existing identities compactly and deterministically without rich or internal fields", () => {
    const serialized = serializeCompactInventory(initialInventory());
    expect(serialized).toBe("- Mira Vale — npc — p7");
    expect(serialized).not.toMatch(/inv_|supporting_text|facts|relationships|aliases/);
  });

  it("builds a gold-isolated prompt without IDs, evidence, facts, or relationships", () => {
    const payload = buildCompletenessSweepInput(chunk, initialInventory());
    expect(payload).toContain("Already extracted:\n- Mira Vale — npc — p7");
    expect(payload).not.toMatch(/inv_|supporting_text|validated_inventory|facts|relationships/);
    expect(() => assertGoldReferenceIsolation([INVENTORY_COMPLETENESS_SYSTEM_PROMPT, payload], [{ path: "private-gold.json", raw: "synthetic evaluator-only marker" }])).not.toThrow();
  });

  it("cannot replace an initial entity and unions grounded missing identities deterministically", () => {
    const initial = initialInventory();
    const result = validateAndUnionCompleteness(initial, { entities: [
      { name: "Captain Orin", type: "npc", page: 7 },
      { name: "Mira Vale", type: "npc", page: 7 },
      { name: "Captain Orin", type: "npc", page: 7 },
    ] }, chunk);
    expect(result.duplicateRejections).toHaveLength(2);
    expect(result.groundedInventory.entities.map((entity) => entity.name)).toEqual(["Captain Orin"]);
    expect(result.finalInventory.entities.map((entity) => entity.name)).toEqual(["Mira Vale", "Captain Orin"]);
    expect(result.finalInventory.entities[0]).toEqual(initial.entities[0]);
  });

  it("suppresses only same-page, same-type title-stripped sweep duplicates", () => {
    const titledChunk = { ...chunk, pages: [{ pageNumber: 7, text: "Duke Gallo rules the Moon Gate." }] };
    const titled = validateExtractionInventory({ entities: [{ name: "Duke Gallo", type: "npc", page: 7 }] }, titledChunk).inventory;
    const same = validateAndUnionCompleteness(titled, { entities: [{ name: "Gallo", type: "npc", page: 7 }] }, titledChunk);
    expect(same.groundedInventory.entities).toHaveLength(0);
    expect(same.duplicateRejections[0].reason).toContain("title stripping");
    const differentPage = validateAndUnionCompleteness(titled, { entities: [{ name: "Gallo", type: "npc", page: 8 }] }, { ...titledChunk, pages: [...titledChunk.pages, { pageNumber: 8, text: "Gallo visits the Moon Gate." }] });
    expect(differentPage.groundedInventory.entities).toHaveLength(1);
  });

  it("rejects ungroundable sweep output and keeps initial v3 IDs stable", () => {
    const initial = initialInventory();
    const originalId = initial.entities[0].temporary_id;
    const result = validateAndUnionCompleteness(initial, { entities: [{ name: "Invented Regent", type: "npc", page: 7 }] }, chunk);
    expect(result.groundedInventory.entities).toHaveLength(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.reason.includes("does not occur"))).toBe(true);
    expect(result.finalInventory.entities[0].temporary_id).toBe(originalId);
  });
});
