import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLocalStructuredModelProvider, createOpenAIStructuredModelProvider, preflightLocalStructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { assertAIProviderPersistenceAllowed, resolveAIProviderConfig } from "@/lib/env";
import { enrichCanonicalGraphWithAI } from "@/lib/ai/enrich";
import { enrichmentFixtureGraph, enrichmentFixtureOutput } from "@/fixtures/enrichment-cache";

const schema = z.object({ answer: z.string() });
const request = { system: "Answer from the payload.", payload: { question: "test" }, schema, schemaName: "fixture_answer" };

describe("structured model provider selection", () => {
  it("defaults to the stage-specific OpenAI model", () => {
    expect(resolveAIProviderConfig({ OPENAI_API_KEY: "test", OPENAI_MODEL: "fallback", OPENAI_ENRICHMENT_MODEL: "enrich" }, "enrichment")).toEqual({ providerId: "openai", modelId: "enrich" });
  });

  it("resolves an explicit local provider without an OpenAI key", () => {
    expect(resolveAIProviderConfig({ AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "http://localhost:11434/v1/", LOCAL_AI_MODEL: "local-model" }, "enrichment")).toEqual({ providerId: "local", modelId: "local-model", baseUrl: "http://localhost:11434/v1", apiKey: undefined, allowPersistence: false });
  });

  it("resolves stage-specific local models with a backward-compatible shared fallback", () => {
    const env = { AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "http://localhost:11434/v1", LOCAL_AI_MODEL: "shared", LOCAL_AI_EXTRACTION_MODEL: "extract", LOCAL_AI_RECONCILIATION_MODEL: "reconcile" };
    expect(resolveAIProviderConfig(env, "extraction").modelId).toBe("extract");
    expect(resolveAIProviderConfig(env, "reconciliation").modelId).toBe("reconcile");
    expect(resolveAIProviderConfig(env, "enrichment").modelId).toBe("shared");
  });

  it("fails closed for local canonical persistence unless explicitly acknowledged", () => {
    const local = resolveAIProviderConfig({ AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "http://localhost:11434/v1", LOCAL_AI_MODEL: "local-model" }, "enrichment");
    expect(() => assertAIProviderPersistenceAllowed(local)).toThrow(/LOCAL_AI_ALLOW_PERSISTENCE=true/);
    const acknowledged = resolveAIProviderConfig({ AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "http://localhost:11434/v1", LOCAL_AI_MODEL: "local-model", LOCAL_AI_ALLOW_PERSISTENCE: "true" }, "enrichment");
    expect(() => assertAIProviderPersistenceAllowed(acknowledged)).not.toThrow();
  });

  it("rejects unsupported and incomplete local configuration", () => {
    expect(() => resolveAIProviderConfig({ AI_PROVIDER: "other" }, "enrichment")).toThrow(/Unsupported AI_PROVIDER/);
    expect(() => resolveAIProviderConfig({ AI_PROVIDER: "local", LOCAL_AI_MODEL: "model" }, "enrichment")).toThrow(/LOCAL_AI_BASE_URL/);
    expect(() => resolveAIProviderConfig({ AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "http:\/\/localhost:11434\/v1" }, "enrichment")).toThrow(/LOCAL_AI_MODEL/);
    expect(() => resolveAIProviderConfig({ AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "http:\/\/localhost:11434\/v1", LOCAL_AI_MODEL: "model", VERCEL: "1" }, "enrichment")).toThrow(/not allowed on Vercel/);
  });
});

describe("OpenAI structured model adapter", () => {
  it("preserves parsed output, response identity, and usage through the existing Responses mapping", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { answer: "yes" }, model: "openai-model", id: "response-1", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 0 } } });
    const provider = createOpenAIStructuredModelProvider("openai-model", { responses: { parse } } as never);
    const result = await provider.parseStructured(request);
    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ input: [{ role: "system", content: request.system }, { role: "user", content: JSON.stringify(request.payload) }] }));
    expect(result).toMatchObject({ output: { answer: "yes" }, providerId: "openai", modelId: "openai-model", responseId: "response-1", usage: { inputTokens: 10, cachedInputTokens: 3, outputTokens: 2 } });
  });

  it("preserves pre-serialized stage payloads without adding JSON string quoting", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { answer: "yes" }, model: "openai-model", id: "response", usage: undefined });
    const provider = createOpenAIStructuredModelProvider("openai-model", { responses: { parse } } as never);
    await provider.parseStructured({ ...request, payload: "exact stage payload" });
    expect(parse.mock.calls[0][0].input[1].content).toBe("exact stage payload");
  });
});

describe("local structured model adapter", () => {
  const config = { providerId: "local" as const, modelId: "local-model", baseUrl: "http://localhost:11434/v1", allowPersistence: false };
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, statusText: status === 200 ? "OK" : "Failure", headers: { "content-type": "application/json" } });

  it("parses JSON and validates it with the application Zod schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ id: "local-1", model: "local-model", choices: [{ message: { content: JSON.stringify({ answer: "yes" }) } }] }));
    const result = await createLocalStructuredModelProvider(config, fetchMock).parseStructured(request);
    expect(result).toMatchObject({ output: { answer: "yes" }, providerId: "local", modelId: "local-model", responseId: "local-1", usage: { inputTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null } });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/v1/chat/completions", expect.objectContaining({ method: "POST" }));
  });

  it("maps reliable local token fields without inventing cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ choices: [{ message: { content: JSON.stringify({ answer: "yes" }) } }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } }));
    expect((await createLocalStructuredModelProvider(config, fetchMock).parseStructured(request)).usage).toMatchObject({ inputTokens: 8, outputTokens: 2, totalTokens: 10, estimatedCostUsd: null });
  });

  it("fails clearly for malformed JSON, schema-invalid JSON, and provider errors", async () => {
    const malformed = createLocalStructuredModelProvider(config, vi.fn().mockResolvedValue(response({ choices: [{ message: { content: "not-json" } }] })));
    await expect(malformed.parseStructured(request)).rejects.toThrow(/malformed JSON/);
    const invalid = createLocalStructuredModelProvider(config, vi.fn().mockResolvedValue(response({ choices: [{ message: { content: JSON.stringify({ answer: 3 }) } }] })));
    await expect(invalid.parseStructured(request)).rejects.toThrow();
    const unavailable = createLocalStructuredModelProvider(config, vi.fn().mockResolvedValue(response({}, 503)));
    await expect(unavailable.parseStructured(request)).rejects.toThrow(/Local AI request failed \(503/);
  });

  it("preflights a local model without making a generation call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [{ id: "local-model" }] }));
    expect(await preflightLocalStructuredModelProvider(config, fetchMock)).toMatchObject({ providerId: "local", reachable: true, modelAvailability: "confirmed", paidOpenAICalls: 0 });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/v1/models", expect.any(Object));
  });

  it("reports when a compatible endpoint does not report model availability", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    await expect(preflightLocalStructuredModelProvider(config, fetchMock)).resolves.toMatchObject({ modelAvailability: "not-reported", paidOpenAICalls: 0 });
  });
});

describe("provider-independent enrichment", () => {
  it("produces the same validated graph through OpenAI and local adapters", async () => {
    const graph = enrichmentFixtureGraph();
    const fixture = enrichmentFixtureOutput(graph);
    const outputFor = (name: string, payload: unknown) => {
      const record = payload as Record<string, unknown>;
      if (name.startsWith("entity_classification")) return { entities: fixture.classification.entities };
      if (name.startsWith("fact_visibility")) { const keys = new Set((record.facts as Array<{ key: string }>).map((item) => item.key)); return { facts: fixture.classification.facts.filter((item) => keys.has(item.fact_key)) }; }
      if (name.startsWith("relationship_visibility")) { const keys = new Set((record.relationships as Array<{ key: string }>).map((item) => item.key)); return { relationships: fixture.classification.relationships.filter((item) => keys.has(item.relationship_key)) }; }
      if (name.startsWith("gm_entity_summaries")) { const keys = new Set((payload as Array<{ key: string }>).map((item) => item.key)); return { summaries: fixture.gmSummaries.summaries.filter((item) => keys.has(item.entity_key)) }; }
      if (name.startsWith("player_entity_summaries")) { const keys = new Set((payload as Array<{ key: string }>).map((item) => item.key)); return { summaries: fixture.playerSummaries.summaries.filter((item) => keys.has(item.entity_key)) }; }
      if (name === "gm_campaign_overview") return fixture.gmOverview;
      if (name === "player_campaign_overview") return fixture.playerOverview;
      throw new Error(`Unexpected fixture request ${name}`);
    };
    const openAIParse = vi.fn().mockImplementation(async (input: { input: Array<{ content: string }>; text: { format: { name: string } } }) => ({ output_parsed: outputFor(input.text.format.name, JSON.parse(input.input[1].content)), model: "openai-model", id: "openai-response", usage: undefined }));
    const openAIProvider = createOpenAIStructuredModelProvider("openai-model", { responses: { parse: openAIParse } } as never);
    const localFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const name = body.messages[0].content.match(/requested ([^ ]+) structure/)?.[1];
      return new Response(JSON.stringify({ model: "local-model", choices: [{ message: { content: JSON.stringify(outputFor(name!, JSON.parse(body.messages[1].content))) } }] }), { status: 200 });
    });
    const localProvider = createLocalStructuredModelProvider({ providerId: "local", modelId: "local-model", baseUrl: "http://localhost:11434/v1", allowPersistence: false }, localFetch);
    const [openAI, local] = await Promise.all([enrichCanonicalGraphWithAI(graph, { provider: openAIProvider }), enrichCanonicalGraphWithAI(graph, { provider: localProvider })]);
    expect(local.graph).toEqual(openAI.graph);
    expect(openAIParse).toHaveBeenCalled();
    expect(localFetch).toHaveBeenCalled();
  });
});
