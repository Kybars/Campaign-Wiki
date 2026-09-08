import { createHash } from "node:crypto";
import type { SourceEvidence } from "@/lib/ai/schemas";
import type { CandidateAggregate, FactAggregationDiagnostics } from "@/lib/graph/types";
import { chronologyKindForField, type FactFieldKey } from "@/lib/knowledge/fields";
import type { CanonicalFactDraft, KnowledgeValue } from "@/lib/knowledge/types";

export function normalizeFactContent(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}'+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:a|an)\s+/, "");
}

function stableFactKey(fieldKey: string, normalizedContent: string): string {
  const digest = createHash("sha256").update(`${fieldKey}\0${normalizedContent}`).digest("hex").slice(0, 24);
  return `${fieldKey}:${digest}`;
}

function evidenceKey(source: SourceEvidence): string {
  return `${source.page_number}:${source.supporting_text.trim()}`;
}

function structuredValue(fieldKey: FactFieldKey, content: string): KnowledgeValue | undefined {
  const chronologyKind = chronologyKindForField(fieldKey);
  return chronologyKind ? { chronologyKind, sourceText: content } : undefined;
}

export function aggregateCanonicalFacts(
  aggregate: CandidateAggregate,
  candidateToCanonical: Map<string, string>,
): { facts: CanonicalFactDraft[]; diagnostics: FactAggregationDiagnostics } {
  const factsByIdentity = new Map<string, CanonicalFactDraft>();
  const evidenceKeys = new Map<string, Set<string>>();
  let candidateFactCount = 0;

  for (const entity of aggregate.entities) {
    const entityKey = candidateToCanonical.get(entity.id);
    if (!entityKey) continue;
    for (const [factIndex, fact] of (entity.facts ?? []).entries()) {
      candidateFactCount += 1;
      const normalizedContent = normalizeFactContent(fact.content);
      if (!normalizedContent) continue;
      const identity = `${entityKey}\0${fact.field_key}\0${normalizedContent}`;
      const candidateFactId = `${entity.id}:${fact.temporary_id || `fact-${factIndex + 1}`}`;
      const existing = factsByIdentity.get(identity);
      if (existing) {
        const knownEvidence = evidenceKeys.get(identity)!;
        for (const source of fact.sources) {
          const key = evidenceKey(source);
          if (knownEvidence.has(key)) continue;
          knownEvidence.add(key);
          existing.evidence.push({
            origin: "document",
            pageNumber: source.page_number,
            supportingText: source.supporting_text,
          });
        }
        const context = existing.context as { candidateFactIds: KnowledgeValue[] };
        context.candidateFactIds.push(candidateFactId);
        continue;
      }

      const fieldKey = fact.field_key as FactFieldKey;
      const factDraft: CanonicalFactDraft = {
        entityKey,
        stableKey: stableFactKey(fieldKey, normalizedContent),
        fieldKey,
        content: fact.content.trim(),
        structuredValue: structuredValue(fieldKey, fact.content.trim()),
        visibility: "dm_only",
        origin: "document",
        sortOrder: factsByIdentity.size,
        context: { candidateFactIds: [candidateFactId] },
        evidence: fact.sources.map((source) => ({
          origin: "document" as const,
          pageNumber: source.page_number,
          supportingText: source.supporting_text,
        })),
      };
      factsByIdentity.set(identity, factDraft);
      evidenceKeys.set(identity, new Set(fact.sources.map(evidenceKey)));
    }
  }

  const facts = [...factsByIdentity.values()];
  return {
    facts,
    diagnostics: {
      candidateFactCount,
      canonicalFactCount: facts.length,
      deduplicatedFactCount: candidateFactCount - facts.length,
      factEvidenceCount: facts.reduce((count, fact) => count + fact.evidence.length, 0),
    },
  };
}
