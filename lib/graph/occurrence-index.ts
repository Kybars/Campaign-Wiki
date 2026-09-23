import { scanSourceOccurrences } from "@/lib/graph/prominence";
import { isSafeMentionAlias } from "@/lib/graph/prominence";
import { normalizeName } from "@/lib/graph/normalize";
import type { DocumentPage } from "@/lib/pdf/types";

/**
 * Deterministic, semantic-text occurrence map.  It deliberately answers only
 * "which known identity occurs where"; it never assigns relationship meaning.
 */
export interface EntityOccurrence {
  entityId: string;
  page: number;
  count: number;
  excerpt: string;
}

export interface EntityOccurrenceIndex {
  byEntityId: ReadonlyMap<string, EntityOccurrence[]>;
  byPage: ReadonlyMap<number, string[]>;
}

export interface BoundedEntityContext {
  occurringEntityIds: string[];
  contextEntityIds: string[];
  entityIds: string[];
}

type ContextEntity = { temporary_id: string; name: string; type?: string; aliases?: string[] };

const ORDINALS = new Set(["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"]);
const ORGANIZATION_WORDS = new Set(["army", "fleet", "guard", "legion", "order", "regiment"]);
const UNIQUE_TITLES = new Set(["baron", "baroness", "duchess", "duke", "emperor", "empress", "king", "prince", "princess", "queen"]);
const EVENT_ACTIONS: Record<string, RegExp> = {
  assassination: /\b(?:assassinat\p{L}*|kill\p{L}*|murder\p{L}*|slain|slew)\b/iu,
  death: /\b(?:dead|death|die\p{L}*|kill\p{L}*|slain|slew)\b/iu,
  killing: /\b(?:kill\p{L}*|murder\p{L}*|slain|slew)\b/iu,
  murder: /\b(?:assassinat\p{L}*|kill\p{L}*|murder\p{L}*|slain|slew)\b/iu,
};

function escapedPattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"); }

export function entityIdsInSemanticText(entities: Array<{ temporary_id: string; name: string; aliases?: string[] }>, semanticText: string): string[] {
  return entities.filter((entity) => [...new Map([entity.name, ...(entity.aliases ?? [])].filter(isSafeMentionAlias).map((name) => [normalizeName(name), name])).values()]
    .some((name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapedPattern(name)}(?![\\p{L}\\p{N}])`, "iu").test(semanticText)))
    .map((entity) => entity.temporary_id).sort();
}

function normalizedTokens(value: string) { return normalizeName(value).split(" ").filter(Boolean); }

/**
 * Adds only bounded identity context that is lexically anchored in the supplied
 * text. These rules resolve a mention to a known ID; they do not assign or infer
 * relationship meaning. Ambiguous title/ordinal signatures are deliberately
 * excluded.
 */
export function boundedEntityContextInSemanticText(entities: ContextEntity[], semanticText: string): BoundedEntityContext {
  const occurringEntityIds = entityIdsInSemanticText(entities, semanticText);
  const occurring = new Set(occurringEntityIds);
  const context = new Set<string>();
  const normalizedText = normalizeName(semanticText);

  const titleCounts = new Map<string, number>();
  const ordinalOrganizationCounts = new Map<string, number>();
  for (const entity of entities) {
    const tokens = normalizedTokens(entity.name);
    if (entity.type === "npc") for (const title of tokens.filter((token) => UNIQUE_TITLES.has(token))) titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    const ordinal = tokens.find((token) => ORDINALS.has(token));
    const organization = tokens.find((token) => ORGANIZATION_WORDS.has(token));
    if (entity.type === "faction" && ordinal && organization) ordinalOrganizationCounts.set(`${ordinal}:${organization}`, (ordinalOrganizationCounts.get(`${ordinal}:${organization}`) ?? 0) + 1);
  }

  for (const entity of entities) {
    if (occurring.has(entity.temporary_id)) continue;
    const tokens = normalizedTokens(entity.name);

    // Conservative singular/adjectival faction form, e.g. Ragesians ->
    // Ragesian. The boundary prevents substring matches.
    if (entity.type === "faction") {
      const final = tokens.at(-1);
      if (final && final.length >= 6 && final.endsWith("s")) {
        const variant = final.slice(0, -1);
        if (new RegExp(`(?<![\\p{L}\\p{N}])${escapedPattern(variant)}(?![\\p{L}\\p{N}])`, "iu").test(semanticText)) context.add(entity.temporary_id);
      }
    }

    // Formal organization labels are often rendered locally as an ordinal plus
    // organization kind ("second ... army"). Require a globally unique pair.
    const ordinal = tokens.find((token) => ORDINALS.has(token));
    const organization = tokens.find((token) => ORGANIZATION_WORDS.has(token));
    if (entity.type === "faction" && ordinal && organization && ordinalOrganizationCounts.get(`${ordinal}:${organization}`) === 1) {
      const between = "(?:\\s+[\\p{L}\\p{N}'’-]+){0,3}\\s+";
      if (new RegExp(`\\b${escapedPattern(ordinal)}${between}${escapedPattern(organization)}\\b`, "iu").test(normalizedText)) context.add(entity.temporary_id);
    }

    // Resolve a generic titled reference only when the final inventory contains
    // exactly one entity with that title. This remains a bounded candidate, not
    // an asserted fact.
    const title = tokens.find((token) => UNIQUE_TITLES.has(token));
    if (entity.type === "npc" && title && titleCounts.get(title) === 1) {
      if (new RegExp(`\\b(?:the\\s+)?(?:[\\p{L}'’-]+\\s+){0,2}${escapedPattern(title)}\\b`, "iu").test(normalizedText)) context.add(entity.temporary_id);
    }

    // Named death/assassination events can be expressed verbally. Require both
    // an event-family verb and a distinctive subject token from "... of NAME".
    const eventFamily = tokens[0];
    const ofIndex = tokens.indexOf("of");
    const subjectTokens = ofIndex >= 0 ? tokens.slice(ofIndex + 1).filter((token) => token.length >= 5) : [];
    if (entity.type === "event" && EVENT_ACTIONS[eventFamily] && EVENT_ACTIONS[eventFamily].test(semanticText)
      && subjectTokens.some((token) => new RegExp(`(?<![\\p{L}\\p{N}])${escapedPattern(token)}(?![\\p{L}\\p{N}])`, "iu").test(semanticText))) context.add(entity.temporary_id);
  }

  const contextEntityIds = [...context].filter((id) => !occurring.has(id)).sort();
  return { occurringEntityIds, contextEntityIds, entityIds: [...occurringEntityIds, ...contextEntityIds].sort() };
}

export function buildEntityOccurrenceIndex(
  entities: Array<{ temporary_id: string; name: string; aliases?: string[] }>,
  pages: DocumentPage[],
): EntityOccurrenceIndex {
  const byEntityId = new Map<string, EntityOccurrence[]>();
  const pageSets = new Map<number, Set<string>>();
  for (const entity of [...entities].sort((a, b) => a.temporary_id.localeCompare(b.temporary_id))) {
    const scan = scanSourceOccurrences({ name: entity.name, aliases: entity.aliases ?? [] } as never, pages);
    const occurrences = scan.pageEvidence.map((evidence) => ({
      entityId: entity.temporary_id,
      page: evidence.page_number,
      // The shared scanner intentionally deduplicates overlapping aliases.
      // Page membership is the relevant deterministic signal for windowing.
      count: 1,
      excerpt: evidence.supporting_text,
    }));
    byEntityId.set(entity.temporary_id, occurrences);
    for (const occurrence of occurrences) {
      const ids = pageSets.get(occurrence.page) ?? new Set<string>();
      ids.add(entity.temporary_id);
      pageSets.set(occurrence.page, ids);
    }
  }
  return {
    byEntityId,
    byPage: new Map([...pageSets].map(([page, ids]) => [page, [...ids].sort()])),
  };
}
