import { zodTextFormat } from "openai/helpers/zod";
import type OpenAI from "openai";
import type { z } from "zod";
import { modelCallUsage, type ModelCallUsage } from "@/lib/ai/usage";
import type { ResolvedAIProviderConfig } from "@/lib/env";

export interface StructuredModelRequest<T> {
  system: string;
  payload: unknown;
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface StructuredModelResult<T> {
  output: T;
  providerId: "openai" | "local";
  modelId: string;
  responseId: string | null;
  usage: ModelCallUsage;
}

export interface StructuredModelProvider {
  providerId: "openai" | "local";
  modelId: string;
  parseStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>>;
}

type OpenAIResponses = Pick<OpenAI, "responses">;

export function createOpenAIStructuredModelProvider(modelId: string, client: OpenAIResponses): StructuredModelProvider {
  return {
    providerId: "openai",
    modelId,
    async parseStructured<T>({ system, payload, schema, schemaName }: StructuredModelRequest<T>) {
      const response = await client.responses.parse({ model: modelId, input: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }], text: { format: zodTextFormat(schema, schemaName) } });
      if (!response.output_parsed) throw new Error(`OpenAI returned no parsed ${schemaName} result`);
      const usage = modelCallUsage(response.model, response.id, response.usage);
      return { output: response.output_parsed as T, providerId: "openai" as const, modelId: response.model, responseId: response.id ?? null, usage };
    },
  };
}

interface LocalChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function createLocalStructuredModelProvider(config: Extract<ResolvedAIProviderConfig, { providerId: "local" }>, fetchImpl: typeof fetch = fetch): StructuredModelProvider {
  return {
    providerId: "local",
    modelId: config.modelId,
    async parseStructured<T>({ system, payload, schema, schemaName }: StructuredModelRequest<T>) {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify({ model: config.modelId, messages: [{ role: "system", content: `${system}\nReturn only valid JSON matching the requested ${schemaName} structure.` }, { role: "user", content: JSON.stringify(payload) }], response_format: { type: "json_object" }, temperature: 0 }) });
      if (!response.ok) throw new Error(`Local AI request failed (${response.status} ${response.statusText})`);
      const body = await response.json() as LocalChatResponse;
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error(`Local AI returned no ${schemaName} content`);
      let json: unknown;
      try { json = JSON.parse(content); } catch { throw new Error(`Local AI returned malformed JSON for ${schemaName}`); }
      const output = schema.parse(json);
      const model = body.model ?? config.modelId;
      const usage: ModelCallUsage = { model, responseId: body.id ?? null, inputTokens: body.usage?.prompt_tokens ?? null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: body.usage?.completion_tokens ?? null, totalTokens: body.usage?.total_tokens ?? null, estimatedCostUsd: null };
      return { output, providerId: "local" as const, modelId: model, responseId: body.id ?? null, usage };
    },
  };
}

export async function preflightLocalStructuredModelProvider(config: Extract<ResolvedAIProviderConfig, { providerId: "local" }>, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${config.baseUrl}/models`, { headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined });
  if (!response.ok) throw new Error(`Local AI preflight failed (${response.status} ${response.statusText})`);
  const body = await response.json() as { data?: Array<{ id?: string }> };
  const models = body.data?.flatMap((model) => model.id ? [model.id] : []) ?? [];
  if (models.length && !models.includes(config.modelId)) throw new Error(`Local AI model ${config.modelId} is not available at the configured endpoint`);
  return { providerId: config.providerId, modelId: config.modelId, baseUrl: config.baseUrl, reachable: true, modelAvailability: models.length ? "confirmed" : "not-reported", paidOpenAICalls: 0 };
}
