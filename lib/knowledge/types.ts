export type KnowledgeValue = string | number | boolean | null | { [key: string]: KnowledgeValue | undefined } | KnowledgeValue[];

export const KNOWLEDGE_VISIBILITIES = ["dm_only", "player_visible"] as const;
export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];

export const ENTITY_PROMINENCES = ["major", "supporting", "minor"] as const;
export type EntityProminence = (typeof ENTITY_PROMINENCES)[number];

export const PROVENANCE_ORIGINS = ["document", "manual", "session"] as const;
export type ProvenanceOrigin = (typeof PROVENANCE_ORIGINS)[number];

export const KNOWLEDGE_SUMMARY_KINDS = ["gm", "player"] as const;
export type KnowledgeSummaryKind = (typeof KNOWLEDGE_SUMMARY_KINDS)[number];

export interface DocumentFactEvidence {
  id?: string;
  origin: "document";
  documentId: string;
  pageNumber: number;
  supportingText: string;
  sourceLocation?: KnowledgeValue;
  originMetadata?: KnowledgeValue;
}

export interface NonDocumentFactEvidence {
  id?: string;
  origin: Exclude<ProvenanceOrigin, "document">;
  supportingText?: string;
  sourceLocation?: KnowledgeValue;
  originMetadata?: KnowledgeValue;
}

export type FactEvidence = DocumentFactEvidence | NonDocumentFactEvidence;

export interface EntityFact {
  id: string;
  entityId: string;
  stableKey: string;
  fieldKey: string;
  content: string;
  structuredValue: KnowledgeValue | null;
  visibility: KnowledgeVisibility;
  origin: ProvenanceOrigin;
  sortOrder: number;
  context: KnowledgeValue;
  evidence: FactEvidence[];
}

export interface CanonicalFactDraft {
  entityKey: string;
  stableKey: string;
  fieldKey: string;
  content: string;
  structuredValue?: KnowledgeValue;
  visibility?: KnowledgeVisibility;
  origin?: ProvenanceOrigin;
  sortOrder?: number;
  context?: KnowledgeValue;
  evidence: Array<{
    origin?: ProvenanceOrigin;
    pageNumber?: number;
    supportingText?: string;
    sourceLocation?: KnowledgeValue;
    originMetadata?: KnowledgeValue;
  }>;
}

export function isKnowledgeVisibility(value: unknown): value is KnowledgeVisibility {
  return KNOWLEDGE_VISIBILITIES.includes(value as KnowledgeVisibility);
}

export function isEntityProminence(value: unknown): value is EntityProminence {
  return ENTITY_PROMINENCES.includes(value as EntityProminence);
}
