import { zodTextFormat } from "openai/helpers/zod";
import type OpenAI from "openai";
import { z } from "zod";
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

function userContent(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

type OpenAIResponses = Pick<OpenAI, "responses">;

export function createOpenAIStructuredModelProvider(modelId: string, client: OpenAIResponses): StructuredModelProvider {
  return {
    providerId: "openai",
    modelId,
    async parseStructured<T>({ system, payload, schema, schemaName }: StructuredModelRequest<T>) {
      const response = await client.responses.parse({ model: modelId, input: [{ role: "system", content: system }, { role: "user", content: userContent(payload) }], text: { format: zodTextFormat(schema, schemaName) } });
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

export type LocalStructuredFailureClass = "transport failure" | "HTTP 4xx" | "HTTP 5xx" | "malformed JSON" | "schema-invalid JSON";

export type LocalTransportFailureCode =
  | "UND_ERR_HEADERS_TIMEOUT"
  | "UND_ERR_BODY_TIMEOUT"
  | "ECONNRESET"
  | "ECONNREFUSED"
  | "AbortError"
  | "other transport failure";

export interface LocalTransportDiagnostics {
  errorName: string | null;
  errorMessage: string | null;
  causeName: string | null;
  causeMessage: string | null;
  causeCode: string | null;
  classification: LocalTransportFailureCode;
  nodeVersion: string;
  undiciVersion: string | null;
  elapsedMs: number;
}

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };

function errorLike(value: unknown): ErrorLike | null {
  return value !== null && typeof value === "object" ? value as ErrorLike : null;
}

function errorText(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

export function classifyLocalTransportError(error: unknown): LocalTransportFailureCode {
  const outer = errorLike(error);
  const nested = errorLike(outer?.cause);
  const values = [outer, nested].flatMap((candidate) => [errorText(candidate?.name), errorText(candidate?.message), errorText(candidate?.code)]).filter((value): value is string => value !== null);
  if (values.includes("UND_ERR_HEADERS_TIMEOUT")) return "UND_ERR_HEADERS_TIMEOUT";
  if (values.includes("UND_ERR_BODY_TIMEOUT")) return "UND_ERR_BODY_TIMEOUT";
  if (values.includes("ECONNRESET")) return "ECONNRESET";
  if (values.includes("ECONNREFUSED")) return "ECONNREFUSED";
  if (values.includes("AbortError") || values.some((value) => /aborted/i.test(value))) return "AbortError";
  return "other transport failure";
}

export function localTransportDiagnostics(error: unknown, elapsedMs: number): LocalTransportDiagnostics {
  const outer = errorLike(error);
  const nested = errorLike(outer?.cause);
  return {
    errorName: errorText(outer?.name),
    errorMessage: errorText(outer?.message),
    causeName: errorText(nested?.name),
    causeMessage: errorText(nested?.message),
    causeCode: errorText(nested?.code),
    classification: classifyLocalTransportError(error),
    nodeVersion: process.version,
    undiciVersion: process.versions.undici ?? null,
    elapsedMs: Math.round(elapsedMs),
  };
}

export class LocalStructuredModelError extends Error {
  constructor(
    message: string,
    readonly failureClass: LocalStructuredFailureClass,
    readonly details: {
      endpoint: string;
      modelId: string;
      schemaName: string;
      httpStatus?: number;
      responseBodyExcerpt?: string;
      transport?: LocalTransportDiagnostics;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocalStructuredModelError";
  }
}

function shortResponseExcerpt(value: string): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 500) : undefined;
}

export function createLocalStructuredModelProvider(config: Extract<ResolvedAIProviderConfig, { providerId: "local" }>, fetchImpl: typeof fetch = fetch): StructuredModelProvider {
  return {
    providerId: "local",
    modelId: config.modelId,
    async parseStructured<T>({ system, payload, schema, schemaName }: StructuredModelRequest<T>) {
      const startedAt = performance.now();
      const endpoint = `${config.baseUrl}/chat/completions`;
      const jsonSchema = z.toJSONSchema(schema);
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
          body: JSON.stringify({
            model: config.modelId,
            messages: [
              { role: "system", content: `${system}\nReturn only valid JSON matching the requested ${schemaName} structure.` },
              { role: "user", content: userContent(payload) },
            ],
            response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema: jsonSchema } },
            reasoning_effort: "none",
            temperature: 0,
          }),
        });
      } catch (error) {
        throw new LocalStructuredModelError(
          `Local AI transport failure for ${schemaName} at ${endpoint} using ${config.modelId}`,
          "transport failure",
          { endpoint, modelId: config.modelId, schemaName, transport: localTransportDiagnostics(error, performance.now() - startedAt) },
          { cause: error },
        );
      }
      const responseText = await response.text();
      if (!response.ok) {
        const failureClass = response.status >= 500 ? "HTTP 5xx" : "HTTP 4xx";
        const excerpt = shortResponseExcerpt(responseText);
        throw new LocalStructuredModelError(
          `Local AI request failed (${response.status} ${response.statusText}) for ${schemaName} at ${endpoint} using ${config.modelId}${excerpt ? `: ${excerpt}` : ""}`,
          failureClass,
          { endpoint, modelId: config.modelId, schemaName, httpStatus: response.status, responseBodyExcerpt: excerpt },
        );
      }
      let body: LocalChatResponse;
      try {
        body = JSON.parse(responseText) as LocalChatResponse;
      } catch (error) {
        throw new LocalStructuredModelError(
          `Local AI returned a malformed response envelope for ${schemaName}`,
          "malformed JSON",
          { endpoint, modelId: config.modelId, schemaName, responseBodyExcerpt: shortResponseExcerpt(responseText) },
          { cause: error },
        );
      }
      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        throw new LocalStructuredModelError(
          `Local AI returned no ${schemaName} content`,
          "schema-invalid JSON",
          { endpoint, modelId: config.modelId, schemaName, responseBodyExcerpt: shortResponseExcerpt(responseText) },
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch (error) {
        throw new LocalStructuredModelError(
          `Local AI returned malformed JSON for ${schemaName}`,
          "malformed JSON",
          { endpoint, modelId: config.modelId, schemaName, responseBodyExcerpt: shortResponseExcerpt(content) },
          { cause: error },
        );
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new LocalStructuredModelError(
          `Local AI returned schema-invalid JSON for ${schemaName}: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")}`,
          "schema-invalid JSON",
          { endpoint, modelId: config.modelId, schemaName },
          { cause: parsed.error },
        );
      }
      const output = parsed.data;
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
