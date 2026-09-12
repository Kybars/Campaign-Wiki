import type { StructuredModelProvider, StructuredModelRequest, StructuredModelResult } from "@/lib/ai/structured-model-provider";

export class OpenAICallBudgetExceededError extends Error {
  constructor(readonly maximumAttempts: number, readonly attempted: number) {
    super(`OpenAI application call budget exceeded (maximum ${maximumAttempts}, attempted ${attempted})`);
    this.name = "OpenAICallBudgetExceededError";
  }
}

export class OpenAICallBudget {
  private attempts = 0;

  constructor(readonly maximumAttempts: number) {}

  get usedAttempts() { return this.attempts; }
  get remainingAttempts() { return Math.max(0, this.maximumAttempts - this.attempts); }

  allowPlanned(attempts: number) {
    return this.attempts + attempts <= this.maximumAttempts;
  }

  reserveAttempt() {
    const attempted = this.attempts + 1;
    if (attempted > this.maximumAttempts) throw new OpenAICallBudgetExceededError(this.maximumAttempts, attempted);
    this.attempts = attempted;
  }
}

export function withOpenAICallBudget(provider: StructuredModelProvider, budget: OpenAICallBudget): StructuredModelProvider {
  if (provider.providerId !== "openai") return provider;
  return {
    ...provider,
    async parseStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
      budget.reserveAttempt();
      return provider.parseStructured(request);
    },
  };
}

export interface PaidCallPlanItem { status: "REUSE" | "RUN" | "INVALIDATED" }

export function summarizePaidCallPlan(providerId: "openai" | "local", plan: PaidCallPlanItem[], retryCeiling: number, maximumAttempts: number) {
  const reusedOperations = plan.filter((item) => item.status === "REUSE").length;
  const invalidatedOperations = plan.filter((item) => item.status === "INVALIDATED").length;
  const newOperations = plan.length - reusedOperations;
  const plannedOpenAICalls = providerId === "openai" ? newOperations : 0;
  const plannedLocalCalls = providerId === "local" ? newOperations : 0;
  const maximumApplicationOpenAIAttempts = plannedOpenAICalls + (providerId === "openai" ? retryCeiling : 0);
  return {
    reusedOperations,
    invalidatedOperations,
    newOperations,
    plannedOpenAICalls,
    plannedLocalCalls,
    retryCeiling: providerId === "openai" ? retryCeiling : 0,
    maximumApplicationOpenAIAttempts,
    maximumAllowedOpenAIAttempts: maximumAttempts,
    guardResult: maximumApplicationOpenAIAttempts <= maximumAttempts ? "ALLOW" as const : "BLOCK" as const,
    providerInternalRetries: "not observable; counts are application-level attempts only" as const,
  };
}
