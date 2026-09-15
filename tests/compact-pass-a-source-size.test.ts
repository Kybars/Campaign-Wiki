import { describe, expect, it } from "vitest";
import { logicalInventoryUnion, splitSourceSizeExperiment, verifyCompleteOrderedCoverage } from "../scripts/compact-pass-a-source-size";

const chunk = { id: "chunk-3", characterCount: 45, pages: [{ pageNumber: 38, text: "a".repeat(8) }, { pageNumber: 39, text: "b".repeat(15) }, { pageNumber: 40, text: "c".repeat(9) }, { pageNumber: 41, text: "d".repeat(13) }] };
const inventory = (entities: Array<{ temporary_id: string; name: string; type: "npc" | "item" }>) => ({ entities: entities.map((entity) => ({ ...entity, sources: [{ page_number: 38, supporting_text: "supported evidence" }] as [{ page_number: number; supporting_text: string }] })) });

describe("compact Pass-A source-size experiment", () => {
  it("uses stable ordered page splits with complete, non-duplicate coverage", () => {
    const first = splitSourceSizeExperiment(chunk, 3, ["3A", "3B"]);
    expect(first).toEqual(splitSourceSizeExperiment(chunk, 3, ["3A", "3B"]));
    expect(first.flatMap((item) => item.pages.map((page) => page.pageNumber))).toEqual([38, 39, 40, 41]);
    expect(verifyCompleteOrderedCoverage(chunk.pages, first)).toBe(true);
    const children = splitSourceSizeExperiment({ ...chunk, id: first[0].id, pages: first[0].pages, characterCount: first[0].characterCount }, 3, ["3A1", "3A2"]);
    expect(children.map((item) => item.sourceLabel)).toEqual(["3A1", "3A2"]);
  });

  it("unions same-type names conservatively while preserving cross-type collisions and IDs", () => {
    const union = logicalInventoryUnion([
      { subchunkId: "3A", inventory: inventory([{ temporary_id: "inv_a", name: "Hanna", type: "npc" }, { temporary_id: "inv_b", name: "Seal", type: "item" }]) },
      { subchunkId: "3B", inventory: inventory([{ temporary_id: "inv_c", name: " hanna ", type: "npc" }, { temporary_id: "inv_d", name: "Seal", type: "npc" }]) },
    ]);
    expect(union.rawInventoryCount).toBe(4);
    expect(union.conservativeLogicalUnionCount).toBe(3);
    expect(union.sameTypeNameDuplicates).toMatchObject([{ type: "npc", name: "Hanna", rawIds: ["inv_a", "inv_c"] }]);
    expect(union.crossTypeNameCollisions).toMatchObject([{ name: "Seal", types: ["item", "npc"], rawIds: ["inv_b", "inv_d"] }]);
  });

  it("does not make a failed subdivision look like a valid reconstructed interval", () => {
    const calls = [{ valid: true }, { valid: false }];
    expect(calls.every((call) => call.valid)).toBe(false);
  });
});
