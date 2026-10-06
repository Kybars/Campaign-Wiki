import type { DocumentPage } from "@/lib/pdf/types";

const HEADER_FOOTER_LINES = 2;
const MIN_RECURRING_PAGES = 2;

function compactLine(line: string) { return line.replace(/[\t ]+/g, " ").trim(); }
function recurrenceKey(line: string) {
  return compactLine(line).toLocaleLowerCase("en-US").replace(/\b\d+\b/g, "#").replace(/\s+/g, " ");
}
export type RemovalReason = "recurring_header" | "recurring_footer" | "recurring_furniture" | "page_ornament" | "watermark" | "duplicate_overlay";
export interface RemovedModelFragment { page: number; rawText: string; normalizedKey: string; reason: RemovalReason; lineIndex: number; start: number; end: number }
const watermark = (s: string) => s.length <= 180 && !/[!?]/u.test(s) &&
  /\b(?:order\s*#?\s*\d+\)?\s*$|customer\s*(?:id|number|#)\s*[:#]?\s*\d+\s*$|downloaded\s+(?:by|for)|purchased\s+by|copyright|all rights reserved)/iu.test(s);
const watermarkKey = (s: string) => recurrenceKey(s.match(/\b(?:order\s*#?\s*\d+|customer\s*(?:id|number|#)\s*[:#]?\s*\d+).*$/iu)?.[0] ?? s);
const titleLike = (s: string) => s.length >= 8 && s.length <= 100 && s.split(/\s+/u).length <= 10 &&
  !/[.!?;:,()#]/u.test(s) && !/\d/u.test(s) && /\p{L}/u.test(s) &&
  !/^(?:a|an|if|when|while|each|any|some|many|several)\s/iu.test(s);
function repeatedTitleKey(s: string) {
  const words = recurrenceKey(s).split(" ");
  for (let width = 2; width <= words.length / 2; width++)
    if (words.length % width === 0 && words.every((w, i) => w === words[i % width])) return words.slice(0, width).join(" ");
  return words.join(" ");
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
function recurringEdgeSegments(pages: DocumentPage[], edge: "header" | "footer") {
  const counts = new Map<string, Set<number>>();
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/);
    for (const index of edgeIndexes(lines, edge)) {
      // A publisher title often shares a stable prefix but changes its trailing
      // section name.  Only inspect the edge, so body prose remains countable.
      const segment = compactLine(lines[index]).split(/[•|—–-]/u)[0] ?? "";
      const key = recurrenceKey(segment);
      if (!key || barePageOrnament(segment) || key.length < 8) continue;
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
  removedFragments: RemovedModelFragment[];
  countsByReason: Record<RemovalReason, number>;
}

export function cleanDocumentPagesForModel(pages: DocumentPage[]): ModelTextCleaningResult {
  const headerKeys = recurringEdgeKeys(pages, "header");
  const footerKeys = recurringEdgeKeys(pages, "footer");
  const headerSegments = recurringEdgeSegments(pages, "header");
  const footerSegments = recurringEdgeSegments(pages, "footer");
  const removedFragments: RemovedModelFragment[] = [];
  const countsByReason: Record<RemovalReason, number> = { recurring_header: 0, recurring_footer: 0, recurring_furniture: 0, page_ornament: 0, watermark: 0, duplicate_overlay: 0 };
  const linePages = new Map<string, Set<number>>(), watermarks = new Map<string, Set<number>>();
  for (const page of pages) for (const raw of page.text.split(/\r?\n/u)) {
    const s = compactLine(raw), k = repeatedTitleKey(s);
    const set = linePages.get(k) ?? new Set<number>(); set.add(page.pageNumber); linePages.set(k, set);
    if (watermark(s)) { const seen = watermarks.get(watermarkKey(s)) ?? new Set<number>(); seen.add(page.pageNumber); watermarks.set(watermarkKey(s), seen); }
  }
  // Only edge-proven running titles can become document-wide furniture keys.
  // Repetition of a body heading or NPC name by itself is insufficient.
  const pairedEdges = new Map<string, number>();
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/u);
    const first = new Set(edgeIndexes(lines, "header").map(i => recurrenceKey(lines[i])));
    for (const k of new Set(edgeIndexes(lines, "footer").map(i => recurrenceKey(lines[i]))))
      if (first.has(k)) pairedEdges.set(k, (pairedEdges.get(k) ?? 0) + 1);
    for (const k of first) if (lines.some((s, i) => i >= HEADER_FOOTER_LINES && recurrenceKey(s) === k &&
      [i + 1, i + 2, i + 3].some(j => j < lines.length && (watermark(lines[j]) ||
        barePageOrnament(lines[j]) && (j >= lines.length - 2 || /^\s*[-–—•·*]|^\s*page\s+/iu.test(lines[j]))))))
      pairedEdges.set(k, (pairedEdges.get(k) ?? 0) + 1);
  }
  const strong = new Set([...headerKeys, ...footerKeys, ...headerSegments, ...footerSegments]
    .filter(k => titleLike(k) && (linePages.get(k)?.size ?? 0) >= Math.max(2, Math.ceil(pages.length * .6)) &&
      ((pairedEdges.get(k) ?? 0) >= 2 && pages.filter(p => recurrenceKey(p.text.split(/\r?\n/u)[0]) === k).length >= 2 ||
        /\b(?:guide|handbook|manual|chapter|volume|edition|publisher)\b/iu.test(k))));
  const baseKey = (s: string) => repeatedTitleKey(compactLine(s).replace(/\s+\d{1,4}$/u, ""));
  const hasStrong = (s: string) => strong.has(baseKey(s)) || [...strong].some(k => baseKey(s).startsWith(k + " • "));
  const runningCandidates = new Set<string>();
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/u).map(compactLine);
    for (let i = 0; i < Math.min(HEADER_FOOTER_LINES, lines.length); i++) if (titleLike(lines[i]) && !hasStrong(lines[i]) &&
      [i - 1, i + 1].some(j => j >= 0 && j < lines.length && hasStrong(lines[j]))) {
      const k = repeatedTitleKey(lines[i]);
      if ((linePages.get(k)?.size ?? 0) >= 2) runningCandidates.add(k);
    }
  }
  const running = new Set([...runningCandidates].filter(k => pages.filter(page => {
    const lines = page.text.split(/\r?\n/u).map(compactLine);
    return lines.some((s, i) => i >= HEADER_FOOTER_LINES && (repeatedTitleKey(s) === k || watermark(s) && recurrenceKey(s).startsWith(k + " ")) &&
      (watermark(s) || [i - 2, i - 1, i + 1, i + 2].some(j => j >= 0 && j < lines.length && (watermark(lines[j]) || barePageOrnament(lines[j])))) &&
      [i - 4, i - 3, i - 2, i - 1, i + 1, i + 2, i + 3, i + 4].some(j => j >= 0 && j < lines.length && hasStrong(lines[j])));
  }).length >= 2));
  const cleaned = pages.map((page) => {
    const lines = page.text.split(/\r?\n/);
    const headerIndexes = new Set(edgeIndexes(lines, "header"));
    const footerIndexes = new Set(edgeIndexes(lines, "footer"));
    const reasons = new Map<number, RemovalReason>();
    lines.forEach((line, index) => {
      const segment = recurrenceKey((compactLine(line).split(/[•|—–-]/u)[0] ?? ""));
      const edge = headerIndexes.has(index) ? "header" : footerIndexes.has(index) ? "footer" : null;
      if (watermark(line) && (watermarks.get(watermarkKey(line))?.size ?? 0) >= 2) reasons.set(index, "watermark");
      else if (hasStrong(line)) reasons.set(index, edge === "header" ? "recurring_header" : edge === "footer" ? "recurring_footer" : "recurring_furniture");
      else if (edge && titleLike(compactLine(line).split(/[•|—–-]/u)[0]) && /\b(?:guide|handbook|manual|chapter|volume|edition|publisher)\b/iu.test(segment) &&
        (edge === "header" ? headerKeys.has(recurrenceKey(line)) || headerSegments.has(segment) : footerKeys.has(recurrenceKey(line)) || footerSegments.has(segment)))
        reasons.set(index, edge === "header" ? "recurring_header" : "recurring_footer");
    });
    // Running section titles are removed only next to a proven furniture layer,
    // never at their legitimate semantic headings elsewhere in the page.
    lines.forEach((line, i) => {
      const s = compactLine(line);
      const key = repeatedTitleKey(s);
      if (running.has(key) && ([i - 1, i + 1].some(j => reasons.has(j)) ||
        [i - 2, i - 1, i + 1, i + 2].some(j => j >= 0 && j < lines.length && hasStrong(lines[j])) &&
        [i - 3, i - 2, i - 1, i + 1, i + 2, i + 3].some(j => j >= 0 && j < lines.length && watermark(lines[j])) ||
        i > 0 && /[.!?]$/u.test(compactLine(lines[i - 1])) && /^Difficulty\s+\d+$/iu.test(compactLine(lines[i + 1] ?? "")) &&
        /^\d+\s*\([+-]?\d+\)$/u.test(compactLine(lines[i + 2] ?? "")))) reasons.set(i, "recurring_furniture");
      if (barePageOrnament(line) && ([i - 2, i - 1, i + 1, i + 2].some(j => reasons.has(j)) ||
        (headerIndexes.has(i) || footerIndexes.has(i)) && /^\s*[-–—•·*]|^\s*page\s+\d/iu.test(line))) reasons.set(i, "page_ornament");
      // Preserve ordinary bare table/statblock integers, including edge integers.
    });
    // Require a short insertion bracketed by furniture. Exact normalized spans
    // must already exist outside that insertion; no semantic/fuzzy deduplication.
    const fences = [...reasons.keys()].sort((a, b) => a - b);
    for (let f = 0; f < fences.length - 1; f++) {
      const left = fences[f], right = fences[f + 1];
      if (right - left > 8 || right - left < 2) continue;
      const retainedOutside = lines.filter((_, i) => (i < left || i > right) && !reasons.has(i)).map(compactLine).join(" ");
      for (let i = left + 1; i < right; i++) {
        const s = compactLine(lines[i]);
        if (barePageOrnament(s)) { reasons.set(i, "page_ornament"); continue; }
        if (s.length >= 12 && s.split(" ").length >= 2 &&
          (` ${retainedOutside} `).includes(` ${s} `)) reasons.set(i, "duplicate_overlay");
      }
    }
    // Overlay removal may expose a running title's immediate layer neighbor.
    lines.forEach((line, i) => {
      if (running.has(repeatedTitleKey(compactLine(line))) && [i - 1, i + 1].some(j => reasons.has(j))) reasons.set(i, "recurring_furniture");
    });
    let offset = 0;
    const retained = lines.map((line, index) => {
      const reason = reasons.get(index), start = offset;
      offset += line.length + (page.text.slice(offset + line.length, offset + line.length + 2) === "\r\n" ? 2 : 1);
      if (!reason) return line;
      removedFragments.push({ page: page.pageNumber, rawText: line, normalizedKey: recurrenceKey(line), reason, lineIndex: index, start, end: start + line.length });
      countsByReason[reason]++;
      return ""; // Hard paragraph boundary: never glue across a deleted layer.
    });
    return { ...page, modelText: joinParagraphLines(retained) };
  });
  return { pages: cleaned, removedLineCount: removedFragments.length, removedFragments, countsByReason };
}

export function pageTextForModel(page: DocumentPage) { return page.modelText ?? page.text; }
