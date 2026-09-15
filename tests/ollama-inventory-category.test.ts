import { describe, expect, it } from "vitest";
import { categoryInventoryPrompt, categoryInventorySchema } from "../scripts/ollama-inventory-category";

const entity = { temporary_id: "id-1", name: "Named", type: "npc", aliases: [], sources: [{ page_number: 38, supporting_text: "Named evidence appears here." }] };

describe("inventory category experiment contract", () => {
  it("restricts types while allowing an empty category result and retaining evidence requirements", () => {
    expect(categoryInventorySchema("npc").parse({ entities: [] })).toEqual({ entities: [] });
    expect(() => categoryInventorySchema("npc").parse({ entities: [{ ...entity, type: "item" }] })).toThrow();
    expect(() => categoryInventorySchema("npc").parse({ entities: [{ ...entity, sources: [] }] })).toThrow();
  });

  it("keeps duplicate-id rejection in the existing evidence validator", () => {
    expect(() => categoryInventorySchema("npc").parse({ entities: [entity, { ...entity, name: "Different" }] })).toThrow(/Duplicate inventory ID/);
  });

  it("creates deterministic category-specific prompts", () => {
    expect(categoryInventoryPrompt("npc")).toBe(categoryInventoryPrompt("npc"));
    expect(categoryInventoryPrompt("other")).toContain("not fit NPC");
    expect(categoryInventoryPrompt("item")).toContain("ITEM");
  });
});
