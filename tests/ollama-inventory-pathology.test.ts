import { describe, expect, it } from "vitest";
import { boundedEvidenceSchema, namesOnlySchema, repetitionMetrics } from "../scripts/ollama-inventory-pathology";

describe("inventory pathology helpers", () => {
  it("enforces compact discovery contracts", () => {
    expect(namesOnlySchema.parse({ entities: [] })).toEqual({ entities: [] });
    expect(() => namesOnlySchema.parse({ entities: [{ name: "A", type: "npc" }] })).not.toThrow();
    expect(() => boundedEvidenceSchema.parse({ entities: [{ name: "A" }] })).toThrow();
    expect(boundedEvidenceSchema.parse({ entities: [{ name: "A", source: { page_number: 38, supporting_text: "evidence text" } }] }).entities).toHaveLength(1);
  });
  it("counts structural and phrase repetition without requiring valid JSON", () => {
    const text = '{"temporary_id":"a","name":"X","supporting_text":"one"} {"temporary_id":"a","name":"X","supporting_text":"one"} repeat repeat repeat repeat repeat repeat';
    expect(repetitionMetrics(text)).toMatchObject({ completedTemporaryIdFields: 2, duplicateTemporaryIds: 1, duplicateNormalizedNames: 1, repeatedEvidenceFieldCount: 2 });
  });
});
