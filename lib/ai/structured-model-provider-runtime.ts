import "server-only";

import { getOpenAIClient } from "@/lib/ai/client";
import { createLocalStructuredModelProvider, createOpenAIStructuredModelProvider, preflightLocalStructuredModelProvider, type StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { getAIProviderConfig, type AIStage } from "@/lib/env";

export function getStructuredModelProvider(stage: AIStage): StructuredModelProvider {
  const config = getAIProviderConfig(stage);
  return config.providerId === "openai" ? createOpenAIStructuredModelProvider(config.modelId, getOpenAIClient()) : createLocalStructuredModelProvider(config);
}

export async function preflightStructuredModelProvider(stage: AIStage) {
  const config = getAIProviderConfig(stage);
  if (config.providerId === "openai") return { providerId: config.providerId, modelId: config.modelId, reachable: "configuration-valid", paidOpenAICalls: 0 };
  return preflightLocalStructuredModelProvider(config);
}
