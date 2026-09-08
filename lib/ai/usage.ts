import type { ResponseUsage } from "openai/resources/responses/responses";

export interface ModelCallUsage {
  model: string;
  responseId: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
}

interface TextTokenPrices {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

// Standard-tier USD per one million text tokens. Keep this deliberately small:
// an unknown/configured model still records exact usage, but never a guessed cost.
const MODEL_PRICES: Record<string, TextTokenPrices> = {
  "gpt-6-astra": { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
};

function pricesForModel(model: string): TextTokenPrices | undefined {
  const direct = MODEL_PRICES[model];
  if (direct) return direct;
  return Object.entries(MODEL_PRICES).find(([alias]) => model.startsWith(`${alias}-20`))?.[1];
}

export function estimateModelCostUsd(model: string, usage: ResponseUsage): number | null {
  const prices = pricesForModel(model);
  if (!prices) return null;
  const cached = usage.input_tokens_details.cached_tokens ?? 0;
  const cacheWrite = usage.input_tokens_details.cache_write_tokens ?? 0;
  const uncached = Math.max(0, usage.input_tokens - cached - cacheWrite);
  const longContextInputMultiplier = usage.input_tokens > 272_000 ? 2 : 1;
  const longContextOutputMultiplier = usage.input_tokens > 272_000 ? 1.5 : 1;
  return (
    (uncached * prices.input * longContextInputMultiplier
      + cached * prices.cachedInput * longContextInputMultiplier
      + cacheWrite * prices.cacheWrite * longContextInputMultiplier
      + usage.output_tokens * prices.output * longContextOutputMultiplier)
    / 1_000_000
  );
}

export function modelCallUsage(model: string, responseId: string | undefined, usage: ResponseUsage | undefined): ModelCallUsage {
  return {
    model,
    responseId: responseId ?? null,
    inputTokens: usage?.input_tokens ?? null,
    cachedInputTokens: usage?.input_tokens_details.cached_tokens ?? null,
    cacheWriteTokens: usage?.input_tokens_details.cache_write_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
    estimatedCostUsd: usage ? estimateModelCostUsd(model, usage) : null,
  };
}

export interface StageUsageSummary {
  stage: "candidate_extraction" | "reconciliation" | "enrichment";
  models: string[];
  apiCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export function summarizeModelUsage(stage: StageUsageSummary["stage"], calls: ModelCallUsage[]): StageUsageSummary {
  const knownCosts = calls.map((call) => call.estimatedCostUsd);
  return {
    stage,
    models: [...new Set(calls.map((call) => call.model))],
    apiCalls: calls.length,
    inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
    cachedInputTokens: calls.reduce((sum, call) => sum + (call.cachedInputTokens ?? 0), 0),
    cacheWriteTokens: calls.reduce((sum, call) => sum + (call.cacheWriteTokens ?? 0), 0),
    outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
    totalTokens: calls.reduce((sum, call) => sum + (call.totalTokens ?? 0), 0),
    estimatedCostUsd: knownCosts.some((cost) => cost === null)
      ? null
      : knownCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
  };
}
