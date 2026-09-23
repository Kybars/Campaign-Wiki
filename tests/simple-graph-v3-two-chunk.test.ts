import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext } from "../lib/ai/extraction-context";
import { serializeSimpleGraphV3Request, SIMPLE_GRAPH_V3_SYSTEM_PROMPT } from "../lib/ai/simple-graph-v3";
import { planTest9TwoChunkSimpleGraphV3, validateAndUnionTwoChunkSimpleGraphV3 } from "../lib/ai/simple-graph-v3-two-chunk";

const inventory: GraphInventory = { entities: [
  { temporary_id: "a", name: "Ostalin", type: "faction", aliases: [], sources: [] },
  { temporary_id: "b", name: "Turinn", type: "location", aliases: [], sources: [] },
  { temporary_id: "c", name: "Sindaire", type: "location", aliases: [], sources: [] },
] };

function setup() {
  const context = buildExtractionContext([
    { pageNumber: 10, text: "Ostalin lies near Sindaire." },
    { pageNumber: 11, text: "Sindaire faces war." },
    { pageNumber: 12, text: "Ostalin attacks Sindaire." },
    { pageNumber: 13, text: "Ostalin attacks Turinn. Turinn is the capital of Sindaire." },
    { pageNumber: 14, text: "Ostalin attacks Turinn again." },
  ], inventory);
  return planTest9TwoChunkSimpleGraphV3(context);
}

describe("Test 9 two-chunk Simple V3 primary", () => {
  it("uses the unchanged V3 prompt and independent occurrence-filtered page chunks", () => {
    const [first, second] = setup();
    expect(SIMPLE_GRAPH_V3_SYSTEM_PROMPT).toContain("Extract high-recall, explicit campaign relationships");
    expect(first.sourceSegments.map((segment) => segment.page)).toEqual([10, 11, 12]);
    expect(second.sourceSegments.map((segment) => segment.page)).toEqual([13, 14]);
    expect(first.entities.map((entity) => entity.name)).toEqual(["Ostalin", "Sindaire"]);
    expect(second.entities.map((entity) => entity.name)).toEqual(["Ostalin", "Turinn", "Sindaire"]);
    const firstPayload = serializeSimpleGraphV3Request(first).payload;
    const secondPayload = serializeSimpleGraphV3Request(second).payload;
    expect(firstPayload).toContain("[10a]");
    expect(firstPayload).not.toContain("Turinn");
    expect(firstPayload).not.toContain("RELATIONSHIPS ALREADY FOUND");
    expect(secondPayload).toContain("[13a]");
    expect(secondPayload).not.toContain("[10a]");
    expect(secondPayload).not.toContain("TARGET");
  });

  it("validates each chunk, dedupes semantic edges, and unions raw provenance", () => {
    const requests = setup();
    const union = validateAndUnionTwoChunkSimpleGraphV3([
      { requestId: requests[0].requestId, output: { relationships: [
        { source: "Ostalin", relationship: "attacks", target: "Sindaire", page: 12, evidence_segment: "12a" },
      ] } },
      { requestId: requests[1].requestId, output: { relationships: [
        { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 13, evidence_segment: "13a" },
        { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 14, evidence_segment: "14a" },
        { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 12, evidence_segment: "12a" },
      ] } },
    ], requests);
    expect(union.relationships).toHaveLength(2);
    expect(union.duplicateRelationships).toBe(1);
    expect(union.invalidSegmentRejections).toBe(1);
    expect(union.relationships.find((edge) => edge.targetName === "Turinn")?.provenance.map((item) => item.segmentId)).toEqual(["13a", "14a"]);
  });

  it("requires every page in the fixed split", () => {
    const context = buildExtractionContext([{ pageNumber: 10, text: "Ostalin." }], inventory);
    expect(() => planTest9TwoChunkSimpleGraphV3(context)).toThrow("Missing source page");
  });

  it("rejects duplicate saved outputs that omit a chunk", () => {
    const requests = setup();
    const output = { requestId: requests[0].requestId, output: { relationships: [] } };
    expect(() => validateAndUnionTwoChunkSimpleGraphV3([output, output], requests)).toThrow("one output for each");
  });
});
