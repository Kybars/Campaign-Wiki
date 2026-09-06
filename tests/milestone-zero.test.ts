import { describe, expect, it } from "vitest";
import type { ResponseUsage } from "openai/resources/responses/responses";
import { estimateModelCostUsd, summarizeModelUsage } from "@/lib/ai/usage";
import { resolveOpenAIModels } from "@/lib/env";
import { aggregateCachedChunks, parseCachedReconciliation } from "@/lib/processing/replay-cache";

const usage: ResponseUsage = {
  input_tokens: 1_000_000,
  input_tokens_details: { cached_tokens: 200_000, cache_write_tokens: 100_000 },
  output_tokens: 100_000,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 1_100_000,
};

describe("Milestone 0 model configuration and diagnostics", () => {
  it("uses OPENAI_MODEL as a backward-compatible stage fallback", () => {
    expect(resolveOpenAIModels({ OPENAI_MODEL: "legacy-model" })).toMatchObject({
      OPENAI_EXTRACTION_MODEL: "legacy-model",
      OPENAI_RECONCILIATION_MODEL: "legacy-model",
    });
    expect(resolveOpenAIModels({
      OPENAI_MODEL: "legacy-model",
      OPENAI_EXTRACTION_MODEL: "extract-model",
      OPENAI_RECONCILIATION_MODEL: "reconcile-model",
    })).toMatchObject({
      OPENAI_EXTRACTION_MODEL: "extract-model",
      OPENAI_RECONCILIATION_MODEL: "reconcile-model",
    });
  });

  it("estimates known-model cost and declines to guess unknown-model pricing", () => {
    expect(estimateModelCostUsd("gpt-5.6-terra", usage)).toBeCloseTo(5.18);
    expect(estimateModelCostUsd("gpt-5.6-terra-2026-08-01", usage)).toBeCloseTo(5.18);
    expect(estimateModelCostUsd("custom-model", usage)).toBeNull();
  });

  it("aggregates per-call token and cost diagnostics", () => {
    expect(summarizeModelUsage("candidate_extraction", [
      { model: "known", responseId: "a", inputTokens: 10, cachedInputTokens: 2, cacheWriteTokens: 1, outputTokens: 3, totalTokens: 13, estimatedCostUsd: 0.01 },
      { model: "known", responseId: "b", inputTokens: 20, cachedInputTokens: 4, cacheWriteTokens: 0, outputTokens: 5, totalTokens: 25, estimatedCostUsd: 0.02 },
    ])).toMatchObject({ apiCalls: 2, inputTokens: 30, cachedInputTokens: 6, outputTokens: 8, totalTokens: 38, estimatedCostUsd: 0.03 });
  });
});

describe("Milestone 0 replay cache", () => {
  it("rebuilds aggregate candidate IDs and relationship endpoints from validated cached chunks", () => {
    const aggregate = aggregateCachedChunks([{ chunk_id: "chunk-1", validated_output: {
      entities: [
        { temporary_id: "e1", name: "Hanna Stone", type: "npc", aliases: [], summary: "An innkeeper.", sources: [{ page_number: 1, supporting_text: "Hanna Stone owns the Silver Stag Inn." }] },
        { temporary_id: "e2", name: "Silver Stag Inn", type: "location", aliases: [], summary: "An inn.", sources: [{ page_number: 1, supporting_text: "Hanna Stone owns the Silver Stag Inn." }] },
      ],
      relationships: [{ source_temporary_id: "e1", target_temporary_id: "e2", relationship_type: "owns", description: "Hanna Stone owns the Silver Stag Inn.", confidence: 0.9, sources: [{ page_number: 1, supporting_text: "Hanna Stone owns the Silver Stag Inn." }] }],
    } }]);
    expect(aggregate.entities.map((entity) => entity.id)).toEqual(["chunk-1:e1", "chunk-1:e2"]);
    expect(aggregate.entities.every((entity) => entity.roles.length === 0)).toBe(true);
    expect(aggregate.relationships[0]).toMatchObject({ sourceCandidateId: "chunk-1:e1", targetCandidateId: "chunk-1:e2" });
  });

  it("parses cached reconciliation decisions and supports deterministic no-call decisions", () => {
    expect(parseCachedReconciliation(null)).toBeUndefined();
    expect(parseCachedReconciliation({ canonical_entities: [] })).toEqual({ canonical_entities: [] });
    expect(() => parseCachedReconciliation({ bad: true })).toThrow();
  });
});
