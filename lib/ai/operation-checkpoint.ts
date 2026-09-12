import { createHash } from "node:crypto";
import type { ModelCallUsage } from "@/lib/ai/usage";

export const EXTRACTION_BEHAVIOR_VERSION = "v0.4-m4-extraction-1";
export const RECONCILIATION_BEHAVIOR_VERSION = "v0.4-m4-reconciliation-1";
export const ENRICHMENT_BEHAVIOR_VERSION = "v0.4-m4-enrichment-1";
export const EXTRACTION_CONTRACT_VERSION = 1;
export const RECONCILIATION_CONTRACT_VERSION = 1;
export const ENRICHMENT_CONTRACT_VERSION = 1;

export type AIOperationStage = "extraction" | "reconciliation" | "enrichment";
export type CheckpointPlanStatus = "REUSE" | "RUN" | "INVALIDATED";

export interface AIOperationIdentity {
  campaignId: string;
  documentId: string;
  sourceExtractionCacheId: string | null;
  providerId: string;
  modelId: string;
  processingMode: string;
  stage: AIOperationStage;
  operationType: string;
  operationKey: string;
  inputHash: string;
  upstreamFingerprint: string;
  behaviorVersion: string;
  schemaVersion: number;
}

export interface ValidatedCheckpoint<T = unknown> {
  identity: AIOperationIdentity;
  output: T;
  usage: ModelCallUsage[];
  attemptCount: number;
}

export interface AIOperationCheckpointStore {
  load<T>(identity: AIOperationIdentity): Promise<ValidatedCheckpoint<T> | null>;
  saveValidated<T>(checkpoint: ValidatedCheckpoint<T>): Promise<void>;
  saveFailed(identity: AIOperationIdentity, usage: ModelCallUsage[], error: string, attemptCount: number): Promise<void>;
  inspect?(identity: AIOperationIdentity): Promise<{ status: CheckpointPlanStatus; reason: string }>;
}

export async function planAIOperations(store: AIOperationCheckpointStore, operations: Array<{ identity: AIOperationIdentity; operationType: string; operationKey: string }>) {
  return Promise.all(operations.map(async (operation) => ({
    operationType: operation.operationType,
    operationKey: operation.operationKey,
    ...(store.inspect ? await store.inspect(operation.identity) : (await store.load(operation.identity) ? { status: "REUSE" as const, reason: "exact validated identity" } : { status: "RUN" as const, reason: "no compatible validated checkpoint" })),
  })));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function semanticInputHash(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

export function modelInputHash(system: string, payload: unknown): string {
  return semanticInputHash({ system, payload });
}

export function memoryCheckpointStore(): AIOperationCheckpointStore & { validated: Map<string, ValidatedCheckpoint>; failures: unknown[] } {
  const validated = new Map<string, ValidatedCheckpoint>();
  const failures: unknown[] = [];
  const key = (identity: AIOperationIdentity) => {
    const semanticIdentity: Partial<AIOperationIdentity> = { ...identity };
    delete semanticIdentity.sourceExtractionCacheId;
    return stableSerialize(semanticIdentity);
  };
  return {
    validated,
    failures,
    async load<T>(identity: AIOperationIdentity) { return (validated.get(key(identity)) as ValidatedCheckpoint<T> | undefined) ?? null; },
    async saveValidated<T>(checkpoint: ValidatedCheckpoint<T>) { validated.set(key(checkpoint.identity), checkpoint as ValidatedCheckpoint); },
    async saveFailed(identity, usage, error, attemptCount) { failures.push({ identity, usage, error, attemptCount }); },
    async inspect(identity) {
      if (validated.has(key(identity))) return { status: "REUSE", reason: "exact validated identity" };
      const prior = [...validated.values()].some(({ identity: item }) => item.campaignId === identity.campaignId && item.documentId === identity.documentId && item.stage === identity.stage && item.operationType === identity.operationType && item.operationKey === identity.operationKey);
      return prior ? { status: "INVALIDATED", reason: "compatibility identity changed" } : { status: "RUN", reason: "no prior validated checkpoint" };
    },
  };
}
