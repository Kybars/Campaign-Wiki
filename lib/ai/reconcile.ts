import { RECONCILIATION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { reconciliationDecisionSchema, type ReconciliationDecision } from "@/lib/ai/schemas";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { buildCrossTypeReconciliationCandidates } from "@/lib/graph/reconcile";
import type { DeterministicGroup } from "@/lib/graph/types";

export interface ReconciliationResult {
  decision: ReconciliationDecision | undefined;
  usage: ModelCallUsage | undefined;
}

export function validateReconciliationCoverage(decision: ReconciliationDecision, groups: DeterministicGroup[]) {
  const expected = groups.map((group) => group.id);
  const assigned = decision.canonical_entities.flatMap((entity) => entity.group_ids);
  const missing = expected.filter((id) => !assigned.includes(id));
  const duplicate = expected.filter((id) => assigned.filter((assignedId) => assignedId === id).length > 1);
  const unexpected = assigned.filter((id) => !expected.includes(id));
  if (missing.length || duplicate.length || unexpected.length) throw new Error(`Reconciliation group coverage failed (missing: ${missing.join(",") || "none"}; duplicate: ${duplicate.join(",") || "none"}; unexpected: ${[...new Set(unexpected)].join(",") || "none"})`);
}

export async function reconcileGroupsWithAI(groups: DeterministicGroup[], provider?: StructuredModelProvider): Promise<ReconciliationResult> {
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
  const response = await resolvedProvider.parseStructured({ system: RECONCILIATION_SYSTEM_PROMPT, payload: `Reconcile every candidate group in this JSON data:\n${JSON.stringify(payload)}`, schema: reconciliationDecisionSchema, schemaName: "campaign_entity_reconciliation" });
  validateReconciliationCoverage(response.output, groups);
  return {
    decision: response.output,
    usage: response.usage,
  };
}
