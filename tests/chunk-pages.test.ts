import { describe, expect, it } from "vitest";
import { chunkPages } from "@/lib/pdf/chunk-pages";

describe("chunkPages", () => {
  it("keeps complete pages, identity, ordering, and configured overlap", () => {
    const pages = [1, 2, 3, 4].map((pageNumber) => ({ pageNumber, text: "x".repeat(10) }));
    const chunks = chunkPages(pages, { targetCharacters: 21, overlapPages: 1 });
    expect(chunks.map((chunk) => chunk.pages.map((page) => page.pageNumber))).toEqual([[1, 2], [2, 3], [3, 4]]);
  });

  it("keeps an oversized page intact", () => {
    const chunks = chunkPages([{ pageNumber: 7, text: "x".repeat(100) }], { targetCharacters: 10 });
    expect(chunks[0].pages[0].pageNumber).toBe(7);
    expect(chunks[0].characterCount).toBe(100);
  });
});
