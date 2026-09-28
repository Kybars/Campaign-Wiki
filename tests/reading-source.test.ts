import { describe, expect, it } from "vitest";
import { cleanReadingPages } from "@/lib/pdf/reading-source";
import { findVerbatimEvidence } from "@/lib/ai/graph-extraction";

describe("traceable reading source", () => {
  it("keeps physical pages separate and maps every cleaned line to its raw span", () => {
    const raw = [
      { pageNumber: 6, text: "Each day,\nSide note\nbound Ullae" },
      { pageNumber: 7, text: "the priests renew the wards.\nGalell speaks." },
    ];
    const cleaned = cleanReadingPages(raw);
    expect(raw[0].text).toBe("Each day,\nSide note\nbound Ullae");
    expect(cleaned.map(page => page.pageNumber)).toEqual([6, 7]);
    expect(cleaned[0].text).toContain("bound Ullae");
    expect(cleaned[0].text).not.toContain("the priests");
    for (const page of cleaned) for (const passage of page.passages) {
      expect(page.text.slice(passage.cleanStart, passage.cleanEnd)).toBe(passage.text);
      expect(page.rawText.slice(passage.rawStart, passage.rawEnd)).toBeTruthy();
      expect(page.rawText.slice(passage.rawStart, passage.rawEnd)).not.toContain("\n");
    }
  });

  it("removes only caller-confirmed running lines and obvious page ornaments", () => {
    const [page] = cleanReadingPages([{ pageNumber: 27, text: "Book Header\nTemple of Light\nThe locals built it.\nBook Header\n27\n7 Reader (Order #12345)" }], ["Book Header"]);
    expect(page.text).toBe("Temple of Light\nThe locals built it.");
    expect(page.removedLines).toHaveLength(4);
    expect(page.rawText).toContain("Book Header");
  });

  it("repairs listed ligature splits and horizontal spacing without changing names or dialogue", () => {
    const [page] = cleanReadingPages([{ pageNumber: 29, text: "Galell said, “I will fl ee.”\nTheir eff orts saved the fi gure.\nThe off er is bound Ullae ." }]);
    expect(page.text).toBe("Galell said, “I will flee.”\nTheir efforts saved the figure.\nThe offer is bound Ullae.");
    expect(findVerbatimEvidence(page.rawText, "Their efforts saved the figure.")).toBeNull();
    expect(findVerbatimEvidence(page.rawText, "Their eff orts saved the fi gure.")).toBeTruthy();
  });

  it("does not join columns, parentheticals, quotations, or hyphenated line wraps", () => {
    const [page] = cleanReadingPages([{ pageNumber: 10, text: "Left column ends with river-\nRight column starts with a name.\nShaaladel (king) said, ‘Wait!’" }]);
    expect(page.text).toContain("river-\nRight column");
    expect(page.text).toContain("Shaaladel (king) said, ‘Wait!’");
    expect(page.passages).toHaveLength(3);
  });

});
