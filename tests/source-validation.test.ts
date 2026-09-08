import { describe, expect, it } from "vitest";
import { validateChunkExtraction, validateSource } from "@/lib/ai/source-validation";

const pages = [{ pageNumber: 4, text: "Ralekai needs an empty Soul Stone to complete the cure." }];

describe("source validation", () => {
  it("accepts normalized/fuzzy punctuation differences", () => {
    expect(validateSource({ page_number: 4, supporting_text: "Ralekai needs an empty Soul Stone— to complete the cure" }, pages)).toBeNull();
  });

  it("rejects impossible pages and absent quotes", () => {
    expect(validateSource({ page_number: 99, supporting_text: "Ralekai needs the Soul Stone" }, pages)).toContain("not in this chunk");
    expect(validateSource({ page_number: 4, supporting_text: "A dragon destroyed the capital yesterday" }, pages)).toContain("does not match");
  });

  it("drops entities without evidence and relationships with bad endpoints", () => {
    const result = validateChunkExtraction({
      entities: [{ temporary_id: "e1", name: "Ralekai", type: "npc", roles: [], aliases: [], summary: "Scientist.", sources: [{ page_number: 99, supporting_text: "Ralekai is a scientist" }], facts: [] }],
      relationships: [{ source_temporary_id: "e1", target_temporary_id: "e2", relationship_type: "needs", description: "Needs it.", confidence: 0.9, sources: [{ page_number: 4, supporting_text: pages[0].text }] }],
    }, pages);
    expect(result.extraction.entities).toHaveLength(0);
    expect(result.extraction.relationships).toHaveLength(0);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
  });
});
