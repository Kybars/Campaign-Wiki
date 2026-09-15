import { createHash } from "node:crypto";
import { normalizeName } from "../lib/graph/normalize";
import type { PageChunk } from "../lib/pdf/types";

export interface InventoryPressureSubchunk {
  id: string;
  ordinal: number;
  pages: PageChunk["pages"];
  characterCount: number;
  estimatedInputTokens: number;
  sourceHash: string;
}

export interface BoundaryAggregate {
  rawEntityCount: number;
  exactBoundaryDuplicateCount: number;
  conservativeUnionCount: number;
  rawPerType: Record<string, number>;
  unionPerType: Record<string, number>;
  provenance: Array<{ name: string; type: string; subchunkIds: string[] }>;
}

export interface LegacyExperimentInventory { entities: Array<{ temporary_id?: string; name: string; type: string; aliases?: string[]; sources?: Array<{ page_number: number; supporting_text: string }> }> }

export function summarizeInventoryPressureCalls(calls: Array<{ status: "success" | "failed"; latencyMs: number; outputBytes: number | null }>) {
  const validCalls = calls.filter((call) => call.status === "success").length;
  const knownOutput = calls.flatMap((call) => call.outputBytes === null ? [] : [call.outputBytes]);
  return { calls: calls.length, validCalls, allValid: validCalls === calls.length, meanLatencyMs: calls.length ? Math.round(calls.reduce((sum, call) => sum + call.latencyMs, 0) / calls.length) : null, maxOutputBytes: knownOutput.length ? Math.max(...knownOutput) : null };
}

export function sourceIntervalText(pages: PageChunk["pages"]): string {
  return pages.map((page) => `<campaign-page number="${page.pageNumber}">\n${page.text}\n</campaign-page>`).join("\n\n");
}

export function sourceHash(pages: PageChunk["pages"]): string {
  return createHash("sha256").update(sourceIntervalText(pages)).digest("hex");
}

export function subdivideInventorySource(chunk: PageChunk, parts: number): InventoryPressureSubchunk[] {
  if (!Number.isInteger(parts) || parts < 1 || parts > chunk.pages.length) throw new Error(`Cannot split ${chunk.pages.length} pages into ${parts} parts`);
  const lengths = chunk.pages.map((page) => page.text.length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const prefix = [0];
  for (const length of lengths) prefix.push(prefix.at(-1)! + length);
  const boundaries = [0];
  for (let group = 1; group < parts; group += 1) {
    const target = total * group / parts;
    const minimum = boundaries.at(-1)! + 1;
    const maximum = chunk.pages.length - (parts - group);
    let selected = minimum;
    for (let index = minimum; index <= maximum; index += 1) {
      if (Math.abs(prefix[index] - target) < Math.abs(prefix[selected] - target)) selected = index;
    }
    boundaries.push(selected);
  }
  boundaries.push(chunk.pages.length);
  return boundaries.slice(0, -1).map((start, ordinal) => {
    const pages = chunk.pages.slice(start, boundaries[ordinal + 1]);
    const characterCount = pages.reduce((sum, page) => sum + page.text.length, 0);
    return { id: `${chunk.id}:pressure:${parts}:${ordinal + 1}`, ordinal: ordinal + 1, pages, characterCount, estimatedInputTokens: Math.ceil(characterCount / 4), sourceHash: sourceHash(pages) };
  });
}

function increment(target: Record<string, number>, type: string) { target[type] = (target[type] ?? 0) + 1; }

function identityTokens(entity: LegacyExperimentInventory["entities"][number]) {
  return new Set([entity.name, ...(entity.aliases ?? [])].map(normalizeName).filter(Boolean));
}

export function aggregateBoundaryInventories(items: Array<{ subchunkId: string; inventory: LegacyExperimentInventory }>): BoundaryAggregate {
  const entities = items.flatMap(({ subchunkId, inventory }) => inventory.entities.map((entity) => ({ entity, subchunkId })));
  const groups: Array<{ entities: typeof entities }> = [];
  for (const candidate of entities) {
    const tokens = identityTokens(candidate.entity);
    const existing = groups.find((group) => group.entities.some((member) => [...tokens].some((token) => identityTokens(member.entity).has(token))));
    if (existing) existing.entities.push(candidate); else groups.push({ entities: [candidate] });
  }
  const rawPerType: Record<string, number> = {};
  const unionPerType: Record<string, number> = {};
  for (const { entity } of entities) increment(rawPerType, entity.type);
  for (const group of groups) increment(unionPerType, group.entities[0].entity.type);
  return {
    rawEntityCount: entities.length,
    exactBoundaryDuplicateCount: entities.length - groups.length,
    conservativeUnionCount: groups.length,
    rawPerType,
    unionPerType,
    provenance: groups.map((group) => ({ name: group.entities[0].entity.name, type: group.entities[0].entity.type, subchunkIds: [...new Set(group.entities.map((item) => item.subchunkId))] })),
  };
}
