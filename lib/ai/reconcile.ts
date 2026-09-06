import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/ai/client";
import { RECONCILIATION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { reconciliationDecisionSchema, type ReconciliationDecision } from "@/lib/ai/schemas";
import { getOpenAIEnv } from "@/lib/env";
import { modelCallUsage, type ModelCallUsage } from "@/lib/ai/usage";
import type { DeterministicGroup } from "@/lib/graph/types";

export interface ReconciliationResult {
  decision: ReconciliationDecision | undefined;
  usage: ModelCallUsage | undefined;
}

export async function reconcileGroupsWithAI(groups: DeterministicGroup[]): Promise<ReconciliationResult> {
  if (groups.length <= 1) return { decision: undefined, usage: undefined };

  const payload = groups.map((group) => ({
    group_id: group.id,
    type: group.type,
    references: group.candidates.map((candidate) => ({
      name: candidate.name,
      aliases: candidate.aliases,
      summary: candidate.summary,
      evidence: candidate.sources.slice(0, 3),
    })),
  }));
  const response = await getOpenAIClient().responses.parse({
    model: getOpenAIEnv().OPENAI_RECONCILIATION_MODEL,
    input: [
      { role: "system", content: RECONCILIATION_SYSTEM_PROMPT },
      { role: "user", content: `Reconcile every candidate group in this JSON data:\n${JSON.stringify(payload)}` },
    ],
    text: { format: zodTextFormat(reconciliationDecisionSchema, "campaign_entity_reconciliation") },
  });
  if (!response.output_parsed) throw new Error("Model returned no parsed reconciliation result");
  return {
    decision: response.output_parsed,
    usage: modelCallUsage(response.model, response.id, response.usage),
  };
}
