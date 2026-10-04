import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StructuredModelProvider, StructuredModelRequest, StructuredModelResult } from "./structured-model-provider";
import { semanticInputHash, modelInputHash } from "./operation-checkpoint";
import { modelCallUsage } from "./usage";
import { writeDurableArtifact } from "./private-artifact";
import { assertClaimsDocumentModel, CLAIMS_DOCUMENT_MODEL, CLAIMS_DOCUMENT_VERSION } from "./claims-document-source";

export const CLAIMS_DOCUMENT_CLIENT_OPTIONS = Object.freeze({ maxRetries: 0 as const });
export interface DocumentAuthorization { live: boolean; authorization?: string; allowedRequestIds: string[]; maxCalls: number }
export function authorizeDocumentStage(auth: DocumentAuthorization, ids: string[], model = CLAIMS_DOCUMENT_MODEL) {
  assertClaimsDocumentModel(model);
  if (!auth.live || auth.authorization !== "1") throw new Error("Explicit document live authorization required");
  if (!ids.length || new Set(ids).size !== ids.length || auth.allowedRequestIds.length !== ids.length ||
    new Set(auth.allowedRequestIds).size !== ids.length || ids.some((id) => !auth.allowedRequestIds.includes(id))) throw new Error("Exact request allowlist required");
  if (!Number.isInteger(auth.maxCalls) || auth.maxCalls !== ids.length) throw new Error("Exact max-call count required");
}

export interface DocumentOperation { id: string; stage: string; sourceHash: string; upstreamFingerprint: string; behaviorVersion: string; outputCap: number }
/** An operation is addressed by complete semantic identity, never by just its display ID. */
export function operationIdentity(operation: DocumentOperation, request: StructuredModelRequest<unknown>) {
  return { ...operation, providerId: "openai", modelId: CLAIMS_DOCUMENT_MODEL, pipelineVersion: CLAIMS_DOCUMENT_VERSION,
    // Completeness payload embeds validated initial inventory; Claims payload embeds global inventory.
    upstreamFingerprint: semanticInputHash({ source: operation.upstreamFingerprint, payload: request.payload }),
    inputHash: modelInputHash(request.system, request.payload), schemaHash: semanticInputHash(z.toJSONSchema(request.schema)) };
}

/** The client is constructed only on an explicitly authorized live path. No environment model defaults. */
export function createDocumentRuntime(directory: string, auth: DocumentAuthorization, ids: string[]) {
  authorizeDocumentStage(auth, ids);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, ...CLAIMS_DOCUMENT_CLIENT_OPTIONS });
  return durableDocumentProvider(directory, auth, ids, client);
}

export function durableDocumentProvider(directory: string, auth: DocumentAuthorization, ids: string[],
  client: Pick<OpenAI, "responses">, reuseOnly = false) {
  authorizeDocumentStage(auth, ids);
  mkdirSync(directory, { recursive: true });
  let calls = 0;
  const metadata: Array<{ id: string; reused: boolean; identityHash: string }> = [];
  const providerFor = (operation: DocumentOperation): StructuredModelProvider => ({ providerId: "openai", modelId: CLAIMS_DOCUMENT_MODEL,
    async parseStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
      if (!ids.includes(operation.id)) throw new Error("Operation outside authorized stage");
      const identity = operationIdentity(operation, request);
      const hash = semanticInputHash(identity);
      const path = (suffix: string) => join(directory, `${hash}.${suffix}.json`);
      if (existsSync(path("success"))) {
        const saved = JSON.parse(readFileSync(path("success"), "utf8")) as { identity: unknown; result: StructuredModelResult<T>; resultHash: string };
        if (semanticInputHash(saved.identity) !== hash || saved.resultHash !== semanticInputHash(saved.result) || saved.result.modelId !== CLAIMS_DOCUMENT_MODEL ||
          saved.result.providerId !== "openai") throw new Error("Invalid cached identity/result");
        request.schema.parse(saved.result.output); // Validate without altering original proposals.
        metadata.push({ id: operation.id, reused: true, identityHash: hash });
        return saved.result;
      }
      if (existsSync(path("attempt"))) throw new Error("Uncertain/failed prior dispatch blocks automatic redispatch");
      if (reuseOnly) throw new Error("Required validated checkpoint missing; redispatch forbidden");
      if (calls >= auth.maxCalls) throw new Error("Document call ceiling exceeded");
      if (!Number.isInteger(operation.outputCap) || operation.outputCap < 1) throw new Error("Bounded output reservation required");
      // Exclusive, flushed reservation is committed before dispatch. Never removed after failure.
      writeDurableArtifact(path("attempt"), { identity, state: "dispatching", sdkMaxRetries: 0 });
      calls++;
      const response = await client.responses.create({ model: CLAIMS_DOCUMENT_MODEL,
        input: [{ role: "system", content: request.system }, { role: "user", content: typeof request.payload === "string" ? request.payload : JSON.stringify(request.payload) }],
        text: { format: zodTextFormat(request.schema, request.schemaName) }, max_output_tokens: operation.outputCap }, { maxRetries: 0 });
      writeDurableArtifact(path("response"), response); // Raw output and usage precede validation.
      if (response.model !== CLAIMS_DOCUMENT_MODEL || response.status !== "completed" || response.incomplete_details) throw new Error("Incomplete/wrong-model response; no retry");
      const output = JSON.parse(response.output_text) as T;
      request.schema.parse(output);
      const result: StructuredModelResult<T> = { output, providerId: "openai", modelId: response.model, responseId: response.id,
        usage: modelCallUsage(response.model, response.id, response.usage) };
      if (result.usage.inputTokens === null || result.usage.outputTokens === null || result.usage.totalTokens === null) throw new Error("Unknown OpenAI usage; stop without automatic retry");
      writeDurableArtifact(path("success"), { identity, result, resultHash: semanticInputHash(result) });
      metadata.push({ id: operation.id, reused: false, identityHash: hash });
      return result;
    } });
  return { providerFor, metadata, get calls() { return calls; } };
}
