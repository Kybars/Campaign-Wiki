import type { CandidateEntity, CandidateRelationship, SourceEvidence } from "@/lib/ai/schemas";
import type { EntityRole, EntityType } from "@/lib/db/types";

export interface ChunkCandidateResult {
  chunkId: string;
  entities: CandidateEntity[];
  relationships: CandidateRelationship[];
}

export interface GlobalCandidateEntity extends Omit<CandidateEntity, "temporary_id"> {
  id: string;
  chunkId: string;
  temporaryId: string;
}

export interface GlobalCandidateRelationship extends Omit<CandidateRelationship, "source_temporary_id" | "target_temporary_id"> {
  id: string;
  chunkId: string;
  sourceCandidateId: string;
  targetCandidateId: string;
}

export interface CandidateAggregate {
  entities: GlobalCandidateEntity[];
  relationships: GlobalCandidateRelationship[];
}

export interface DeterministicGroup {
  id: string;
  type: EntityType;
  candidates: GlobalCandidateEntity[];
}

export interface CrossTypeReconciliationCandidate {
  normalizedIdentity: string;
  groupIds: string[];
}

export interface CanonicalEntity {
  key: string;
  name: string;
  normalizedName: string;
  type: EntityType;
  roles: EntityRole[];
  roleSources: Partial<Record<EntityRole, SourceEvidence[]>>;
  aliases: string[];
  summary: string;
  sources: SourceEvidence[];
  candidateIds: string[];
  reconciliationEvidence: SourceEvidence[];
  mergeReason: "deterministic" | "ai";
}

export interface CanonicalRelationship {
  key: string;
  sourceEntityKey: string;
  targetEntityKey: string;
  relationshipType: string;
  description: string;
  confidence: number;
  sources: SourceEvidence[];
  candidateRelationshipIds: string[];
}

export interface CanonicalGraph {
  entities: CanonicalEntity[];
  relationships: CanonicalRelationship[];
  discardedRelationships: Array<{ id: string; reason: string }>;
  candidateToCanonical: Map<string, string>;
}
