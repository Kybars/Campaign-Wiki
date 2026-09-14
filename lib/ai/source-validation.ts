import type { CandidateEntity, CandidateRelationship, ChunkExtraction, ExtractionInventoryEntity, ExtractionInventoryOutput, ExtractionRichOutput, SourceEvidence } from "@/lib/ai/schemas";
import type { DocumentPage } from "@/lib/pdf/types";
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
  inventory: ExtractionInventoryOutput;
  diagnostics: ValidationDiagnostic[];
}

export interface ValidatedRichExtraction {
  rich: ExtractionRichOutput;
  diagnostics: ValidationDiagnostic[];
}

export function validateExtractionInventory(raw: ExtractionInventoryOutput, pages: DocumentPage[]): ValidatedInventory {
  const diagnostics: ValidationDiagnostic[] = [];
  const ids = new Set<string>();
  const entities: ExtractionInventoryEntity[] = [];
  for (const entity of raw.entities) {
    if (ids.has(entity.temporary_id)) throw new Error(`Duplicate inventory ID: ${entity.temporary_id}`);
    ids.add(entity.temporary_id);
    const sources = validSources(entity, pages, entity.temporary_id, diagnostics);
    if (!sources.length) {
      diagnostics.push({ kind: "entity", identifier: entity.temporary_id, reason: "no valid source evidence" });
      continue;
    }
    entities.push({ ...entity, sources });
  }
  return { inventory: { entities }, diagnostics };
}

export function validateExtractionRich(raw: ExtractionRichOutput, inventory: ExtractionInventoryOutput, pages: DocumentPage[]): ValidatedRichExtraction {
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
  const missing = inventory.entities.filter((entity) => !seen.has(entity.temporary_id)).map((entity) => entity.temporary_id);
  if (missing.length) throw new Error(`Rich output omitted inventory IDs: ${missing.join(", ")}`);

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

export function assembleChunkExtraction(inventory: ExtractionInventoryOutput, rich: ExtractionRichOutput): ChunkExtraction {
  const richById = new Map(rich.entities.map((entity) => [entity.inventory_id, entity]));
  return {
    entities: inventory.entities.map((entity) => {
      const detail = richById.get(entity.temporary_id);
      if (!detail) throw new Error(`Cannot assemble missing rich inventory ID: ${entity.temporary_id}`);
      return {
        temporary_id: entity.temporary_id,
        name: entity.name,
        type: entity.type,
        aliases: entity.aliases,
        sources: entity.sources,
        roles: detail.roles,
        summary: detail.summary,
        facts: detail.facts,
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
