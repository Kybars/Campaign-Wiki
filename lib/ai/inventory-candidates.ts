import { normalizeName } from "@/lib/graph/normalize";
import type { DocumentPage, PageChunk } from "@/lib/pdf/types";
import type { ExtractionInventoryOutput } from "@/lib/ai/schemas";

export const INVENTORY_CANDIDATE_HARVESTER_VERSION = "lexical-candidates-1";
export const INVENTORY_CANDIDATE_CONTEXT_MAX_CHARACTERS = 320;
export const INVENTORY_CANDIDATE_MAX_CONTEXTS = 2;

// Rejected v4 experiment contracts remain local to this archival module. They
// are deliberately not exported from the production Pass-A prompt/schema files.
export const INVENTORY_CANDIDATE_CLASSIFIER_SYSTEM_PROMPT = `Classify a finite set of source-harvested campaign name candidates.

Accept only wiki-worthy source identities. Return the canonical source-facing name, entity type, and one supplied supporting page. Reject noise and do not invent candidates. Return only name, type, and page; no IDs, aliases, evidence, summaries, facts, relationships, or prose.`;

export const INVENTORY_EVENT_DISCOVERY_SYSTEM_PROMPT = `Find only major discrete campaign Events expressed in the supplied prose.

Return concise canonical event labels and one supporting supplied page. Do not return any other entity category, evidence, facts, relationships, aliases, IDs, or prose.`;

export interface InventoryEventDiscoveryOutput {
  events: Array<{ name: string; page: number }>;
}

export interface InventoryCandidateContext { page: number; text: string }
export interface InventoryLexicalCandidate {
  surface: string;
  normalizedSurface: string;
  pages: number[];
  occurrences: number;
  contexts: InventoryCandidateContext[];
  sourceSignals: string[];
}

interface CandidateOccurrence { surface: string; page: number; start: number; end: number; signals: string[]; sentenceInitial: boolean }

const CONNECTORS = new Set(["and", "of", "the", "for", "from", "in", "into", "on", "at", "to", "with", "without", "beneath", "beyond", "de", "du", "la", "le", "von"]);
const GENERIC_SINGLETONS = new Set(["a", "an", "the", "this", "that", "these", "those", "chapter", "part", "page", "level", "adventure", "campaign", "contents", "introduction"]);
const COMMON_LOWERCASE_WORDS = new Set([
  "about", "after", "again", "against", "another", "because", "before", "being", "between", "campaign", "could", "during", "every", "first", "heroes", "however", "other", "should", "their", "there", "these", "those", "through", "under", "until", "where", "which", "while", "would",
]);
const NAMING_CUES = /\b(?:called|named|known as|emperor|empress|king|queen|prince|princess|lord|lady|duke|duchess|city|nation|empire|academy|monastery|castle|forest|artifact|item|faction|order|army|inquisitor|god|goddess|deity)\s+(?:of\s+)?$/iu;
const TOKEN_PATTERN = /[\p{L}][\p{L}\p{M}'’\-]*/gu;

function compact(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function isNamedToken(value: string): boolean {
  const first = [...value][0];
  return !!first && first.toLocaleUpperCase() === first && first.toLocaleLowerCase() !== first;
}
function isAllCaps(value: string): boolean { return /\p{L}/u.test(value) && value === value.toLocaleUpperCase() && value !== value.toLocaleLowerCase(); }
function sentenceInitial(text: string, start: number): boolean {
  const prefix = text.slice(Math.max(0, start - 12), start);
  return start === 0 || /(?:^|[.!?]\s+)$/.test(prefix);
}
function isHeading(line: string): boolean {
  const value = line.trim();
  if (!value || value.length > 100) return false;
  const words = value.match(TOKEN_PATTERN) ?? [];
  return words.length > 0 && words.length <= 10 && (!/[.!?]$/.test(value) || isAllCaps(value)) && words.filter(isNamedToken).length >= Math.ceil(words.length / 2);
}
function boundedContext(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const prior = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"));
  const offsets = [after.indexOf("."), after.indexOf("!"), after.indexOf("?"), after.indexOf("\n")].filter((value) => value >= 0);
  let left = prior >= 0 ? prior + 1 : Math.max(0, start - 120);
  let right = offsets.length ? end + Math.min(...offsets) + 1 : Math.min(text.length, end + 160);
  if (right - left > INVENTORY_CANDIDATE_CONTEXT_MAX_CHARACTERS) {
    const padding = INVENTORY_CANDIDATE_CONTEXT_MAX_CHARACTERS - (end - start);
    left = Math.max(0, start - Math.floor(padding / 2));
    right = Math.min(text.length, left + INVENTORY_CANDIDATE_CONTEXT_MAX_CHARACTERS);
  }
  return compact(text.slice(left, right));
}

function pageOccurrences(page: DocumentPage): CandidateOccurrence[] {
  const results: CandidateOccurrence[] = [];
  let offset = 0;
  for (const rawLine of page.text.split(/\r?\n/)) {
    const lineStart = page.text.indexOf(rawLine, offset);
    offset = Math.max(offset, lineStart + rawLine.length + 1);
    const heading = isHeading(rawLine);
    const tokens = [...rawLine.matchAll(TOKEN_PATTERN)].map((match) => ({ value: match[0], start: lineStart + (match.index ?? 0), end: lineStart + (match.index ?? 0) + match[0].length }));
    for (let index = 0; index < tokens.length; index += 1) {
      if (!isNamedToken(tokens[index].value)) continue;
      let endIndex = index;
      while (endIndex + 1 < tokens.length) {
        const next = tokens[endIndex + 1].value;
        if (isNamedToken(next)) { endIndex += 1; continue; }
        if (CONNECTORS.has(next.toLocaleLowerCase("en-US")) && endIndex + 2 < tokens.length && isNamedToken(tokens[endIndex + 2].value)) { endIndex += 2; continue; }
        break;
      }
      const namedIndices = Array.from({ length: endIndex - index + 1 }, (_, delta) => index + delta).filter((position) => isNamedToken(tokens[position].value));
      for (let leftNamed = 0; leftNamed < namedIndices.length; leftNamed += 1) {
        for (let rightNamed = leftNamed; rightNamed < Math.min(namedIndices.length, leftNamed + 8); rightNamed += 1) {
          const left = namedIndices[leftNamed]; const right = namedIndices[rightNamed];
          const surface = rawLine.slice(tokens[left].start - lineStart, tokens[right].end - lineStart).trim();
          const preceding = page.text.slice(Math.max(0, tokens[left].start - 70), tokens[left].start);
          const signals = [namedIndices.length > 1 ? "title-case-span" : "capitalized-token"];
          if (heading) signals.push("heading");
          if (isAllCaps(surface)) signals.push("all-caps");
          if (NAMING_CUES.test(preceding)) signals.push("naming-cue");
          if (/^\s+(?:is|was|became)\s+(?:a|an|the)\b/iu.test(page.text.slice(tokens[right].end, tokens[right].end + 32))) signals.push("predicate-naming-cue");
          if (/[’']s\b/u.test(page.text.slice(tokens[right].end, tokens[right].end + 3))) signals.push("possessive");
          results.push({ surface, page: page.pageNumber, start: tokens[left].start, end: tokens[right].end, signals, sentenceInitial: sentenceInitial(page.text, tokens[left].start) });
        }
      }
      index = endIndex;
    }
  }
  const namedWord = "[\\p{Lu}][\\p{L}\\p{M}'’\\-]*";
  const connectors = "(?:and|of|the|for|from|in|into|on|at|to|with|without|beneath|beyond|de|du|la|le|von)";
  const wrappedTitle = new RegExp(`${namedWord}(?:\\s+(?:${connectors}\\s+)*${namedWord})+`, "gu");
  for (const match of page.text.matchAll(wrappedTitle)) {
    const start = match.index ?? 0; const end = start + match[0].length;
    results.push({ surface: compact(match[0]), page: page.pageNumber, start, end, signals: ["wrapped-title-case-span"], sentenceInitial: sentenceInitial(page.text, start) });
  }
  for (const match of page.text.matchAll(/\b(?:the|a|an)\s+[\p{Lu}][\p{L}\p{M}'’\-]*/gu)) {
    const start = match.index ?? 0; const end = start + match[0].length;
    results.push({ surface: match[0], page: page.pageNumber, start, end, signals: ["article-name-cue"], sentenceInitial: sentenceInitial(page.text, start) });
  }
  const lowercase = [...page.text.matchAll(/\b[\p{Ll}][\p{L}\p{M}'’\-]{5,}\b/gu)];
  const lowercaseCounts = new Map<string, number>();
  lowercase.forEach((match) => lowercaseCounts.set(normalizeName(match[0]), (lowercaseCounts.get(normalizeName(match[0])) ?? 0) + 1));
  for (const match of lowercase) {
    const normalized = normalizeName(match[0]);
    if ((lowercaseCounts.get(normalized) ?? 0) < 3 || COMMON_LOWERCASE_WORDS.has(normalized)) continue;
    const start = match.index ?? 0;
    results.push({ surface: match[0], page: page.pageNumber, start, end: start + match[0].length, signals: ["repeated-lowercase-term"], sentenceInitial: false });
  }
  return results;
}

export function harvestInventoryCandidates(chunk: PageChunk): { rawCount: number; candidates: InventoryLexicalCandidate[]; contextCharacters: number } {
  const raw = chunk.pages.flatMap(pageOccurrences);
  const occurrenceCounts = new Map<string, number>();
  raw.forEach((item) => occurrenceCounts.set(normalizeName(item.surface), (occurrenceCounts.get(normalizeName(item.surface)) ?? 0) + 1));
  const accepted = raw.filter((item) => {
    const normalized = normalizeName(item.surface);
    if (!normalized || GENERIC_SINGLETONS.has(normalized)) return false;
    const wordCount = item.surface.match(TOKEN_PATTERN)?.length ?? 0;
    if (wordCount > 1) return true;
    return !item.sentenceInitial || (occurrenceCounts.get(normalized) ?? 0) > 1 || item.signals.some((signal) => signal !== "capitalized-token");
  });
  const bySurface = new Map<string, { surface: string; occurrences: CandidateOccurrence[] }>();
  for (const item of accepted) {
    const key = normalizeName(item.surface);
    const prior = bySurface.get(key);
    if (prior) prior.occurrences.push(item);
    else bySurface.set(key, { surface: item.surface, occurrences: [item] });
  }
  const pageByNumber = new Map(chunk.pages.map((page) => [page.pageNumber, page.text]));
  const candidates = [...bySurface.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([normalizedSurface, value]) => {
    const contexts: InventoryCandidateContext[] = [];
    for (const occurrence of value.occurrences) {
      const text = boundedContext(pageByNumber.get(occurrence.page)!, occurrence.start, occurrence.end);
      if (!contexts.some((context) => context.page === occurrence.page && context.text === text)) contexts.push({ page: occurrence.page, text });
      if (contexts.length >= INVENTORY_CANDIDATE_MAX_CONTEXTS) break;
    }
    return {
      surface: value.surface, normalizedSurface, pages: [...new Set(value.occurrences.map((item) => item.page))].sort((a, b) => a - b),
      occurrences: value.occurrences.length, contexts,
      sourceSignals: [...new Set(value.occurrences.flatMap((item) => item.signals))].sort(),
    };
  });
  return { rawCount: raw.length, candidates, contextCharacters: candidates.reduce((sum, candidate) => sum + candidate.contexts.reduce((subtotal, context) => subtotal + context.text.length, 0), 0) };
}

export function buildCandidateClassifierInput(chunk: PageChunk): unknown {
  const candidates = harvestInventoryCandidates(chunk).candidates;
  const windows: Array<{ id: number; page: number; text: string }> = [];
  const windowIds = new Map<string, number>();
  const conciseCandidates = candidates.map((candidate) => ({
    surface: candidate.surface,
    pages: candidate.pages,
    context_window_ids: candidate.contexts.map((context) => {
      const key = `${context.page}\u001f${context.text}`;
      let id = windowIds.get(key);
      if (id === undefined) {
        id = windows.length + 1;
        windowIds.set(key, id);
        windows.push({ id, page: context.page, text: context.text });
      }
      return id;
    }),
  }));
  return { harvester_version: INVENTORY_CANDIDATE_HARVESTER_VERSION, context_windows: windows, candidates: conciseCandidates };
}

export function buildEventDiscoveryInput(chunk: PageChunk): unknown {
  return { campaign_pages: chunk.pages.map((page) => ({ page_number: page.pageNumber, text: page.text })) };
}

export interface ClassifierValidationResult { accepted: ExtractionInventoryOutput; unknown: ExtractionInventoryOutput["entities"] }
export function validateCandidateClassifierOutput(output: ExtractionInventoryOutput, candidates: InventoryLexicalCandidate[]): ClassifierValidationResult {
  const allowed = new Map(candidates.map((candidate) => [candidate.normalizedSurface, candidate]));
  const accepted: ExtractionInventoryOutput["entities"] = [];
  const unknown: ExtractionInventoryOutput["entities"] = [];
  for (const entity of output.entities) {
    const candidate = allowed.get(normalizeName(entity.name));
    if (!candidate || !candidate.pages.includes(entity.page)) unknown.push(entity);
    else accepted.push(entity);
  }
  return { accepted: { entities: accepted }, unknown };
}

export function unionInventoryOutputs(classified: ExtractionInventoryOutput, events: InventoryEventDiscoveryOutput): ExtractionInventoryOutput {
  const entities = [...classified.entities, ...events.events.map((event) => ({ ...event, type: "event" as const }))];
  const unique = new Map<string, ExtractionInventoryOutput["entities"][number]>();
  for (const entity of entities) {
    const key = `${entity.type}\u001f${normalizeName(entity.name)}\u001f${entity.page}`;
    if (!unique.has(key)) unique.set(key, entity);
  }
  return { entities: [...unique.values()].sort((left, right) => `${left.type}:${normalizeName(left.name)}:${left.page}`.localeCompare(`${right.type}:${normalizeName(right.name)}:${right.page}`)) };
}
