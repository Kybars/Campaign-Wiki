import { describe, expect, it } from "vitest";
import { assembleCompactRich, buildCompactRichInput, createDeterministicSourceSpans, serializeCompactRichInventory, validateCompactRichFacts, validateCompactRichRelationships } from "@/lib/ai/rich-kernel";
import { assembleChunkExtraction, validateExtractionInventory, validateExtractionRich } from "@/lib/ai/source-validation";

const chunk = {
  id: "rich-kernel",
  pages: [
    { pageNumber: 2, text: "Moon Gate stands in Ashfall. Mira Vale guards Moon Gate. ".repeat(6) },
    { pageNumber: 1, text: "Captain Mira Vale is called Mira. Mira carries the Ember Key. ".repeat(6) },
  ],
  characterCount: 700,
};
const inventory = validateExtractionInventory({ entities: [
  { name: "Mira Vale", type: "npc" as const, page: 1 },
  { name: "Ember Key", type: "item" as const, page: 1 },
  { name: "Moon Gate", type: "location" as const, page: 2 },
  { name: "Ashfall", type: "location" as const, page: 2 },
] }, chunk).inventory;
const id = (name: string) => inventory.entities.find((entity) => entity.name === name)!.temporary_id;

describe("compact Rich semantic kernel", () => {
  it("creates stable bounded page spans independent of page input order and serialization", () => {
    const spans = createDeterministicSourceSpans(chunk);
    const reordered = createDeterministicSourceSpans({ ...chunk, pages: [...chunk.pages].reverse() });
    expect(reordered).toEqual(spans);
    expect(JSON.parse(JSON.stringify(spans))).toEqual(spans);
    expect(spans.map((span) => span.id)).toEqual(["p1_s001", "p2_s001"]);
    expect(spans.every((span) => span.text.length <= 600)).toBe(true);
  });

  it("serializes only compact inventory identity and materializes exact cited span text", () => {
    const spans = createDeterministicSourceSpans(chunk);
    const serialized = serializeCompactRichInventory(inventory);
    expect(serialized.every((entity) => Object.keys(entity).sort().join(",") === "id,name,page,type")).toBe(true);
    expect(JSON.stringify(buildCompactRichInput(inventory, spans))).not.toMatch(/supporting_text|summary|facts|relationships/);
    const result = validateCompactRichFacts({ aliases: [], facts: [{ entity_id: id("Mira Vale"), fact_type: "occupation", value: "Guards Moon Gate", support_span_ids: ["p2_s001"] }] }, inventory, spans);
    expect(result.entities[0].facts[0].sources[0].supporting_text).toBe(spans.find((span) => span.id === "p2_s001")!.text);
  });

  it("rejects unknown owners, spans, invalid fact types, and unsupported alias surfaces", () => {
    const spans = createDeterministicSourceSpans(chunk);
    const result = validateCompactRichFacts({
      aliases: [
        { entity_id: "unknown", alias: "Mira", support_span_id: "p1_s001" },
        { entity_id: id("Mira Vale"), alias: "Invented Alias", support_span_id: "p1_s001" },
        { entity_id: id("Mira Vale"), alias: "Mira", support_span_id: "p1_s001" },
      ],
      facts: [
        { entity_id: "unknown", fact_type: "occupation", value: "Guard", support_span_ids: ["p1_s001"] },
        { entity_id: id("Mira Vale"), fact_type: "occupation", value: "Guard", support_span_ids: ["missing"] },
        { entity_id: id("Ember Key"), fact_type: "occupation", value: "Guard", support_span_ids: ["p1_s001"] },
      ],
    }, inventory, spans);
    expect(result.acceptedAliases).toBe(1);
    expect(result.acceptedFacts).toBe(0);
    expect(result.diagnostics).toHaveLength(5);
  });

  it("rejects unknown endpoints/spans and duplicate relationship edges", () => {
    const spans = createDeterministicSourceSpans(chunk);
    const valid = { source_id: id("Moon Gate"), type: "located_in", target_id: id("Ashfall"), support_span_ids: ["p2_s001"] };
    const result = validateCompactRichRelationships({ relationships: [
      valid,
      { ...valid },
      { ...valid, target_id: "unknown" },
      { ...valid, support_span_ids: ["missing"] },
    ] }, inventory, spans);
    expect(result.acceptedRelationships).toBe(1);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("preserves inventory entities with no Rich output and never promotes suspected misses", () => {
    const spans = createDeterministicSourceSpans(chunk);
    const facts = validateCompactRichFacts({ aliases: [], facts: [] }, inventory, spans);
    const relationships = validateCompactRichRelationships({ relationships: [] }, inventory, spans);
    const rich = validateExtractionRich(assembleCompactRich(inventory, facts, relationships), inventory, chunk.pages).rich;
    expect(rich.suspected_inventory_misses).toEqual([]);
    const candidate = assembleChunkExtraction(inventory, rich);
    expect(candidate.entities).toHaveLength(inventory.entities.length);
    expect(candidate.entities.every((entity) => entity.facts.length === 0)).toBe(true);
  });
});
