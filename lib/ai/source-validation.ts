import type { CandidateEntity, CandidateRelationship, ChunkExtraction, SourceEvidence } from "@/lib/ai/schemas";
import type { DocumentPage } from "@/lib/pdf/types";

export interface ValidationDiagnostic {
  kind: "source" | "entity" | "relationship";
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

function validSources<T extends CandidateEntity | CandidateRelationship>(
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
    entities.push({ ...entity, sources });
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
