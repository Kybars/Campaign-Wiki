import { describe, expect, it } from "vitest";
import { cleanDocumentPagesForModel } from "@/lib/pdf/model-text";
import { buildInventoryInput } from "@/lib/ai/prompts";
import { resolveRawRelationships } from "@/lib/ai/graph-extraction";
import { applyDeterministicProminence, scanSourceOccurrences } from "@/lib/graph/prominence";
import { buildGraphCoverageAudit } from "@/lib/processing/relationship-rescue";
import type { CanonicalGraph } from "@/lib/graph/types";

describe("deterministic model page text cleaning", () => {
  const pages = [1, 2, 3, 4].map((pageNumber) => ({
    pageNumber,
    text: `CAMPAIGN GUIDE\nChapter One\n\nThis repeated narrative sentence remains important.\nThe silver war-\nhorse carries Mira onward.\n\n— ${pageNumber} —\nCAMPAIGN GUIDE`,
  }));

  it("removes only recurring edge boilerplate and page ornaments while safely repairing PDF wraps", () => {
    const cleaned = cleanDocumentPagesForModel(pages);
    expect(cleaned.removedLineCount).toBeGreaterThan(0);
    expect(cleaned.pages[0].text).toBe(pages[0].text);
    expect(cleaned.pages[0].modelText).not.toContain("CAMPAIGN GUIDE");
    expect(cleaned.pages[0].modelText).not.toContain("— 1 —");
    expect(cleaned.pages[0].modelText).toContain("This repeated narrative sentence remains important.");
    expect(cleaned.pages[0].modelText).toContain("warhorse carries Mira");
  });

  it("does not remove repeated narrative text outside consistent header/footer regions", () => {
    const source = [1, 2, 3].map((pageNumber) => ({ pageNumber, text: `Header ${pageNumber}\n\nA refrain spoken in the middle.\nMore narrative.\n\n${pageNumber}` }));
    const cleaned = cleanDocumentPagesForModel(source);
    expect(cleaned.pages.every((page) => page.modelText?.includes("A refrain spoken in the middle."))).toBe(true);
  });

  it("masks repeated edge boilerplate in a two-page document before semantic occurrence scans", () => {
    const rawPages = [1, 2].map((pageNumber) => ({ pageNumber, text: `MIRA CAMPAIGN GUIDE\nChapter ${pageNumber}\n\n${pageNumber === 1 ? "Mira enters the keep." : "The keep stands empty."}\n\n${pageNumber}` }));
    const scan = scanSourceOccurrences({ name: "Mira", aliases: [] }, rawPages);
    expect(scan).toMatchObject({ mentionCount: 1, mentionPageCount: 1 });
    expect(scan.pageEvidence[0].supporting_text).toContain("Mira enters the keep.");
  });

  it("removes a recurring edge prefix even when its trailing section segment changes", () => {
    const source = ["Prologue", "Campaign Saga Overview", "New Game Rules"].map((section, index) => ({
      pageNumber: index + 1,
      text: `War of the Burning Sky Campaign Guide • ${section}\n\n${index === 0 ? "Turinn is the capital of Sindaire." : "Turinn appears in body text."}`,
    }));
    const cleaned = cleanDocumentPagesForModel(source).pages;
    expect(cleaned.every((page) => !page.modelText?.includes("War of the Burning Sky Campaign Guide"))).toBe(true);
    expect(cleaned[0]?.modelText).toContain("Turinn is the capital of Sindaire.");
  });

  it("uses cleaned text for model input but raw text for exact relationship provenance validation", () => {
    const [page] = cleanDocumentPagesForModel(pages).pages;
    const chunk = { id: "chunk", pages: [page], characterCount: page.text.length };
    expect(buildInventoryInput(chunk)).toContain("warhorse carries Mira");
    expect(buildInventoryInput(chunk)).not.toContain("CAMPAIGN GUIDE");
    const inventory = { entities: [
      { temporary_id: "horse", name: "silver warhorse", type: "npc" as const, sources: [{ page_number: 1, supporting_text: "The silver war-\nhorse carries Mira onward." }] },
      { temporary_id: "mira", name: "Mira", type: "npc" as const, sources: [{ page_number: 1, supporting_text: "horse carries Mira onward." }] },
    ] };
    expect(resolveRawRelationships({ relationships: [{ source: "silver warhorse", relationship: "carries", target: "Mira", page: 1, evidence_quote: "The silver war-\nhorse carries Mira onward." }] }, inventory, chunk).relationships).toHaveLength(1);
    const semanticQuote = resolveRawRelationships({ relationships: [{ source: "silver warhorse", relationship: "carries", target: "Mira", page: 1, evidence_quote: "The silver warhorse carries Mira onward." }] }, inventory, chunk).relationships[0];
    expect(semanticQuote.matchedEvidenceText).toBe("The silver war-\nhorse carries Mira onward.");
    expect(page.text).toContain("war-\nhorse");
  });

  it("excludes repeated boilerplate from mentions, prominence, and coverage while retaining raw evidence", () => {
    const rawPages = [1, 2, 3, 4].map((pageNumber) => ({ pageNumber, text: `MIRA CAMPAIGN GUIDE\nChapter\n\n${pageNumber === 1 ? "Mira enters the keep." : "The keep stands empty."}\n\n${pageNumber}` }));
    const semanticPages = cleanDocumentPagesForModel(rawPages).pages;
    const graph: CanonicalGraph = { entities: [{ key: "mira", name: "Mira", normalizedName: "mira", type: "npc", roles: [], roleSources: {}, aliases: [], summary: "", sources: [], candidateIds: ["mira"], reconciliationEvidence: [], mergeReason: "deterministic" }], relationships: [], facts: [], factAggregationDiagnostics: { candidateFactCount: 0, canonicalFactCount: 0, deduplicatedFactCount: 0, factEvidenceCount: 0 }, discardedRelationships: [], locationHierarchyDiagnostics: [], candidateToCanonical: new Map([["mira", "mira"]]) };
    const scan = scanSourceOccurrences(graph.entities[0], semanticPages);
    const prominent = applyDeterministicProminence(graph, semanticPages).entities[0];
    const coverage = buildGraphCoverageAudit(graph, semanticPages)[0];
    expect(scan).toMatchObject({ mentionCount: 1, mentionPageCount: 1 });
    expect(scan.pageEvidence[0].supporting_text).toContain("MIRA CAMPAIGN GUIDE");
    expect(rawPages[0].text).toContain(scan.pageEvidence[0].supporting_text);
    expect(prominent).toMatchObject({ sourceMentionCount: 1, sourceMentionPageCount: 1 });
    expect(coverage).toMatchObject({ mention_count: 1, mention_page_count: 1, flags: ["SPARSE_OK"] });
  });
});
