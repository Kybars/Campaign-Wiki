import type { DocumentPage } from "@/lib/pdf/types";

const HEADER_FOOTER_LINES = 2;
const MIN_RECURRING_PAGES = 3;

function compactLine(line: string) { return line.replace(/[\t ]+/g, " ").trim(); }
function recurrenceKey(line: string) {
  return compactLine(line).toLocaleLowerCase("en-US").replace(/\b\d+\b/g, "#").replace(/\s+/g, " ");
}
function barePageOrnament(line: string) {
  return /^(?:[-–—•·*]\s*)?(?:page\s*)?\d{1,4}(?:\s*(?:of|\/|\|)\s*\d{1,4})?(?:\s*[-–—•·*])?$/iu.test(compactLine(line));
}
function edgeIndexes(lines: string[], edge: "header" | "footer") {
  if (edge === "header") return lines.slice(0, HEADER_FOOTER_LINES).map((_, index) => index);
  return lines.slice(-HEADER_FOOTER_LINES).map((_, index) => Math.max(0, lines.length - HEADER_FOOTER_LINES) + index);
}
function recurringEdgeKeys(pages: DocumentPage[], edge: "header" | "footer") {
  const counts = new Map<string, Set<number>>();
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/);
    for (const index of edgeIndexes(lines, edge)) {
      const key = recurrenceKey(lines[index]);
      if (!key || barePageOrnament(lines[index])) continue;
      const pageSet = counts.get(key) ?? new Set<number>(); pageSet.add(page.pageNumber); counts.set(key, pageSet);
    }
  }
  const threshold = Math.max(MIN_RECURRING_PAGES, Math.ceil(pages.length * 0.6));
  return new Set([...counts].filter(([, pageNumbers]) => pageNumbers.size >= threshold).map(([key]) => key));
}
function joinParagraphLines(lines: string[]) {
  const paragraphs: string[] = []; let current = "";
  const flush = () => { if (current) paragraphs.push(current.trim()); current = ""; };
  for (const rawLine of lines) {
    const line = compactLine(rawLine);
    if (!line) { flush(); continue; }
    if (!current) { current = line; continue; }
    if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(line)) current = current.slice(0, -1) + line;
    else current += ` ${line}`;
  }
  flush();
  return paragraphs.join("\n\n");
}

export interface ModelTextCleaningResult {
  pages: DocumentPage[];
  removedLineCount: number;
}

export function cleanDocumentPagesForModel(pages: DocumentPage[]): ModelTextCleaningResult {
  const headerKeys = recurringEdgeKeys(pages, "header");
  const footerKeys = recurringEdgeKeys(pages, "footer");
  let removedLineCount = 0;
  const cleaned = pages.map((page) => {
    const lines = page.text.split(/\r?\n/);
    const headerIndexes = new Set(edgeIndexes(lines, "header"));
    const footerIndexes = new Set(edgeIndexes(lines, "footer"));
    const retained = lines.map((line, index) => {
      const remove = (headerIndexes.has(index) && (barePageOrnament(line) || headerKeys.has(recurrenceKey(line))))
        || (footerIndexes.has(index) && (barePageOrnament(line) || footerKeys.has(recurrenceKey(line))));
      if (remove) { removedLineCount += 1; return ""; }
      return line;
    });
    return { ...page, modelText: joinParagraphLines(retained) };
  });
  return { pages: cleaned, removedLineCount };
}

export function pageTextForModel(page: DocumentPage) { return page.modelText ?? page.text; }
