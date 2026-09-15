import { createHash } from "node:crypto";
import { normalizeName } from "../lib/graph/normalize";
import type { ValidatedExtractionInventoryOutput } from "../lib/ai/schemas";
import type { PageChunk } from "../lib/pdf/types";

export interface SourceSizeSubchunk {
  originalChunkNumber: number;
  id: string;
  sourceLabel: string;
  pages: PageChunk["pages"];
  characterCount: number;
  estimatedInputTokens: number;
  sourceHash: string;
}

export function sourceIntervalText(pages: PageChunk["pages"]): string {
  return pages.map((page) => `<campaign-page number="${page.pageNumber}">\n${page.text}\n</campaign-page>`).join("\n\n");
}

export function sourceIntervalHash(pages: PageChunk["pages"]): string {
  return createHash("sha256").update(sourceIntervalText(pages)).digest("hex");
}

/** Splits only on page boundaries, choosing the closest ordered character boundary. */
export function splitSourceSizeExperiment(chunk: PageChunk, originalChunkNumber: number, labels: [string, string]): SourceSizeSubchunk[] {
  if (chunk.pages.length < 2) throw new Error("A source-size split requires at least two pages");
  const lengths = chunk.pages.map((page) => page.text.length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let running = 0;
  let boundary = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < chunk.pages.length; index += 1) {
    running += lengths[index - 1];
    const distance = Math.abs(running - total / 2);
    if (distance < bestDistance) { boundary = index; bestDistance = distance; }
  }
  return [chunk.pages.slice(0, boundary), chunk.pages.slice(boundary)].map((pages, index) => ({
    originalChunkNumber,
    id: `${chunk.id}:source-size:${labels[index]}`,
    sourceLabel: labels[index],
    pages,
    characterCount: pages.reduce((sum, page) => sum + page.text.length, 0),
    estimatedInputTokens: Math.ceil(pages.reduce((sum, page) => sum + page.text.length, 0) / 4),
    sourceHash: sourceIntervalHash(pages),
  }));
}

export function verifyCompleteOrderedCoverage(original: PageChunk["pages"], subdivisions: SourceSizeSubchunk[]): boolean {
  return sourceIntervalText(original) === subdivisions.map((item) => sourceIntervalText(item.pages)).join("\n\n")
    && original.map((page) => page.pageNumber).join(",") === subdivisions.flatMap((item) => item.pages.map((page) => page.pageNumber)).join(",");
}

export interface LogicalUnion {
  rawInventoryCount: number;
  sameTypeNameDuplicates: Array<{ type: string; name: string; rawIds: string[]; subchunkIds: string[] }>;
  crossTypeNameCollisions: Array<{ name: string; types: string[]; rawIds: string[]; subchunkIds: string[] }>;
  conservativeLogicalUnionCount: number;
  perTypeLogicalCounts: Record<string, number>;
  entities: Array<{ name: string; type: string; rawIds: string[]; subchunkIds: string[] }>;
}

export function logicalInventoryUnion(items: Array<{ subchunkId: string; inventory: ValidatedExtractionInventoryOutput }>): LogicalUnion {
  const raw = items.flatMap(({ subchunkId, inventory }) => inventory.entities.map((entity) => ({ entity, subchunkId, nameKey: normalizeName(entity.name) })));
  const byTypeAndName = new Map<string, typeof raw>();
  const byName = new Map<string, typeof raw>();
  for (const item of raw) {
    const typedKey = `${item.entity.type}\u001f${item.nameKey}`;
    byTypeAndName.set(typedKey, [...(byTypeAndName.get(typedKey) ?? []), item]);
    byName.set(item.nameKey, [...(byName.get(item.nameKey) ?? []), item]);
  }
  const groups = [...byTypeAndName.values()];
  const entities = groups.map((group) => ({ name: group[0].entity.name, type: group[0].entity.type, rawIds: group.map((item) => item.entity.temporary_id), subchunkIds: [...new Set(group.map((item) => item.subchunkId))] }));
  const sameTypeNameDuplicates = groups.filter((group) => group.length > 1).map((group) => ({ type: group[0].entity.type, name: group[0].entity.name, rawIds: group.map((item) => item.entity.temporary_id), subchunkIds: [...new Set(group.map((item) => item.subchunkId))] }));
  const crossTypeNameCollisions = [...byName.values()].filter((group) => new Set(group.map((item) => item.entity.type)).size > 1).map((group) => ({ name: group[0].entity.name, types: [...new Set(group.map((item) => item.entity.type))].sort(), rawIds: group.map((item) => item.entity.temporary_id), subchunkIds: [...new Set(group.map((item) => item.subchunkId))] }));
  const perTypeLogicalCounts: Record<string, number> = {};
  for (const entity of entities) perTypeLogicalCounts[entity.type] = (perTypeLogicalCounts[entity.type] ?? 0) + 1;
  return { rawInventoryCount: raw.length, sameTypeNameDuplicates, crossTypeNameCollisions, conservativeLogicalUnionCount: entities.length, perTypeLogicalCounts, entities };
}
