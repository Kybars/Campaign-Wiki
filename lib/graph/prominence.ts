import type { EntityType } from "@/lib/db/types";
import type { CanonicalEntity, CanonicalGraph } from "@/lib/graph/types";
import { normalizeName } from "@/lib/graph/normalize";
import type { EntityProminence } from "@/lib/knowledge/types";
import type { DocumentPage } from "@/lib/pdf/types";

export const PROMINENCE_SCORE_WEIGHTS = {
  mentionPageCount: 3,
  mentionCount: 1,
  relationshipCount: 2,
} as const;

const GENERIC_MENTION_ALIASES = new Set([
  "captain", "commander", "duke", "duchess", "emperor", "empress", "general", "king", "knight",
  "lady", "lord", "master", "prince", "princess", "queen", "sergeant", "sir",
]);

export interface SourceProminenceMetrics {
  mentionCount: number;
  mentionPageCount: number;
  relationshipCount: number;
  prominenceScore: number;
}

export function isSafeMentionAlias(value: string): boolean {
  const normalized = normalizeName(value);
  if (!normalized) return false;
  const tokens = normalized.split(" ");
  if (tokens.length === 1) return tokens[0].length >= 4 && !GENERIC_MENTION_ALIASES.has(tokens[0]);
  return tokens.some((token) => token.length >= 3 && !GENERIC_MENTION_ALIASES.has(token) && token !== "the");
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function countNormalizedSourceMentions(entity: Pick<CanonicalEntity, "name" | "aliases">, pages: Array<{ pageNumber: number; text: string }>) {
  const names = [...new Map([entity.name, ...entity.aliases]
    .filter(isSafeMentionAlias)
    .map((name) => [normalizeName(name), name])).keys()]
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  const expressions = names.map((name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapedPattern(name)}(?![\\p{L}\\p{N}])`, "gu"));
  let mentionCount = 0;
  const mentionedPages = new Set<number>();

  for (const page of pages) {
    const spans: Array<{ start: number; end: number }> = [];
    for (const expression of expressions) for (const match of page.text.matchAll(expression)) spans.push({ start: match.index, end: match.index + match[0].length });
    spans.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
    const accepted: Array<{ start: number; end: number }> = [];
    for (const span of spans) {
      if (!accepted.some((item) => span.start < item.end && span.end > item.start)) accepted.push(span);
    }
    if (accepted.length) mentionedPages.add(page.pageNumber);
    mentionCount += accepted.length;
  }

  return { mentionCount, mentionPageCount: mentionedPages.size };
}

export function countSourceMentions(entity: Pick<CanonicalEntity, "name" | "aliases">, pages: DocumentPage[]) {
  return countNormalizedSourceMentions(entity, pages.map((page) => ({ pageNumber: page.pageNumber, text: normalizeName(page.text) })));
}

export function calculateProminenceScore(metrics: Omit<SourceProminenceMetrics, "prominenceScore">): number {
  return metrics.mentionPageCount * PROMINENCE_SCORE_WEIGHTS.mentionPageCount
    + metrics.mentionCount * PROMINENCE_SCORE_WEIGHTS.mentionCount
    + metrics.relationshipCount * PROMINENCE_SCORE_WEIGHTS.relationshipCount;
}

function bucketSizes(count: number) {
  if (count <= 0) return { major: 0, supporting: 0 };
  if (count === 1) return { major: 1, supporting: 0 };
  if (count === 2) return { major: 1, supporting: 1 };
  if (count === 3 || count === 4) return { major: 1, supporting: 1 };
  if (count === 5) return { major: 1, supporting: 2 };
  return { major: Math.max(1, Math.round(count * 0.2)), supporting: Math.max(1, Math.round(count * 0.3)) };
}

export function classifyEntityProminence<T extends { key: string; name: string; normalizedName: string; type: EntityType }>(entities: T[], metrics: ReadonlyMap<string, SourceProminenceMetrics>): Map<string, EntityProminence> {
  const result = new Map<string, EntityProminence>();
  const types = [...new Set(entities.map((entity) => entity.type))].sort();
  for (const type of types) {
    const ranked = entities.filter((entity) => entity.type === type).toSorted((left, right) => {
      const a = metrics.get(left.key) ?? { mentionCount: 0, mentionPageCount: 0, relationshipCount: 0, prominenceScore: 0 };
      const b = metrics.get(right.key) ?? { mentionCount: 0, mentionPageCount: 0, relationshipCount: 0, prominenceScore: 0 };
      return b.prominenceScore - a.prominenceScore
        || b.mentionPageCount - a.mentionPageCount
        || b.mentionCount - a.mentionCount
        || b.relationshipCount - a.relationshipCount
        || left.normalizedName.localeCompare(right.normalizedName)
        || left.key.localeCompare(right.key);
    });
    const sizes = bucketSizes(ranked.length);
    ranked.forEach((entity, index) => result.set(entity.key, index < sizes.major ? "major" : index < sizes.major + sizes.supporting ? "supporting" : "minor"));
  }
  return result;
}

export function applyDeterministicProminence(graph: CanonicalGraph, pages: DocumentPage[]): CanonicalGraph {
  const normalizedPages = pages.map((page) => ({ pageNumber: page.pageNumber, text: normalizeName(page.text) }));
  const relationshipKeys = new Map(graph.entities.map((entity) => [entity.key, new Set<string>()]));
  for (const relationship of graph.relationships) {
    relationshipKeys.get(relationship.sourceEntityKey)?.add(relationship.key);
    relationshipKeys.get(relationship.targetEntityKey)?.add(relationship.key);
  }
  const metrics = new Map<string, SourceProminenceMetrics>();
  for (const entity of graph.entities) {
    const mentions = countNormalizedSourceMentions(entity, normalizedPages);
    const base = { ...mentions, relationshipCount: relationshipKeys.get(entity.key)?.size ?? 0 };
    metrics.set(entity.key, { ...base, prominenceScore: calculateProminenceScore(base) });
  }
  const classifications = classifyEntityProminence(graph.entities, metrics);
  return {
    ...graph,
    entities: graph.entities.map((entity) => {
      const metric = metrics.get(entity.key)!;
      return {
        ...entity,
        prominence: classifications.get(entity.key)!,
        prominenceReason: `Deterministic source score ${metric.prominenceScore}`,
        prominenceEvidence: [],
        questStatus: entity.type === "quest" ? "not_started" : entity.questStatus,
        sourceMentionCount: metric.mentionCount,
        sourceMentionPageCount: metric.mentionPageCount,
      };
    }),
  };
}
