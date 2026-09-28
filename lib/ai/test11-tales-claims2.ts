import type { Claims2Request, EvidenceUnit } from "@/lib/ai/claims-2-experiment";
import type { ExtractionContextEntity } from "@/lib/ai/extraction-context";

export const TALES_CLAIMS2_REQUEST_ID = "test11-tales-claims2-v1-1";
export const TALES_PAGES = [27, 28, 29, 30] as const;

const headings: Record<number, string[]> = {
  27: ["An adventure for expert characters", "Verge", "Exploring Verge", "A. The Exchange", "B. Green Man Public House", "C. The Old Well"],
  28: ["D. Standing Stones", "E. Temple of Light", "Rumors", "Major Characters", "Delores the Constable", "Blister the Spy", "Craven", "Elder Zeke, Mayor", "Ezard the Scoundrel"],
  29: ["Kyra Peen", "Lesser Zeke", "Merry Peen", "Silas Branson", "Sister Matilda", "Xavian"],
  30: ["Events near Verge", "Day 1", "Day 2", "Day 3", "Random Events", "Places of Interest", "1. Black Thorn", "2. Troll's Teeth", "3. Shed", "4. Brigand Cave"],
};

function bodyBounds(raw: string, page: number) {
  const firstLines = page === 27 ? 1 : 2;
  let start = 0;
  for (let index = 0; index < firstLines; index++) {
    start = raw.indexOf("\n", start) + 1;
    if (start <= 0) throw new Error(`Missing Tales page ${page} running header`);
  }
  const end = raw.indexOf("\ntales of the demon lord", start);
  if (end < 0 || end <= start) throw new Error(`Missing Tales page ${page} footer boundary`);
  return { start, end };
}

export function planTalesClaims2(
  pages: ReadonlyArray<{ pageNumber: number; text: string }>,
  entities: ExtractionContextEntity[],
): Claims2Request {
  if (pages.length !== 4 || pages.some((page, index) => page.pageNumber !== TALES_PAGES[index])) {
    throw new Error("Tales Claims-2 requires exactly physical PDF pages 27–30");
  }
  const evidenceUnits: EvidenceUnit[] = [];
  let section = "In the Name of Love";
  for (const page of pages) {
    const raw = page.text;
    const { start, end } = bodyBounds(raw, page.pageNumber);
    const spans = headings[page.pageNumber].map((heading) => {
      const atStart = raw.startsWith(`${heading}\n`, start);
      const position = atStart ? start : raw.indexOf(`\n${heading}\n`, start);
      if (position < start || position >= end) throw new Error(`Missing Tales heading ${heading} on physical page ${page.pageNumber}`);
      const headingStart = position + (atStart ? 0 : 1);
      return { start: headingStart, end: headingStart + heading.length, heading };
    }).sort((a, b) => a.start - b.start);
    let pageUnit = 0;
    const add = (from: number, to: number, kind: EvidenceUnit["kind"]) => {
      const part = raw.slice(from, to);
      const left = part.search(/\S/u);
      if (left < 0) return;
      const rawStart = from + left;
      const rawEnd = from + part.trimEnd().length;
      const exact = raw.slice(rawStart, rawEnd);
      pageUnit++;
      evidenceUnits.push({
        unitId: `p${page.pageNumber}.u${String(pageUnit).padStart(3, "0")}`,
        segmentId: `p${page.pageNumber}`,
        page: page.pageNumber,
        kind,
        text: exact.replace(/\s+/gu, " "),
        rawSource: { page: page.pageNumber, start: rawStart, end: rawEnd, text: exact },
        context: section,
        order: evidenceUnits.length,
      });
    };
    const sentences = (from: number, to: number) => {
      const block = raw.slice(from, to);
      for (const match of block.matchAll(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/gu)) {
        const at = from + (match.index ?? 0);
        add(at, at + match[0].length, "sentence");
      }
    };
    let cursor = start;
    for (const heading of spans) {
      sentences(cursor, heading.start);
      section = heading.heading === "Day 1" || heading.heading === "Day 2" || heading.heading === "Day 3"
        ? `Events near Verge / ${heading.heading}` : heading.heading;
      add(heading.start, heading.end, "heading");
      cursor = heading.end;
    }
    sentences(cursor, end);
  }
  for (const unit of evidenceUnits) {
    const page = pages.find((item) => item.pageNumber === unit.page)!;
    if (page.text.slice(unit.rawSource.start, unit.rawSource.end) !== unit.rawSource.text) {
      throw new Error(`Lost physical-page provenance for ${unit.unitId}`);
    }
  }
  return { requestId: TALES_CLAIMS2_REQUEST_ID, evidenceUnits, entities };
}
