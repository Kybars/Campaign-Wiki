/** A conservative reading copy. Raw PDF.js page text remains the citation authority. */
export interface ReadingPassage {
  text: string;
  cleanStart: number;
  cleanEnd: number;
  rawStart: number;
  rawEnd: number;
}

export interface ReadingPage {
  pageNumber: number;
  rawText: string;
  text: string;
  passages: ReadingPassage[];
  removedLines: Array<{ rawStart: number; rawEnd: number }>;
}

// These are observed PDF.js ligature splits, not a general spelling corrector.
const LIGATURE_SPLITS = [
  ["fi gure", "figure"], ["fi rst", "first"], ["fi nd", "find"],
  ["fi nds", "finds"], ["fi ghting", "fighting"], ["fi ve", "five"],
  ["fi lthy", "filthy"], ["fi nger", "finger"], ["fl ee", "flee"],
  ["sacrifi ce", "sacrifice"], ["sacrifi ced", "sacrificed"],
  ["eff orts", "efforts"], ["off er", "offer"], ["off ers", "offers"],
  ["profi t", "profit"], ["confi des", "confides"],
  ["rebuff ed", "rebuffed"], ["terrifi es", "terrifies"],
] as const;

function cleanLine(raw: string): string {
  let text = raw.replace(/[\t ]+/gu, " ").replace(/[ \t]+([,.;:!?])/gu, "$1").trim();
  for (const [broken, repaired] of LIGATURE_SPLITS) {
    const escaped = broken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "gu"), repaired);
  }
  return text;
}

function linesWithOffsets(text: string) {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    lines.push({ text: text.slice(start, end), start, end });
    start = end + 1;
  }
  return lines;
}

/**
 * Only caller-confirmed running lines are removed. A passage never crosses a
 * raw line or a physical page, so its source span can be checked directly.
 */
export function cleanReadingPages(
  pages: ReadonlyArray<{ pageNumber: number; text: string }>,
  runningLines: ReadonlyArray<string> = [],
): ReadingPage[] {
  const running = new Set(runningLines.map(line => cleanLine(line).toLocaleLowerCase("en-US")));
  return pages.map(page => {
    const passages: ReadingPassage[] = [];
    const removedLines: ReadingPage["removedLines"] = [];
    let text = "";
    const rawLines = linesWithOffsets(page.text);
    for (const [index, line] of rawLines.entries()) {
      const cleaned = cleanLine(line.text);
      if (!cleaned) continue;
      const pageOrnament = (index < 2 && /^•\s*\d{1,3}\s*•$/u.test(cleaned))
        || (index >= rawLines.length - 4 && /^\d{1,3}$/u.test(cleaned));
      const orderWatermark = index === rawLines.length - 1 && /\(Order #\d+\)$/u.test(cleaned);
      if (running.has(cleaned.toLocaleLowerCase("en-US")) || pageOrnament || orderWatermark) {
        removedLines.push({ rawStart: line.start, rawEnd: line.end });
        continue;
      }
      if (text) text += "\n";
      const cleanStart = text.length;
      text += cleaned;
      passages.push({ text: cleaned, cleanStart, cleanEnd: text.length, rawStart: line.start, rawEnd: line.end });
    }
    return { pageNumber: page.pageNumber, rawText: page.text, text, passages, removedLines };
  });
}
