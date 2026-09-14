import { describe, expect, it } from "vitest";
import { aggregateBoundaryInventories, sourceIntervalText, subdivideInventorySource, summarizeInventoryPressureCalls } from "../scripts/ollama-inventory-pressure";

const chunk = { id: "frozen", characterCount: 100, pages: [
  { pageNumber: 1, text: "alpha" }, { pageNumber: 2, text: "bravo bravo" }, { pageNumber: 3, text: "charlie" }, { pageNumber: 4, text: "delta delta delta" },
] };

describe("Ollama inventory-pressure experiment helpers", () => {
  it("subdivides at ordered page boundaries with complete, non-duplicate coverage", () => {
    const original = sourceIntervalText(chunk.pages);
    for (const parts of [2, 4]) {
      const split = subdivideInventorySource(chunk, parts);
      expect(split).toHaveLength(parts);
      expect(split.flatMap((item) => item.pages.map((page) => page.pageNumber))).toEqual([1, 2, 3, 4]);
      expect(split.map((item) => sourceIntervalText(item.pages)).join("\n\n")).toBe(original);
      expect(split.every((item) => item.characterCount > 0 && item.estimatedInputTokens > 0)).toBe(true);
    }
  });

  it("reports only exact boundary identity overlaps as conservative duplicate metrics", () => {
    const inventory = (name: string, type: "npc" | "location", aliases: string[] = []) => ({ entities: [{ temporary_id: name.toLowerCase().replaceAll(" ", "_"), name, type, aliases, sources: [{ page_number: 1, supporting_text: "source evidence" }] }] });
    const result = aggregateBoundaryInventories([
      { subchunkId: "half-1", inventory: inventory("Hanna", "npc", ["Hanna the Guide"]) },
      { subchunkId: "half-2", inventory: inventory("Hanna the Guide", "npc") },
      { subchunkId: "half-2", inventory: inventory("Safeharbor", "location") },
    ]);
    expect(result).toMatchObject({ rawEntityCount: 3, exactBoundaryDuplicateCount: 1, conservativeUnionCount: 2, rawPerType: { npc: 2, location: 1 }, unionPerType: { npc: 1, location: 1 } });
    expect(result.provenance.find((item) => item.name === "Hanna")?.subchunkIds).toEqual(["half-1", "half-2"]);
  });

  it("summarizes failed calls without treating their quality as empty successful output", () => {
    expect(summarizeInventoryPressureCalls([{ status: "failed", latencyMs: 600, outputBytes: 900 }, { status: "success", latencyMs: 100, outputBytes: 100 }])).toEqual({ calls: 2, validCalls: 1, allValid: false, meanLatencyMs: 350, maxOutputBytes: 900 });
  });
});
