import { describe, expect, it } from "vitest";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";
import { buildClaimsEvidenceUnits, validateClaimsProvenance } from "../lib/ai/claims-document-source";
import { annotateSourceStructure } from "../lib/ai/claims-source-structure";

const source = () => [1, 2, 3].map(pageNumber => ({ pageNumber, text:
  `ADVENTURER HANDBOOK\nNorthern Roads\nAn ordinary body sentence.\nLife minor restoration (4), mend (2), greater restoration (1)\nADVENTURER HANDBOOK\nLife minor restoration\n— ${pageNumber} —\nNorthern Roads\nBuyer Name (Order #${100 + pageNumber})\nThe road continues through the wood.` }));
describe("interleaved model text decontamination", () => {
  it("removes exact fragments inside proven furniture insertions and preserves raw bytes", () => {
    const raw = source(), snapshot = structuredClone(raw), clean = cleanDocumentPagesForModel(raw);
    expect(raw).toEqual(snapshot); expect(clean.pages.map(p => p.text)).toEqual(raw.map(p => p.text));
    for (const p of clean.pages) {
      expect(p.modelText).not.toMatch(/HANDBOOK|Northern Roads|Order #/u);
      expect(p.modelText?.match(/Life minor restoration/gu)).toHaveLength(1);
      expect(p.modelText).toContain("mend (2), greater restoration (1)");
      expect(p.modelText).toContain("The road continues");
    }
    expect(clean.countsByReason.duplicate_overlay).toBe(3);
    expect(clean.countsByReason.watermark).toBe(3);
    expect(clean.countsByReason.page_ornament).toBe(3);
    for (const f of clean.removedFragments) expect(raw[f.page - 1].text.slice(f.start, f.end)).toBe(f.rawText);
    const units = buildClaimsEvidenceUnits(clean.pages);
    expect(validateClaimsProvenance(units, raw).invalidProvenanceCount).toBe(0);
    expect(units.some(u => /HANDBOOK|Order #/u.test(u.text))).toBe(false);
  });
  it("preserves book-title prose, repeated identities, rooms, tables, numbers and narrative", () => {
    const text = `Mira Grey\nAmber Keep\nThe Adventurer Handbook describes this road.\nMira Grey\nAmber Keep\n1. Gatehouse\nd6 Result\n1\n2\n3\nHealth\n20\nStrength\n12\nThe bell rings every night.\nThe bell rings every night.\nDistant Places`;
    const raw = [1, 2, 3].map(pageNumber => ({ pageNumber, text }));
    const cleaned = cleanDocumentPagesForModel(raw);
    expect(cleaned.removedLineCount).toBe(0);
    for (const p of cleaned.pages) for (const s of text.split("\n")) expect(p.modelText).toContain(s);
    expect(cleaned.pages[0].modelText?.match(/The bell rings every night\./gu)).toHaveLength(2);
  });
  it("does not deduplicate repeated prose adjacent to furniture without an insertion bracket", () => {
    const raw = source().map(p => ({ ...p, text: p.text + "\nThe same story is told.\nThe same story is told." }));
    expect(cleanDocumentPagesForModel(raw).pages[0].modelText?.match(/The same story is told\./gu)).toHaveLength(2);
  });
  it("preserves a one-off heading and semantic location heading away from furniture", () => {
    const raw = source().map((p, i) => ({ ...p, text: p.text + `\n\nNorthern Roads\nThe inn lies beside the road.${i === 0 ? "\n\nQuiet Waters" : ""}` }));
    const cleaned = cleanDocumentPagesForModel(raw);
    expect(cleaned.pages[0].modelText).toContain("Northern Roads");
    expect(cleaned.pages[0].modelText).toContain("Quiet Waters");
  });
  it("preserves recurring semantic names at an edge without matching footer-layer proof", () => {
    for (const name of ["Mira Grey", "Amber Keep"]) {
      const raw = source().map(p => ({ ...p, text: p.text.replace(/^ADVENTURER HANDBOOK\nNorthern Roads/u, `ADVENTURER HANDBOOK\n${name}`) }));
      expect(cleanDocumentPagesForModel(raw).pages.every(p => p.modelText?.includes(name))).toBe(true);
    }
  });
  it("removes a proven running title interrupting a statblock without removing numeric values", () => {
    const raw = source().map(p => ({ ...p, text: p.text.replace("An ordinary body sentence.", "An ordinary body sentence.\nNorthern Roads\nDifficulty 25\n10 (+0)\nThe body resumes here.") }));
    const cleaned = cleanDocumentPagesForModel(raw);
    expect(cleaned.pages.every(p => !p.modelText?.includes("Northern Roads"))).toBe(true);
    expect(cleaned.pages.every(p => p.modelText?.includes("Difficulty 25 10 (+0)"))).toBe(true);
  });
  it("preserves CRLF raw removal offsets", () => {
    const raw = source().map(p => ({ ...p, text: p.text.replace(/\n/gu, "\r\n") }));
    for (const f of cleanDocumentPagesForModel(raw).removedFragments) expect(raw[f.page - 1].text.slice(f.start, f.end)).toBe(f.rawText);
  });
  it("retains rumors, days, random context and hierarchy in the new stream", () => {
    const raw = source().map((p, i) => ({ ...p, text: p.text + (i === 0 ? "\n\n# Journey\n\n## Rumors\n\nPeople claim the gate is haunted.\n\n## Day 1\n\nThe guards arrive.\n\n## Day 2\n\nThe mayor leaves.\n\n## Day 3\n\nThe road closes.\n\n## Random Events\n\nIf rolled, the gate opens." : "") }));
    const annotated = annotateSourceStructure(buildClaimsEvidenceUnits(cleanDocumentPagesForModel(raw).pages));
    for (const label of ["rumors", "day_1", "day_2", "day_3", "random_events"]) expect(annotated.units.some(u => u.context.includes(label)), `${label}: ${annotated.units.map(u => u.context).join(",")}`).toBe(true);
    expect(annotated.hierarchy.some(h => h.path.length === 2)).toBe(true);
  });
});
