import { RECONCILIATION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { reconciliationDecisionSchema, type ReconciliationDecision } from "@/lib/ai/schemas";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { buildCrossTypeReconciliationCandidates } from "@/lib/graph/reconcile";
import type { DeterministicGroup } from "@/lib/graph/types";
import { RECONCILIATION_BEHAVIOR_VERSION, RECONCILIATION_CONTRACT_VERSION, modelInputHash, semanticInputHash, type AIOperationCheckpointStore, type AIOperationIdentity } from "@/lib/ai/operation-checkpoint";

export interface ReconciliationResult {
  decision: ReconciliationDecision | undefined;
  usage: ModelCallUsage | undefined;
  checkpointStatus?: "REUSE" | "RUN";
}

export interface ReconciliationCheckpointContext { campaignId: string; documentId: string; sourceExtractionCacheId: string | null; store: AIOperationCheckpointStore }

export function validateReconciliationCoverage(decision: ReconciliationDecision, groups: DeterministicGroup[]) {
  const expected = groups.map((group) => group.id);
  const assigned = decision.canonical_entities.flatMap((entity) => entity.group_ids);
  const missing = expected.filter((id) => !assigned.includes(id));
  const duplicate = expected.filter((id) => assigned.filter((assignedId) => assignedId === id).length > 1);
  const unexpected = assigned.filter((id) => !expected.includes(id));
  if (missing.length || duplicate.length || unexpected.length) throw new Error(`Reconciliation group coverage failed (missing: ${missing.join(",") || "none"}; duplicate: ${duplicate.join(",") || "none"}; unexpected: ${[...new Set(unexpected)].join(",") || "none"})`);
}

export async function reconcileGroupsWithAI(groups: DeterministicGroup[], provider?: StructuredModelProvider, checkpoint?: ReconciliationCheckpointContext): Promise<ReconciliationResult> {
  if (groups.length <= 1) return { decision: undefined, usage: undefined };

  const crossTypeCandidates = buildCrossTypeReconciliationCandidates(groups);
  const payload = groups.map((group) => ({
    group_id: group.id,
    type: group.type,
    cross_type_candidate_group_ids: [...new Set(crossTypeCandidates
      .filter((candidate) => candidate.groupIds.includes(group.id))
      .flatMap((candidate) => candidate.groupIds.filter((groupId) => groupId !== group.id)))],
    references: group.candidates.map((candidate) => ({
      candidate_id: candidate.id,
      name: candidate.name,
      candidate_type: candidate.type,
      roles: candidate.roles,
      aliases: candidate.aliases,
      summary: candidate.summary,
      evidence: candidate.sources.slice(0, 3),
    })),
  }));
  const resolvedProvider = provider ?? (await import("@/lib/ai/structured-model-provider-runtime")).getStructuredModelProvider("reconciliation");
  const modelPayload = `Reconcile every candidate group in this JSON data:\n${JSON.stringify(payload)}`;
  const identity: AIOperationIdentity | undefined = checkpoint ? {
    campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: checkpoint.sourceExtractionCacheId,
    providerId: resolvedProvider.providerId, modelId: resolvedProvider.modelId, processingMode: "core", stage: "reconciliation",
    operationType: "global", operationKey: "global", inputHash: modelInputHash(RECONCILIATION_SYSTEM_PROMPT, modelPayload),
    upstreamFingerprint: semanticInputHash(payload), behaviorVersion: RECONCILIATION_BEHAVIOR_VERSION, schemaVersion: RECONCILIATION_CONTRACT_VERSION,
  } : undefined;
  if (identity) {
    const cached = await checkpoint!.store.load<ReconciliationDecision>(identity);
    if (cached) {
      try {
        const decision = reconciliationDecisionSchema.parse(cached.output);
        validateReconciliationCoverage(decision, groups);
        return { decision, usage: undefined, checkpointStatus: "REUSE" };
      } catch (error) {
        await checkpoint!.store.saveFailed(identity, cached.usage, `Stored reconciliation checkpoint invalid: ${error instanceof Error ? error.message : "unknown validation failure"}`, cached.attemptCount);
      }
    }
  }
  const response = await resolvedProvider.parseStructured({ system: RECONCILIATION_SYSTEM_PROMPT, payload: modelPayload, schema: reconciliationDecisionSchema, schemaName: "campaign_entity_reconciliation" }).catch(async (error) => {
    if (identity) await checkpoint!.store.saveFailed(identity, [], error instanceof Error ? error.message : "Reconciliation provider failure", 1);
    throw error;
  });
  try { validateReconciliationCoverage(response.output, groups); }
  catch (error) {
    if (identity) await checkpoint!.store.saveFailed(identity, [response.usage], error instanceof Error ? error.message : "Invalid reconciliation output", 1);
    throw error;
  }
  if (identity) await checkpoint!.store.saveValidated({ identity, output: response.output, usage: [response.usage], attemptCount: 1 });
  return {
    decision: response.output,
    usage: response.usage,
    checkpointStatus: "RUN",
  };
}
