import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildInventoryInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { extractionInventoryOutputSchema } from "../lib/ai/schemas";
import { groundInventoryIdentity, validateExtractionInventory } from "../lib/ai/source-validation";
import { createLocalStructuredModelProvider, LocalStructuredModelError } from "../lib/ai/structured-model-provider";
import { resolveAIProviderConfig } from "../lib/env";
import { normalizeName } from "../lib/graph/normalize";
import {
  assertGoldReferenceIsolation, loadWotbsGoldReference, loadWotbsStage1Fixture, scoreWotbsInventory,
  WOTBS_STAGE1_CONTEXT, WOTBS_STAGE1_EXPECTED_DIGEST, WOTBS_STAGE1_EXPECTED_MODEL,
} from "./wotbs-stage1";
import {
  WOTBS_IDENTITY_ONLY_SYSTEM_PROMPT, WOTBS_IDENTITY_PAGE_SYSTEM_PROMPT,
  wotbsIdentityOnlySchema, wotbsIdentityPageSchema,
} from "./wotbs-pass-a-repair";

loadEnvConfig(process.cwd());

const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const artifactDirectory = new URL("../artifacts/wotbs-pass-a-repair/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);
const WALL_CLOCK_TIMEOUT_MS = 600_000;

interface LocalEnvelope {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function boundedHttpFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:") throw new Error("WotBS repair requires the local HTTP Ollama endpoint");
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(deadline); action(); };
      const request = httpRequest({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body).toString() } : {}) } }, (response) => {
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => parts.push(part));
        response.on("end", () => finish(() => resolve(new Response(Buffer.concat(parts), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers: response.headers as HeadersInit }))));
        response.on("aborted", () => finish(() => reject(new Error("Local HTTP response aborted before completion"))));
        response.on("error", (error) => finish(() => reject(error)));
      });
      const deadline = setTimeout(() => { const error = new Error(`WotBS repair request exceeded ${timeoutMs}ms`); error.name = "FixtureWallClockTimeoutError"; request.destroy(error); }, timeoutMs);
      request.on("error", (error) => finish(() => reject(error)));
      request.end(body);
    });
  };
}

async function runtime(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const [tagsResponse, psResponse] = await Promise.all([fetch(`${origin}/api/tags`), fetch(`${origin}/api/ps`)]);
  if (!tagsResponse.ok) throw new Error(`Ollama tags failed (${tagsResponse.status})`);
  const tags = await tagsResponse.json() as { models?: Array<{ name?: string; digest?: string }> };
  const ps = psResponse.ok ? await psResponse.json() as { models?: Array<{ name?: string; context_length?: number }> } : null;
  return { digest: tags.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.digest ?? null, loadedContext: ps?.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.context_length ?? null };
}

function duplicates(entities: Array<{ name: string }>) {
  const groups = new Map<string, string[]>();
  for (const entity of entities) groups.set(normalizeName(entity.name), [...(groups.get(normalizeName(entity.name)) ?? []), entity.name]);
  return [...groups.entries()].filter(([, names]) => names.length > 1).map(([normalizedName, names]) => ({ normalizedName, count: names.length, names }));
}

function score(entities: Array<{ name: string; type: string }>, reference: ReturnType<typeof loadWotbsGoldReference>["reference"]) {
  return scoreWotbsInventory({ entities: entities.map((entity, index) => ({ temporary_id: `diagnostic_${index}`, name: entity.name, type: entity.type as "npc" | "deity" | "location" | "faction" | "item" | "event" | "quest" | "other", sources: [{ page_number: 10, supporting_text: "Diagnostic scoring uses identity only." }] })) }, reference);
}

async function call<T>(args: { phase: "A" | "B"; baseUrl: string; model: string; system: string; payload: string; schema: z.ZodType<T>; schemaName: string }) {
  const started = performance.now();
  const response = await boundedHttpFetch(WALL_CLOCK_TIMEOUT_MS)(`${args.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: args.model, messages: [{ role: "system", content: `${args.system}\nReturn only valid JSON matching the requested ${args.schemaName} structure.` }, { role: "user", content: args.payload }], response_format: { type: "json_schema", json_schema: { name: args.schemaName, strict: true, schema: z.toJSONSchema(args.schema) } }, reasoning_effort: "none", temperature: 0 }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Local HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  const envelope = JSON.parse(responseText) as LocalEnvelope;
  const content = envelope.choices?.[0]?.message?.content;
  if (!content) throw new Error("Local response contained no structured content");
  writeFileSync(new URL(`diagnostic-${args.phase.toLocaleLowerCase("en-US")}-raw.txt`, artifactDirectory), content);
  const baseMetrics = { latencyMs: Math.round(performance.now() - started), usage: { inputTokens: envelope.usage?.prompt_tokens ?? null, outputTokens: envelope.usage?.completion_tokens ?? null, totalTokens: envelope.usage?.total_tokens ?? null }, outputCharacters: content.length, outputBytes: Buffer.byteLength(content), outputSha256: createHash("sha256").update(content).digest("hex") };
  try {
    return { output: args.schema.parse(JSON.parse(content)), metrics: baseMetrics, error: null };
  } catch (error) {
    return { output: null, metrics: baseMetrics, error: error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError", message: String(error) } };
  }
}

async function main() {
  const mode = process.argv.includes("--call-a") ? "A" : process.argv.includes("--call-b") ? "B" : process.argv.includes("--call-c") ? "C" : null;
  if (!mode) throw new Error("Choose exactly one of --call-a, --call-b, or --call-c");
  mkdirSync(artifactDirectory, { recursive: true });
  const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
  if (fixture.chunks.length !== 1) throw new Error(`Expected one WotBS chunk, found ${fixture.chunks.length}`);
  const config = resolveAIProviderConfig(process.env, "extraction_inventory");
  if (config.providerId !== "local" || config.modelId !== WOTBS_STAGE1_EXPECTED_MODEL || config.allowPersistence || Number(process.env.LOCAL_AI_EXTRACTION_CONCURRENCY ?? "1") !== 1) throw new Error("Frozen WotBS repair configuration mismatch");
  const before = await runtime(config.baseUrl);
  if (before.digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen digest mismatch: ${before.digest ?? "unavailable"}`);
  const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> : { fixture: { pdfSha256: fixture.pdfSha256, normalizedTextSha256: fixture.normalizedTextSha256, pages: fixture.pages.map((page) => page.pageNumber), characters: fixture.sourceCharacterCount, chunks: fixture.chunks.length }, environment: { provider: "local", model: config.modelId, digest: before.digest, context: WOTBS_STAGE1_CONTEXT, temperature: 0, reasoningEffort: "none", concurrency: 1, wallClockTimeoutMs: WALL_CLOCK_TIMEOUT_MS }, diagnosticA: null, diagnosticB: null, productionC: null, newLocalGenerationCalls: 0, safety: { openAICalls: 0, passBLiveCalls: 0, reconciliationCalls: 0, enrichmentCalls: 0, campaignWrites: 0, checkpointOrCacheWrites: 0, goldLeakage: 0 } };
  const phaseKey = mode === "A" ? "diagnosticA" : mode === "B" ? "diagnosticB" : "productionC";
  if (existing[phaseKey] !== null) throw new Error(`Diagnostic ${mode} already has a terminal result; retry refused`);
  if (mode === "B" && !(existing.diagnosticA as { valid?: boolean } | null)?.valid) throw new Error("Diagnostic B requires a valid Diagnostic A result");
  if (mode === "C" && !(existing.diagnosticB as { valid?: boolean } | null)?.valid) throw new Error("Production C requires a valid Diagnostic B result");
  if (Number(existing.newLocalGenerationCalls) >= 3) throw new Error("WotBS repair local generation ceiling reached");
  existing.newLocalGenerationCalls = Number(existing.newLocalGenerationCalls) + 1;
  existing[phaseKey] = { status: "started" };
  writeFileSync(manifestPath, `${JSON.stringify(existing, null, 2)}\n`);
  const chunk = fixture.chunks[0];
  const payload = buildInventoryInput(chunk);
  const system = mode === "A" ? WOTBS_IDENTITY_ONLY_SYSTEM_PROMPT : WOTBS_IDENTITY_PAGE_SYSTEM_PROMPT;
  const goldJsonPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot);
  const goldMarkdownPath = new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.md", fixtureRoot);
  if (mode === "C") {
    const started = performance.now();
    try {
      const provider = createLocalStructuredModelProvider(config, boundedHttpFetch(WALL_CLOCK_TIMEOUT_MS));
      const response = await provider.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload, schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
      const validated = validateExtractionInventory(response.output, chunk);
      const serialized = JSON.stringify(response.output);
      writeFileSync(new URL("production-c-raw.json", artifactDirectory), `${JSON.stringify(response.output, null, 2)}\n`);
      const ids = validated.inventory.entities.map((entity) => entity.temporary_id);
      const grounding = response.output.entities.map((entity) => ({ entity, ...groundInventoryIdentity(entity, chunk.pages) }));
      const gold = loadWotbsGoldReference(fileURLToPath(goldJsonPath));
      const goldArtifacts = [{ path: fileURLToPath(goldJsonPath), raw: gold.raw }, { path: fileURLToPath(goldMarkdownPath), raw: readFileSync(goldMarkdownPath, "utf8") }];
      assertGoldReferenceIsolation([EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload], goldArtifacts);
      const quality = scoreWotbsInventory(validated.inventory, gold.reference);
      existing[phaseKey] = {
        status: "complete", valid: true, latencyMs: Math.round(performance.now() - started),
        usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens },
        outputCharacters: serialized.length, outputBytes: Buffer.byteLength(serialized), rawEntityCount: response.output.entities.length,
        authoritativeEntityCount: validated.inventory.entities.length, deterministicIdCount: new Set(ids).size, idCollisions: ids.length - new Set(ids).size,
        perType: Object.fromEntries([...new Set(validated.inventory.entities.map((entity) => entity.type))].sort().map((type) => [type, validated.inventory.entities.filter((entity) => entity.type === type).length])),
        normalizedNameDuplicates: duplicates(response.output.entities), grounding: { exact: grounding.filter((item) => item.strategy === "exact_normalized_name").length, inferredEventOrQuest: grounding.filter((item) => item.strategy === "inferred_event_or_quest_tokens").length, failed: grounding.filter((item) => item.source === null).length, exclusions: grounding.filter((item) => item.source === null).map((item) => ({ entity: item.entity, reason: item.reason })) },
        validationDiagnostics: validated.diagnostics, quality,
      };
      existing.decision = quality.supportedEntityRecall >= 0.90 ? "WOTBS_PASS_A_IDENTITY_GROUNDING_VALIDATED" : "WOTBS_PASS_A_RELIABLE_RECALL_LOW";
    } catch (error) {
      existing[phaseKey] = { status: "complete", valid: false, latencyMs: Math.round(performance.now() - started), error: error instanceof LocalStructuredModelError ? { name: error.name, message: error.message, failureClass: error.failureClass, details: error.details, cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : null } : { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) } };
      existing.decision = "INCONCLUSIVE";
    }
    writeFileSync(manifestPath, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(JSON.stringify({ phase: mode, ...(existing[phaseKey] as object), decision: existing.decision }, null, 2));
    return;
  }
  const result = mode === "A"
    ? await call({ phase: mode, baseUrl: config.baseUrl, model: config.modelId, system, payload, schema: wotbsIdentityOnlySchema, schemaName: "wotbs_identity_only_output" })
    : await call({ phase: mode, baseUrl: config.baseUrl, model: config.modelId, system, payload, schema: wotbsIdentityPageSchema, schemaName: "wotbs_identity_page_output" });
  if (!result.output) {
    existing[phaseKey] = { status: "complete", valid: false, ...result.metrics, error: result.error };
    existing.decision = mode === "A" ? "WOTBS_MULTICATEGORY_DISCOVERY_UNSTABLE" : "WOTBS_PAGE_LOCATOR_CAUSES_INSTABILITY";
    writeFileSync(manifestPath, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(JSON.stringify({ phase: mode, ...(existing[phaseKey] as object), decision: existing.decision }, null, 2));
    return;
  }
  const gold = loadWotbsGoldReference(fileURLToPath(goldJsonPath));
  const goldArtifacts = [{ path: fileURLToPath(goldJsonPath), raw: gold.raw }, { path: fileURLToPath(goldMarkdownPath), raw: readFileSync(goldMarkdownPath, "utf8") }];
  assertGoldReferenceIsolation([system, payload], goldArtifacts);
  const entities = result.output.entities;
  const perType = Object.fromEntries([...new Set(entities.map((entity) => entity.type))].sort().map((type) => [type, entities.filter((entity) => entity.type === type).length]));
  const after = await runtime(config.baseUrl);
  existing[phaseKey] = { status: "complete", valid: true, ...result.metrics, entityCount: entities.length, perType, normalizedNameDuplicates: duplicates(entities), quality: score(entities, gold.reference), loadedContextAfter: after.loadedContext, output: result.output };
  writeFileSync(manifestPath, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(JSON.stringify({ phase: mode, ...(existing[phaseKey] as object), output: undefined }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
