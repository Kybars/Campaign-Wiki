import type { EvidenceUnit } from "./claims-2-experiment";

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/gu, "");
const transient = /^(?:magic|attack options|special actions|end of the round|actions|reactions|traits)$/iu;
function heading(s: string) {
  if (!s || s.length > 80 || /[.!?;:]$/u.test(s) || s.split(/\s+/u).length > 10) return false;
  if (/^(?:a|an|the|he|she|it|they|we|you|i|each|when|while|if|unless|on|at|in|as|then|there|introduce)$/iu.test(s) ||
    /\b(?:the|of|in|and|to|for|a|an|with)$/iu.test(s)) return false;
  return /^#{1,6}\s|^\d+(?:\.\d+)*[.)]?\s+\p{Lu}|^Day\s+\d+$/u.test(s) ||
    /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s) ||
    /^(?:\p{Lu}[\p{L}'’-]*)(?:\s+(?:of|the|near|in|and|to|for|a|an|\p{Lu}[\p{L}'’-]*))*$/u.test(s);
}

/** Annotate existing spans, including headings embedded by cleaning. Never split or renumber units. */
export function annotateSourceStructure(input: EvidenceUnit[]) {
  const lines = input.flatMap(u => {
    let offset = u.rawSource.start;
    return u.rawSource.text.split(/\n/u).map(raw => {
      const line = { text: raw.trim(), page: u.page, offset, unitId: u.unitId };
      offset += raw.length + 1; return line;
    });
  });
  const recurrence = new Map<string, Set<number>>();
  for (const l of lines) {
    const k = key(l.text);
    if (l.text.length > 80 || !k) continue;
    if (!recurrence.has(k)) recurrence.set(k, new Set());
    recurrence.get(k)!.add(l.page);
  }
  const pageCount = new Set(input.map(u => u.page)).size;
  const edgePages = new Map<string, Set<number>>();
  for (const page of new Set(lines.map(l => l.page))) {
    const pageLines = lines.filter(l => l.page === page);
    for (const l of [...pageLines.slice(0, 3), ...pageLines.slice(-3)]) {
      if (!edgePages.has(key(l.text))) edgePages.set(key(l.text), new Set());
      edgePages.get(key(l.text))!.add(page);
    }
  }
  const suppressed = lines.filter(l => (recurrence.get(key(l.text))?.size ?? 0) >= Math.max(3, Math.ceil(pageCount * .2)) &&
    (edgePages.get(key(l.text))?.size ?? 0) >= 3 &&
    !/^(?:rumou?rs?|reports?|hearsay|day \d+)$/iu.test(l.text));
  const suppressedKeys = new Set(suppressed.map(l => key(l.text)));
  const headings = lines.filter((l, i) => {
    if (!heading(l.text) || suppressedKeys.has(key(l.text))) return false;
    if (/^\d+\s+\p{Lu}/u.test(l.text) && input.some(u => u.unitId === l.unitId && /\bd\d+\b/iu.test(u.rawSource.text))) return false;
    if (/^(?:rumou?rs?|reports?|hearsay|random (?:events|encounters|tables?|destinations))$/iu.test(l.text)) return true;
    if (/^#{1,6}\s|^\d+(?:\.\d+)+|^\d+[.)]\s|^Day\s+\d+$/iu.test(l.text) ||
      /\p{Lu}/u.test(l.text) && !/\p{Ll}/u.test(l.text)) return true;
    const next = lines[i + 1];
    // A title followed by a lowercase continuation is a wrapped sentence,
    // not an isolated section heading. Bare table row numbers are not headings.
    return !!next && next.page === l.page && /^(?:\p{Lu}|[•*-])/u.test(next.text);
  });
  let path: string[] = [], previousPage = 0, collectionRoot: string | null = null;
  const hierarchy: Array<(typeof headings)[number] & { path: string[]; transient: boolean }> = [];
  const units = input.map(u => {
    if (u.page !== previousPage && path.some(p => transient.test(p.replace(/_/gu, " ")))) path = [];
    previousPage = u.page;
    if (path.some(p => /rumou?r|reports?|hearsay/u.test(p)) &&
      /\b(?:various|different|several)\b[\s\S]*\b(?:districts|regions|areas|places|locations|groups)\b/iu.test(u.text))
      collectionRoot = path[0];
    for (const h of headings.filter(h => h.unitId === u.unitId)) {
      const title = h.text.replace(/^#+\s*/u, "");
      const numbering = title.match(/^(\d+(?:\.\d+)*)(?:[.)]?\s)/u)?.[1];
      const markupDepth = h.text.match(/^(#+)\s/u)?.[1].length;
      const collectionChild = collectionRoot && !markupDepth && !numbering && /\p{Ll}/u.test(title) &&
        !/^(?:more|further|additional|major|new|other)\s/iu.test(title);
      const depth = markupDepth ?? (numbering ? numbering.split(".").length : /^day\s+\d+/iu.test(title) || collectionChild ? 2 : 1);
      if (depth === 1) collectionRoot = null;
      path = [...path.slice(0, depth - 1), key(title)];
      hierarchy.push({ ...h, path: [...path], transient: transient.test(title) });
    }
    // Statblock scopes are deliberately bounded to their own unit.
    const context = path.join(" > ") || "main";
    if (path.some(p => transient.test(p.replace(/_/gu, " ")))) { path = []; collectionRoot = null; }
    return { ...structuredClone(u), context };
  });
  return { units, hierarchy, suppressed, diagnostics: { headings: hierarchy.length, suppressedLines: suppressed.length,
    evidenceIdsPreserved: units.every((u, i) => u.unitId === input[i].unitId), rawSpansPreserved: true } };
}
