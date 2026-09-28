import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { adjudicationSchema } from "./narrative-tournament-evaluation";
import { MAX_ACTUAL_TOKENS, MAX_DISPATCHES, MIN_CONSERVATIVE_INPUT_USD_PER_MILLION, MIN_CONSERVATIVE_OUTPUT_USD_PER_MILLION, MODEL_ID, MODEL_MAX_OUTPUT_TOKENS, narrativeOutputSchema, sha256 } from "./narrative-tournament";
import type { Operation } from "./narrative-tournament-runner";

export const TOURNAMENT_REASONING_EFFORT = "medium" as const;
export const TOURNAMENT_SERVICE_TIER = "default" as const;

export const tournamentAuthorizationSchema = z.object({
  approvalPhrase: z.enum(["I approve the paid narrative tournament","I approve the paid narrative acceptance test"]),
  scope: z.enum(["full_tournament","acceptance_only"]),
  planHash: z.string(),
  model: z.literal(MODEL_ID),
  reasoningEffort: z.literal(TOURNAMENT_REASONING_EFFORT),
  serviceTier: z.literal(TOURNAMENT_SERVICE_TIER),
  maxUsd: z.number().positive(),
  inputUsdPerMillion: z.number().positive(),
  outputUsdPerMillion: z.number().positive(),
  modelMaxOutputTokens: z.literal(MODEL_MAX_OUTPUT_TOKENS),
  maxRequests: z.literal(MAX_DISPATCHES),
  maxTotalTokens: z.literal(MAX_ACTUAL_TOKENS),
  userApprovalReference: z.string().min(1),
}).strict();

export function parseTournamentAuthorization(value: unknown, planHash: string, scope:"full_tournament"|"acceptance_only"="full_tournament") {
  const parsed = tournamentAuthorizationSchema.parse(value);
  if (parsed.planHash !== planHash) throw new Error("Approval does not bind to current plan hash");
  if(parsed.scope!==scope || parsed.approvalPhrase!==(scope==="acceptance_only"?"I approve the paid narrative acceptance test":"I approve the paid narrative tournament"))throw new Error("Authorization scope does not permit this phase");
  if (parsed.inputUsdPerMillion < MIN_CONSERVATIVE_INPUT_USD_PER_MILLION || parsed.outputUsdPerMillion < MIN_CONSERVATIVE_OUTPUT_USD_PER_MILLION) {
    throw new Error("Authorization rates below conservative verified GPT-6 Luna pricing");
  }
  return parsed;
}

export function tournamentTextFormat(kind: Operation["kind"]) {
  return kind === "extraction"
    ? zodTextFormat(narrativeOutputSchema, "narrative_extraction")
    : zodTextFormat(adjudicationSchema, "narrative_judge");
}

export function buildTournamentRequest(operation: Operation, outputAllowance: number) {
  if (!Number.isSafeInteger(outputAllowance) || outputAllowance < 1 || outputAllowance > MODEL_MAX_OUTPUT_TOKENS) {
    throw new Error("Output allowance exceeds verified model maximum");
  }
  const format = tournamentTextFormat(operation.kind);
  if (sha256(operation.schemaJson) !== operation.schemaHash) throw new Error("Operation schema hash mismatch");
  return {
    model: MODEL_ID,
    input: [{ role: "system" as const, content: operation.prompt }, { role: "user" as const, content: operation.payload }],
    text: { format },
    reasoning: { effort: TOURNAMENT_REASONING_EFFORT },
    service_tier: TOURNAMENT_SERVICE_TIER,
    max_output_tokens: outputAllowance,
  };
}
