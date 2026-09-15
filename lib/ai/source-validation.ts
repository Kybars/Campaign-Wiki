import { createHash } from "node:crypto";
import { INVENTORY_EVIDENCE_MAX_CHARACTERS, type CandidateEntity, type CandidateRelationship, type ChunkExtraction, type ExtractionInventoryOutput, type ExtractionRichOutput, type SourceEvidence, type ValidatedExtractionInventoryEntity, type ValidatedExtractionInventoryOutput } from "@/lib/ai/schemas";
import type { DocumentPage, PageChunk } from "@/lib/pdf/types";
import { isFactFieldForEntityType } from "@/lib/knowledge/fields";

export interface ValidationDiagnostic {
  kind: "source" | "entity" | "fact" | "relationship";
  identifier: string;
  reason: string;
}

export interface ValidatedExtraction {
  extraction: ChunkExtraction;
  diagnostics: ValidationDiagnostic[];
}

export function normalizeEvidenceText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteMatchesPage(quote: string, pageText: string): boolean {
  const normalizedQuote = normalizeEvidenceText(quote);
  const normalizedPage = normalizeEvidenceText(pageText);
  if (normalizedQuote.length < 8 || normalizedPage.length === 0) return false;
  if (normalizedPage.includes(normalizedQuote)) return true;

  const quoteTokens = [...new Set(normalizedQuote.split(" ").filter((token) => token.length > 2))];
  if (quoteTokens.length < 3) return false;
  const pageTokens = new Set(normalizedPage.split(" "));
  const matched = quoteTokens.filter((token) => pageTokens.has(token)).length;
  const orderedQuoteTokens = normalizedQuote.split(" ").filter((token) => token.length > 2);
  const hasContiguousPhrase = orderedQuoteTokens.slice(0, -2).some((_, index) =>
    normalizedPage.includes(orderedQuoteTokens.slice(index, index + 3).join(" ")),
  );
  return hasContiguousPhrase && matched / quoteTokens.length >= 0.8;
}

export function validateSource(source: SourceEvidence, pages: DocumentPage[]): string | null {
  const page = pages.find((candidate) => candidate.pageNumber === source.page_number);
  if (!page) return `page ${source.page_number} is not in this chunk`;
  if (!quoteMatchesPage(source.supporting_text, page.text)) return "supporting text does not match the referenced page";
  return null;
}

function validSources<T extends { sources: SourceEvidence[] }>(
  item: T,
  pages: DocumentPage[],
  identifier: string,
  diagnostics: ValidationDiagnostic[],
): T["sources"] {
  return item.sources.filter((source) => {
    const reason = validateSource(source, pages);
    if (reason) diagnostics.push({ kind: "source", identifier, reason });
    return reason === null;
  });
}

export interface ValidatedInventory {
  inventory: ValidatedExtractionInventoryOutput;
  diagnostics: ValidationDiagnostic[];
}

export interface ValidatedRichExtraction {
  rich: ExtractionRichOutput;
  diagnostics: ValidationDiagnostic[];
}

type LegacyInventoryOutput = { entities: Array<{ temporary_id: string; name: string; type: ValidatedExtractionInventoryEntity["type"]; sources: SourceEvidence[] }> };

const GROUNDING_STOP_WORDS = new Set(["a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to"]);

interface TextToken { normalized: string; start: number; end: number }

function compactSourceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function textTokens(value: string): TextToken[] {
  return [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({ normalized: normalizeEvidenceText(match[0]), start: match.index, end: match.index + match[0].length }));
}

function exactTokenRange(name: string, pageText: string): { start: number; end: number } | null {
  const wanted = textTokens(name).map((token) => token.normalized);
  const available = textTokens(pageText);
  if (!wanted.length) return null;
  for (let index = 0; index <= available.length - wanted.length; index += 1) {
    if (wanted.every((token, offset) => available[index + offset].normalized === token)) return { start: available[index].start, end: available[index + wanted.length - 1].end };
  }
  return null;
}

function stemsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 6 || right.length < 6) return false;
  return left.slice(0, 6) === right.slice(0, 6);
}

function inferredTokenRange(name: string, pageText: string): { start: number; end: number } | null {
  const wanted = textTokens(name).map((token) => token.normalized).filter((token) => token.length > 2 && !GROUNDING_STOP_WORDS.has(token));
  const available = textTokens(pageText);
  if (wanted.length < 2) return null;
  const matches = wanted.flatMap((token) => {
    const match = available.find((candidate) => stemsMatch(token, candidate.normalized));
    return match ? [match] : [];
  });
  if (matches.length < 2 || matches.length / wanted.length < 0.75) return null;
  const start = Math.min(...matches.map((match) => match.start));
  const end = Math.max(...matches.map((match) => match.end));
  if (end - start > 600) return null;
  return { start, end };
}

function boundedEvidenceSpan(pageText: string, range: { start: number; end: number }): string | null {
  const before = pageText.slice(0, range.start);
  const after = pageText.slice(range.end);
  const priorBoundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"));
  const followingOffsets = [after.indexOf("."), after.indexOf("!"), after.indexOf("?")].filter((offset) => offset >= 0);
  const followingBoundary = followingOffsets.length ? range.end + Math.min(...followingOffsets) + 1 : pageText.length;
  let start = priorBoundary >= 0 ? priorBoundary + 1 : 0;
  let end = followingBoundary;
  if (end - start > INVENTORY_EVIDENCE_MAX_CHARACTERS) {
    const padding = Math.max(0, INVENTORY_EVIDENCE_MAX_CHARACTERS - (range.end - range.start));
    start = Math.max(0, range.start - Math.floor(padding / 2));
    end = Math.min(pageText.length, start + INVENTORY_EVIDENCE_MAX_CHARACTERS);
    if (end - start < INVENTORY_EVIDENCE_MAX_CHARACTERS) start = Math.max(0, end - INVENTORY_EVIDENCE_MAX_CHARACTERS);
    const leadingSpace = pageText.indexOf(" ", start);
    if (start > 0 && leadingSpace >= 0 && leadingSpace < range.start) start = leadingSpace + 1;
    const trailingSpace = pageText.lastIndexOf(" ", end);
    if (end < pageText.length && trailingSpace > range.end) end = trailingSpace;
  }
  let excerpt = pageText.slice(start, end).trim();
  if (excerpt.length < 8) {
    start = Math.max(0, range.start - 40);
    end = Math.min(pageText.length, Math.max(range.end + 80, start + 8));
    excerpt = pageText.slice(start, end).trim();
  }
  if (excerpt.length < 8 || excerpt.length > INVENTORY_EVIDENCE_MAX_CHARACTERS) return null;
  return excerpt;
}

export interface InventoryGroundingResult {
  source: SourceEvidence | null;
  strategy: "exact_normalized_name" | "inferred_event_or_quest_tokens" | null;
  reason: string | null;
}

export function groundInventoryIdentity(entity: ExtractionInventoryOutput["entities"][number], pages: DocumentPage[]): InventoryGroundingResult {
  const page = pages.find((candidate) => candidate.pageNumber === entity.page);
  if (!page) return { source: null, strategy: null, reason: `page ${entity.page} is not in this chunk` };
  const compact = compactSourceText(page.text);
  const exact = exactTokenRange(entity.name, compact);
  const inferred = exact ? null : (entity.type === "event" || entity.type === "quest" ? inferredTokenRange(entity.name, compact) : null);
  const range = exact ?? inferred;
  if (!range) return { source: null, strategy: null, reason: entity.type === "event" || entity.type === "quest" ? "no clear exact-name or inferred event/quest token anchors on referenced page" : "normalized name does not occur on referenced page" };
  const supporting_text = boundedEvidenceSpan(compact, range);
  if (!supporting_text) return { source: null, strategy: null, reason: "could not select a bounded source span around the grounded mention" };
  return { source: { page_number: entity.page, supporting_text }, strategy: exact ? "exact_normalized_name" : "inferred_event_or_quest_tokens", reason: null };
}

function chunkFingerprint(chunk: PageChunk): string {
  return createHash("sha256").update(JSON.stringify(chunk.pages.map((page) => ({ page_number: page.pageNumber, text: page.text })))).digest("hex");
}

export function deterministicInventoryId(sourceChunkFingerprint: string, type: ValidatedExtractionInventoryEntity["type"], name: string, page: number): string {
  const key = [sourceChunkFingerprint, type, normalizeEvidenceText(name), page].join("\u001f");
  return `inv_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

export function validatedInventoryFingerprint(inventory: ValidatedExtractionInventoryOutput): string {
  return createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
}

export function validateExtractionInventory(raw: ExtractionInventoryOutput | LegacyInventoryOutput, chunkOrPages: PageChunk | DocumentPage[]): ValidatedInventory {
  const diagnostics: ValidationDiagnostic[] = [];
  const chunk: PageChunk = Array.isArray(chunkOrPages) ? { id: "legacy-page-set", pages: chunkOrPages, characterCount: chunkOrPages.reduce((sum, page) => sum + page.text.length, 0) } : chunkOrPages;
  if (raw.entities.some((entity) => "temporary_id" in entity)) {
    const ids = new Set<string>();
    const entities = raw.entities.flatMap((entity) => {
      if (!("temporary_id" in entity)) throw new Error("Mixed compact and legacy inventory entries are invalid");
      if (ids.has(entity.temporary_id)) throw new Error(`Duplicate inventory ID: ${entity.temporary_id}`);
      ids.add(entity.temporary_id);
      const sources = validSources(entity, chunk.pages, entity.temporary_id, diagnostics);
      if (!sources.length) return [];
      return [{ temporary_id: entity.temporary_id, name: entity.name, type: entity.type, sources: [sources[0]] as [SourceEvidence] }];
    });
    return { inventory: { entities }, diagnostics };
  }
  const fingerprint = chunkFingerprint(chunk);
  const byIdentity = new Map<string, { entity: ExtractionInventoryOutput["entities"][number]; source: SourceEvidence }>();
  for (const entity of raw.entities) {
    if (!("page" in entity)) throw new Error("Mixed identity-page and legacy inventory entries are invalid");
    const identifier = `${entity.type}:${entity.name}`;
    const grounding = groundInventoryIdentity(entity, chunk.pages);
    if (!grounding.source) {
      diagnostics.push({ kind: "source", identifier, reason: grounding.reason ?? "grounding failed" });
      diagnostics.push({ kind: "entity", identifier, reason: "no valid source evidence" });
      continue;
    }
    const key = [fingerprint, entity.type, normalizeEvidenceText(entity.name), entity.page].join("\u001f");
    if (byIdentity.has(key)) {
      diagnostics.push({ kind: "entity", identifier, reason: "duplicate identity-page inventory entry" });
      continue;
    }
    byIdentity.set(key, { entity, source: grounding.source });
  }
  const entities: ValidatedExtractionInventoryEntity[] = [...byIdentity.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, { entity, source }]) => ({
    temporary_id: deterministicInventoryId(fingerprint, entity.type, entity.name, entity.page),
    name: entity.name,
    type: entity.type,
    sources: [source],
  }));
  if (new Set(entities.map((entity) => entity.temporary_id)).size !== entities.length) throw new Error("Deterministic inventory ID collision");
  return { inventory: { entities }, diagnostics };
}

export function validateExtractionRich(raw: ExtractionRichOutput, inventory: ValidatedExtractionInventoryOutput, pages: DocumentPage[]): ValidatedRichExtraction {
  const diagnostics: ValidationDiagnostic[] = [];
  const inventoryById = new Map(inventory.entities.map((entity) => [entity.temporary_id, entity]));
  const seen = new Set<string>();
  const entities = raw.entities.map((entity) => {
    if (seen.has(entity.inventory_id)) throw new Error(`Duplicate rich inventory ID: ${entity.inventory_id}`);
    seen.add(entity.inventory_id);
    const owner = inventoryById.get(entity.inventory_id);
    if (!owner) throw new Error(`Unknown rich inventory ID: ${entity.inventory_id}`);
    if (owner.type !== entity.type) throw new Error(`Rich type mismatch for inventory ID ${entity.inventory_id}`);
    const factIds = new Set<string>();
    const facts = entity.facts.flatMap((fact) => {
      const identifier = `${entity.inventory_id}:${fact.temporary_id}`;
      if (factIds.has(fact.temporary_id)) throw new Error(`Duplicate fact ID: ${identifier}`);
      factIds.add(fact.temporary_id);
      if (!isFactFieldForEntityType(owner.type, fact.field_key)) throw new Error(`Invalid ${owner.type} fact field ${fact.field_key} for inventory ID ${entity.inventory_id}`);
      const sources = validSources(fact, pages, identifier, diagnostics);
      if (!sources.length) {
        diagnostics.push({ kind: "fact", identifier, reason: "no valid source evidence" });
        return [];
      }
      return [{ ...fact, sources }];
    });
    return { ...entity, facts };
  });
  for (const missing of inventory.entities.filter((entity) => !seen.has(entity.temporary_id))) diagnostics.push({ kind: "entity", identifier: missing.temporary_id, reason: "rich output omitted authoritative inventory entity; preserved without rich detail" });

  const relationships = raw.relationships.map((relationship) => {
    const identifier = `${relationship.source_temporary_id}->${relationship.target_temporary_id}:${relationship.relationship_type}`;
    if (!inventoryById.has(relationship.source_temporary_id) || !inventoryById.has(relationship.target_temporary_id)) throw new Error(`Unknown relationship endpoint: ${identifier}`);
    if (relationship.source_temporary_id === relationship.target_temporary_id) throw new Error(`Self-relationship is not supported: ${identifier}`);
    const sources = validSources(relationship, pages, identifier, diagnostics);
    if (!sources.length) {
      diagnostics.push({ kind: "relationship", identifier, reason: "no valid source evidence" });
      return null;
    }
    return { ...relationship, sources };
  }).filter((relationship): relationship is NonNullable<typeof relationship> => relationship !== null);

  const suspected_inventory_misses = raw.suspected_inventory_misses.flatMap((miss) => {
    const sources = validSources(miss, pages, miss.name, diagnostics);
    return sources.length ? [{ ...miss, sources }] : [];
  });
  return { rich: { entities, relationships, suspected_inventory_misses }, diagnostics };
}

export function assembleChunkExtraction(inventory: ValidatedExtractionInventoryOutput, rich: ExtractionRichOutput): ChunkExtraction {
  const richById = new Map(rich.entities.map((entity) => [entity.inventory_id, entity]));
  return {
    entities: inventory.entities.map((entity) => {
      const detail = richById.get(entity.temporary_id);
      return {
        temporary_id: entity.temporary_id,
        name: entity.name,
        type: entity.type,
        aliases: detail?.aliases ?? [],
        sources: entity.sources,
        roles: detail?.roles ?? [],
        summary: detail?.summary ?? entity.name,
        facts: detail?.facts ?? [],
      } as CandidateEntity;
    }),
    relationships: rich.relationships,
  };
}

export function validateChunkExtraction(raw: ChunkExtraction, pages: DocumentPage[]): ValidatedExtraction {
  const diagnostics: ValidationDiagnostic[] = [];
  const usedIds = new Set<string>();
  const entities: CandidateEntity[] = [];

  for (const entity of raw.entities) {
    if (usedIds.has(entity.temporary_id)) {
      diagnostics.push({ kind: "entity", identifier: entity.temporary_id, reason: "duplicate temporary ID" });
      continue;
    }
    usedIds.add(entity.temporary_id);
    const sources = validSources(entity, pages, entity.temporary_id, diagnostics);
    if (sources.length === 0) {
      diagnostics.push({ kind: "entity", identifier: entity.temporary_id, reason: "no valid source evidence" });
      continue;
    }
    const usedFactIds = new Set<string>();
    const facts = entity.facts.flatMap((fact) => {
      const factIdentifier = `${entity.temporary_id}:${fact.temporary_id}`;
      if (usedFactIds.has(fact.temporary_id)) {
        diagnostics.push({ kind: "fact", identifier: factIdentifier, reason: "duplicate fact temporary ID" });
        return [];
      }
      usedFactIds.add(fact.temporary_id);
      const factSources = validSources(fact, pages, factIdentifier, diagnostics);
      if (factSources.length === 0) {
        diagnostics.push({ kind: "fact", identifier: factIdentifier, reason: "no valid source evidence" });
        return [];
      }
      return [{ ...fact, sources: factSources }];
    });
    entities.push({ ...entity, sources, facts } as CandidateEntity);
  }

  const entityIds = new Set(entities.map((entity) => entity.temporary_id));
  const relationships: CandidateRelationship[] = [];
  for (const relationship of raw.relationships) {
    const identifier = `${relationship.source_temporary_id}->${relationship.target_temporary_id}:${relationship.relationship_type}`;
    if (!entityIds.has(relationship.source_temporary_id) || !entityIds.has(relationship.target_temporary_id)) {
      diagnostics.push({ kind: "relationship", identifier, reason: "endpoint does not resolve to a valid entity" });
      continue;
    }
    if (relationship.source_temporary_id === relationship.target_temporary_id) {
      diagnostics.push({ kind: "relationship", identifier, reason: "self-relationship is not supported" });
      continue;
    }
    const sources = validSources(relationship, pages, identifier, diagnostics);
    if (sources.length === 0) {
      diagnostics.push({ kind: "relationship", identifier, reason: "no valid source evidence" });
      continue;
    }
    relationships.push({ ...relationship, sources });
  }

  return { extraction: { entities, relationships }, diagnostics };
}
