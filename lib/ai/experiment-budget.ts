/** Token reservations for isolated paid experiments. Estimates are not billing guarantees. */
export interface ExperimentBudgetConfig {
  totalTokenBudget: number;
  inputReserveMultiplier: number;
  sdkMaxRetries: number;
  stageBudgets?: Record<string, number>;
  requests: Record<string, { maxOutputTokens: number; stage?: string }>;
}

export interface BudgetReservation {
  requestId: string;
  estimatedInputTokens: number;
  reservedInputTokens: number;
  maxOutputTokens: number;
  attemptsReserved: number;
  reservedTokens: number;
  actualUsedTokens: number;
  remainingBeforeDispatch: number;
  stageRemainingBeforeDispatch: number | null;
  fits: boolean;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value as number;
}

export function parseExperimentBudgetConfig(value: unknown, requestIds: string[]): ExperimentBudgetConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Explicit experiment budget configuration is required");
  const raw = value as Record<string, unknown>;
  const totalTokenBudget = positiveInteger(raw.totalTokenBudget, "totalTokenBudget");
  const inputReserveMultiplier = Number(raw.inputReserveMultiplier);
  if (!Number.isFinite(inputReserveMultiplier) || inputReserveMultiplier < 1) throw new Error("inputReserveMultiplier must be at least 1");
  const sdkMaxRetries = Number(raw.sdkMaxRetries);
  if (!Number.isSafeInteger(sdkMaxRetries) || sdkMaxRetries < 0 || sdkMaxRetries > 5) throw new Error("sdkMaxRetries must be an integer from 0 to 5");
  const stageBudgets = raw.stageBudgets === undefined ? undefined : raw.stageBudgets;
  if (stageBudgets !== undefined && (!stageBudgets || typeof stageBudgets !== "object" || Array.isArray(stageBudgets))) throw new Error("stageBudgets must be an object");
  const validatedStages = stageBudgets === undefined ? undefined : Object.fromEntries(Object.entries(stageBudgets as Record<string, unknown>).map(([stage, budget]) => [stage, positiveInteger(budget, `stageBudgets.${stage}`)]));
  const requestConfig = raw.requests;
  if (!requestConfig || typeof requestConfig !== "object" || Array.isArray(requestConfig)) throw new Error("Per-request output limits are required");
  const entries = requestConfig as Record<string, unknown>;
  if (Object.keys(entries).length !== requestIds.length || requestIds.some((id) => !(id in entries))) throw new Error("Budget configuration must cover exactly the planned requests");
  const requests = Object.fromEntries(requestIds.map((id) => {
    const item = entries[id];
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Missing output limit for ${id}`);
    const fields = item as Record<string, unknown>;
    const stage = fields.stage;
    if (stage !== undefined && (typeof stage !== "string" || !validatedStages || !(stage in validatedStages))) throw new Error(`Unknown stage budget for ${id}`);
    return [id, { maxOutputTokens: positiveInteger(fields.maxOutputTokens, `${id}.maxOutputTokens`), ...(stage === undefined ? {} : { stage }) }];
  }));
  return { totalTokenBudget, inputReserveMultiplier, sdkMaxRetries, ...(validatedStages === undefined ? {} : { stageBudgets: validatedStages }), requests };
}

export function reserveExperimentRequest(config: ExperimentBudgetConfig, requestId: string, estimatedInputTokens: number, actualUsedTokens: number, stageUsedTokens = 0): BudgetReservation {
  if (!Number.isSafeInteger(estimatedInputTokens) || estimatedInputTokens < 0) throw new Error("Invalid input estimate");
  if (!Number.isSafeInteger(actualUsedTokens) || actualUsedTokens < 0) throw new Error("Actual usage must be known and nonnegative");
  const limit = config.requests[requestId];
  if (!limit) throw new Error(`No output limit for ${requestId}`);
  const reservedInputTokens = Math.ceil(estimatedInputTokens * config.inputReserveMultiplier);
  const attemptsReserved = config.sdkMaxRetries + 1;
  const reservedTokens = (reservedInputTokens + limit.maxOutputTokens) * attemptsReserved;
  const remainingBeforeDispatch = config.totalTokenBudget - actualUsedTokens;
  const stageRemainingBeforeDispatch = limit.stage ? (config.stageBudgets?.[limit.stage] ?? 0) - stageUsedTokens : null;
  return { requestId, estimatedInputTokens, reservedInputTokens, maxOutputTokens: limit.maxOutputTokens, attemptsReserved,
    reservedTokens, actualUsedTokens, remainingBeforeDispatch, stageRemainingBeforeDispatch,
    fits: reservedTokens <= remainingBeforeDispatch && (stageRemainingBeforeDispatch === null || reservedTokens <= stageRemainingBeforeDispatch) };
}

export function assertKnownUsage(usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }): number {
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens) || !Number.isSafeInteger(usage.totalTokens) ||
      usage.inputTokens! < 0 || usage.outputTokens! < 0 || usage.totalTokens! < usage.inputTokens! + usage.outputTokens!) throw new Error("Actual token usage is unavailable or inconsistent; budget-controlled run must stop");
  return usage.totalTokens!;
}

export function pendingExperimentRequests(requestIds: string[], attempts: Array<{ requestId: string; state: "dispatching" | "completed" | "failed" }>) {
  const planned = new Set(requestIds);
  const seen = new Set<string>();
  for (const attempt of attempts) {
    if (!planned.has(attempt.requestId) || seen.has(attempt.requestId)) throw new Error("Unknown or duplicate experiment attempt");
    seen.add(attempt.requestId);
    if (attempt.state !== "completed") throw new Error("Prior dispatch is incomplete or failed; no automatic rerun is allowed");
  }
  return requestIds.filter((id) => !seen.has(id));
}
