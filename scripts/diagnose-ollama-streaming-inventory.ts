import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { z } from "zod";
import { buildExtractionInput, buildInventoryInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { extractionInventoryOutputSchema } from "../lib/ai/schemas";
import { validateExtractionInventory } from "../lib/ai/source-validation";
import { localTransportDiagnostics } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import type { DocumentPage, PageChunk } from "../lib/pdf/types";

loadEnvConfig(process.cwd());

const SOURCE_CAMPAIGN_ID = "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4";
const CACHE_ID = "1ad99ac3-6cf5-4731-bf1e-4736109f0de8";
const EXPECTED_MODEL = "qwen3.5:9b";
const EXPECTED_CONTEXT = 32768;
const SCORED_CHUNK = 3;

interface ReferenceChunk { chunk_number: number; normalized_source_text_sha256: string }
interface StreamEnvelope {
  id?: string;
  model?: string;
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedSourceHash = (chunk: PageChunk) => {
  const input = buildExtractionInput(chunk);
  return sha256(input.slice(input.indexOf("<campaign-page")).replace(/\s+/g, " ").trim());
};

async function ollamaMetadata(baseUrl: string, model: string) {
  const origin = new URL(baseUrl).origin;
  const [tags, ps] = await Promise.all([
    fetch(`${origin}/api/tags`).then(async (response) => response.ok ? response.json() as Promise<{ models?: Array<{ name?: string; digest?: string }> }> : null).catch(() => null),
    fetch(`${origin}/api/ps`).then(async (response) => response.ok ? response.json() as Promise<{ models?: Array<{ name?: string; size_vram?: number; context_length?: number }> }> : null).catch(() => null),
  ]);
  const loaded = ps?.models?.find((item) => item.name === model);
  return { digest: tags?.models?.find((item) => item.name === model)?.digest ?? null, loadedContext: loaded?.context_length ?? null };
}

async function readStream(response: Response, startedAt: number) {
  if (!response.body) throw new Error("Streaming response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let firstByteMs: number | null = null;
  let firstContentMs: number | null = null;
  let usage: StreamEnvelope["usage"];
  let id: string | null = null;
  let model: string | null = null;
  let done = false;

  const consumeEvent = (event: string) => {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data === "[DONE]") { done = true; return; }
    const envelope = JSON.parse(data) as StreamEnvelope;
    id ??= envelope.id ?? null;
    model ??= envelope.model ?? null;
    usage ??= envelope.usage;
    const delta = envelope.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length) {
      firstContentMs ??= Math.round(performance.now() - startedAt);
      content += delta;
    }
  };

  while (!done) {
    const next = await reader.read();
    if (next.done) break;
    firstByteMs ??= Math.round(performance.now() - startedAt);
    buffer += decoder.decode(next.value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const event = buffer.slice(0, boundary);
      const delimiterLength = buffer[boundary] === "\r" ? (buffer[boundary + 1] === "\n" && buffer[boundary + 2] === "\r" ? 4 : 3) : 2;
      buffer = buffer.slice(boundary + delimiterLength);
      consumeEvent(event);
    }
  }
  if (!done) throw new Error("Streaming response ended before [DONE]");
  return { content, firstByteMs, firstContentMs, usage, id, model };
}

async function postWithLongTimeout(endpoint: string, body: string, headers: Record<string, string>, startedAt: number) {
  const target = new URL(endpoint);
  return new Promise<{ status: number; statusText: string; body: string; firstByteMs: number | null }>((resolve, reject) => {
    const request = httpRequest({ protocol: target.protocol, hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body).toString() } }, (response) => {
      const firstByteMs = Math.round(performance.now() - startedAt);
      const parts: Buffer[] = [];
      response.on("data", (part: Buffer) => parts.push(part));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, statusText: response.statusMessage ?? "", body: Buffer.concat(parts).toString("utf8"), firstByteMs }));
      response.on("error", reject);
    });
    request.setTimeout(900_000, () => request.destroy(new Error("Local HTTP request exceeded 900000ms")));
    request.on("error", reject);
    request.end(body);
  });
}

async function main() {
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local") throw new Error("Streaming diagnostic requires AI_PROVIDER=local");
  if (config.modelId !== EXPECTED_MODEL) throw new Error(`Streaming diagnostic requires ${EXPECTED_MODEL}`);
  if (config.allowPersistence) throw new Error("LOCAL_AI_ALLOW_PERSISTENCE must be false");
  if (Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("LOCAL_AI_EXTRACTION_CONCURRENCY must be 1");
  const reference = JSON.parse(readFileSync(new URL("../docs/audits/extraction_ab_reference.json", import.meta.url), "utf8")) as { chunks: ReferenceChunk[] };
  const metadata = await ollamaMetadata(config.baseUrl, config.modelId);
  const { createAdminClient } = await import("../lib/db/client");
  const database = createAdminClient();
  const document = await database.from("documents").select("id").eq("campaign_id", SOURCE_CAMPAIGN_ID).single();
  if (document.error) throw document.error;
  const [pages, chunks] = await Promise.all([
    database.from("document_pages").select("page_number,text").eq("document_id", document.data.id).order("page_number"),
    database.from("extraction_cache_chunks").select("chunk_id,chunk_index,page_numbers").eq("cache_run_id", CACHE_ID).order("chunk_index"),
  ]);
  if (pages.error || !pages.data || chunks.error || !chunks.data) throw pages.error ?? chunks.error ?? new Error("Frozen diagnostic source is unavailable");
  const stored = chunks.data.find((item) => item.chunk_index + 1 === SCORED_CHUNK);
  if (!stored) throw new Error(`Frozen scored chunk ${SCORED_CHUNK} is unavailable`);
  const chunk: PageChunk = { id: stored.chunk_id, pages: stored.page_numbers.map((pageNumber): DocumentPage => {
    const page = pages.data.find((item) => item.page_number === pageNumber);
    if (!page) throw new Error(`Missing page ${pageNumber}`);
    return { pageNumber, text: page.text };
  }), characterCount: 0 };
  chunk.characterCount = chunk.pages.reduce((total, page) => total + page.text.length, 0);
  const frozen = reference.chunks.find((item) => item.chunk_number === SCORED_CHUNK);
  if (!frozen || normalizedSourceHash(chunk) !== frozen.normalized_source_text_sha256) throw new Error("Frozen source hash mismatch");

  const endpoint = `${config.baseUrl}/chat/completions`;
  const startedAt = performance.now();
  const longTimeout = process.argv.includes("--long-timeout");
  let observed: Record<string, unknown> | null = null;
  const requestBody = JSON.stringify({
    model: config.modelId,
    messages: [
      { role: "system", content: `${EXTRACTION_INVENTORY_SYSTEM_PROMPT}\nReturn only valid JSON matching the requested extraction_inventory_output structure.` },
      { role: "user", content: buildInventoryInput(chunk) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "extraction_inventory_output", strict: true, schema: z.toJSONSchema(extractionInventoryOutputSchema) } },
    reasoning_effort: "none",
    temperature: 0,
    ...(longTimeout ? {} : { stream: true }),
  });
  const headers = { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) };
  try {
    const streamed = longTimeout ? null : await (async () => {
      const response = await fetch(endpoint, { method: "POST", headers, signal: AbortSignal.timeout(15 * 60_000), body: requestBody });
      if (!response.ok) throw new Error(`HTTP_${response.status}: ${response.statusText}`);
      return readStream(response, startedAt);
    })();
    const longResponse = longTimeout ? await postWithLongTimeout(endpoint, requestBody, headers, startedAt) : null;
    observed = streamed
      ? { streamDone: true, firstByteMs: streamed.firstByteMs, firstContentMs: streamed.firstContentMs, outputCharacters: streamed.content.length, outputBytes: Buffer.byteLength(streamed.content, "utf8"), responseId: streamed.id, responseModel: streamed.model, usage: streamed.usage ?? null }
      : { streamDone: false, httpStatus: longResponse?.status ?? null, firstByteMs: longResponse?.firstByteMs ?? null, responseEnvelopeCharacters: longResponse?.body.length ?? null, responseEnvelopeBytes: longResponse ? Buffer.byteLength(longResponse.body, "utf8") : null };
    if (longResponse && (longResponse.status < 200 || longResponse.status >= 300)) throw new Error(`HTTP_${longResponse.status}: ${longResponse.statusText}`);
    const content = streamed?.content ?? (() => {
      const envelope = JSON.parse(longResponse!.body) as { choices?: Array<{ message?: { content?: string | null } }> };
      const value = envelope.choices?.[0]?.message?.content;
      if (!value) throw new Error("Local AI returned no extraction_inventory_output content");
      return value;
    })();
    const decoded = JSON.parse(content);
    const parsed = extractionInventoryOutputSchema.parse(decoded);
    const validated = validateExtractionInventory(parsed, chunk.pages);
    console.log(JSON.stringify({
      diagnostic: longTimeout ? "long_timeout_inventory" : "streaming_inventory",
      status: "success",
      chunk: SCORED_CHUNK,
      model: streamed?.model ?? config.modelId,
      modelDigest: metadata.digest,
      configuredContext: EXPECTED_CONTEXT,
      loadedContext: metadata.loadedContext,
      temperature: 0,
      reasoningEffort: "none",
      concurrency: 1,
      stream: !longTimeout,
      requestHeadersTimeoutMs: longTimeout ? 900000 : null,
      requestBodyTimeoutMs: longTimeout ? 900000 : null,
      firstByteMs: streamed?.firstByteMs ?? longResponse?.firstByteMs ?? null,
      firstContentMs: streamed?.firstContentMs ?? null,
      totalLatencyMs: Math.round(performance.now() - startedAt),
      outputCharacters: content.length,
      outputBytes: Buffer.byteLength(content, "utf8"),
      entityCount: validated.inventory.entities.length,
      validationDiagnostics: validated.diagnostics.length,
      usage: streamed?.usage ?? null,
      responseId: streamed?.id ?? null,
      openAICalls: 0,
      localGenerationCalls: 1,
      campaignWrites: 0,
      reconciliationCalls: 0,
      enrichmentCalls: 0,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      diagnostic: longTimeout ? "long_timeout_inventory" : "streaming_inventory",
      status: "failed",
      chunk: SCORED_CHUNK,
      totalLatencyMs: Math.round(performance.now() - startedAt),
      transport: localTransportDiagnostics(error, performance.now() - startedAt),
      observed,
      error: error instanceof Error ? error.message : String(error),
      openAICalls: 0,
      localGenerationCalls: 1,
      campaignWrites: 0,
      reconciliationCalls: 0,
      enrichmentCalls: 0,
    }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
