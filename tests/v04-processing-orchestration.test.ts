import type { CanonicalGraph } from "@/lib/graph/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimCampaignForProcessing: vi.fn(), createExtractionCacheRun: vi.fn(), createEnrichmentCacheRun: vi.fn(),
  finishExtractionCacheRun: vi.fn(), finishEnrichmentCacheRun: vi.fn(), loadCampaignForProcessing: vi.fn(),
  loadCompleteEnrichmentCache: vi.fn(), persistCanonicalGraph: vi.fn(), recordProcessingRun: vi.fn(),
  saveExtractionCacheChunk: vi.fn(), saveReconciliationCacheResult: vi.fn(), updateCampaign: vi.fn(),
  extractChunksLimited: vi.fn(), reconcileGroupsWithAI: vi.fn(), enrichCanonicalGraphWithAI: vi.fn(),
  aggregateCandidates: vi.fn(), buildCanonicalGraph: vi.fn(), buildDeterministicGroups: vi.fn(),
  getAIProviderConfig: vi.fn(), assertAIProviderPersistenceAllowed: vi.fn(),
  getStructuredModelProvider: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/repository", () => ({
  claimCampaignForProcessing: mocks.claimCampaignForProcessing, createExtractionCacheRun: mocks.createExtractionCacheRun,
  createEnrichmentCacheRun: mocks.createEnrichmentCacheRun, finishExtractionCacheRun: mocks.finishExtractionCacheRun,
  finishEnrichmentCacheRun: mocks.finishEnrichmentCacheRun, loadCampaignForProcessing: mocks.loadCampaignForProcessing,
  loadCompleteEnrichmentCache: mocks.loadCompleteEnrichmentCache, persistCanonicalGraph: mocks.persistCanonicalGraph,
  recordProcessingRun: mocks.recordProcessingRun, saveExtractionCacheChunk: mocks.saveExtractionCacheChunk,
  saveReconciliationCacheResult: mocks.saveReconciliationCacheResult, updateCampaign: mocks.updateCampaign,
}));
vi.mock("@/lib/ai/extract", () => ({ extractChunksLimited: mocks.extractChunksLimited }));
vi.mock("@/lib/ai/reconcile", () => ({ reconcileGroupsWithAI: mocks.reconcileGroupsWithAI }));
vi.mock("@/lib/ai/enrich", () => ({ EnrichmentFailure: class EnrichmentFailure extends Error { usage = []; }, enrichCanonicalGraphWithAI: mocks.enrichCanonicalGraphWithAI }));
vi.mock("@/lib/ai/enrichment-input", () => ({ enrichmentGraphFingerprint: () => "fixture-fingerprint" }));
vi.mock("@/lib/ai/enrichment-schemas", () => ({ parseCampaignEnrichmentOutput: (value: unknown) => value }));
vi.mock("@/lib/graph/aggregate", () => ({ aggregateCandidates: mocks.aggregateCandidates }));
vi.mock("@/lib/graph/build", () => ({ buildCanonicalGraph: mocks.buildCanonicalGraph }));
vi.mock("@/lib/graph/reconcile", () => ({ buildDeterministicGroups: mocks.buildDeterministicGroups }));
vi.mock("@/lib/env", () => ({
  getProcessingEnv: () => ({ PDF_CHUNK_TARGET_CHARACTERS: 5000 }),
  getOpenAIEnv: () => ({ OPENAI_EXTRACTION_MODEL: "extract-model" }),
  getAIProviderConfig: mocks.getAIProviderConfig,
  assertAIProviderPersistenceAllowed: mocks.assertAIProviderPersistenceAllowed,
}));
vi.mock("@/lib/ai/structured-model-provider-runtime", () => ({ getStructuredModelProvider: mocks.getStructuredModelProvider }));

import { processCampaign } from "@/lib/processing/process-campaign";

const source = { page_number: 1, supporting_text: "Mira is a hunter." };
const canonicalGraph: CanonicalGraph = {
  entities: [{ key: "mira", name: "Mira", normalizedName: "mira", type: "npc", roles: [], roleSources: {}, aliases: [], summary: "A hunter.", sources: [source], candidateIds: ["candidate"], reconciliationEvidence: [source], mergeReason: "deterministic" }],
  facts: [{ entityKey: "mira", stableKey: "job", fieldKey: "occupation", content: "Hunter", evidence: [{ pageNumber: 1, supportingText: "Mira is a hunter." }] }],
  relationships: [], factAggregationDiagnostics: { candidateFactCount: 1, canonicalFactCount: 1, deduplicatedFactCount: 0, factEvidenceCount: 1 },
  discardedRelationships: [], locationHierarchyDiagnostics: [], candidateToCanonical: new Map([["candidate", "mira"]]),
};
const usage = { stage: "enrichment", model: "model", responseId: "response", apiCalls: 1, inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1, totalTokens: 2, estimatedCostUsd: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.finishExtractionCacheRun.mockResolvedValue(undefined);
  mocks.finishEnrichmentCacheRun.mockResolvedValue(undefined);
  mocks.persistCanonicalGraph.mockResolvedValue({});
  mocks.recordProcessingRun.mockResolvedValue(undefined);
  mocks.saveExtractionCacheChunk.mockResolvedValue(undefined);
  mocks.saveReconciliationCacheResult.mockResolvedValue(undefined);
  mocks.updateCampaign.mockResolvedValue(undefined);
  mocks.loadCampaignForProcessing.mockResolvedValue({ campaign: { status: "uploaded" }, document: { id: "document" }, pages: [{ pageNumber: 1, text: "Mira is a hunter." }] });
  mocks.claimCampaignForProcessing.mockResolvedValue(true);
  mocks.createExtractionCacheRun.mockResolvedValue("extraction-cache");
  mocks.createEnrichmentCacheRun.mockResolvedValue("enrichment-cache");
  mocks.extractChunksLimited.mockResolvedValue([{ chunkId: "chunk", extraction: { entities: [], relationships: [] }, diagnostics: [], usage }]);
  mocks.aggregateCandidates.mockReturnValue({ entities: [], relationships: [] });
  mocks.buildDeterministicGroups.mockReturnValue([]);
  mocks.reconcileGroupsWithAI.mockResolvedValue({ decision: undefined, usage });
  mocks.buildCanonicalGraph.mockReturnValue(canonicalGraph);
  mocks.loadCompleteEnrichmentCache.mockResolvedValue(null);
  mocks.getAIProviderConfig.mockReturnValue({ providerId: "openai", modelId: "model" });
  mocks.getStructuredModelProvider.mockImplementation((stage: string) => ({ providerId: "openai", modelId: `${stage}-model`, parseStructured: vi.fn() }));
  mocks.enrichCanonicalGraphWithAI.mockResolvedValue({ graph: { ...canonicalGraph, entities: canonicalGraph.entities.map((entity) => ({ ...entity, visibility: "player_visible", prominence: "major" })) }, output: {}, usage: [usage] });
});

describe("v0.4 processing orchestration", () => {
  it("uses lean by default, persists safe canonical data, and completes without resolving enrichment", async () => {
    const result = await processCampaign("campaign");
    expect(mocks.getAIProviderConfig).toHaveBeenCalledWith("extraction");
    expect(mocks.getAIProviderConfig).toHaveBeenCalledWith("reconciliation");
    expect(mocks.getAIProviderConfig).not.toHaveBeenCalledWith("enrichment");
    expect(mocks.enrichCanonicalGraphWithAI).not.toHaveBeenCalled();
    expect(mocks.createEnrichmentCacheRun).not.toHaveBeenCalled();
    expect(mocks.persistCanonicalGraph).toHaveBeenCalledWith("campaign", "document", expect.objectContaining({ entities: [expect.objectContaining({ visibility: "dm_only", prominence: null, playerSummary: null })] }));
    expect(result).toMatchObject({ processingMode: "lean", enrichmentRequired: false, enrichmentCalls: 0, openAIGenerationCallsAfterReconciliation: 0, graphFingerprint: "fixture-fingerprint" });
    const completeCall = mocks.updateCampaign.mock.calls.find(([, values]) => values.status === "complete");
    expect(completeCall).toBeDefined();
    expect(mocks.persistCanonicalGraph.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateCampaign.mock.invocationCallOrder.at(-1)!);
  });

  it("keeps full mode explicit and preserves the strict enrichment path", async () => {
    const result = await processCampaign("campaign", { processingMode: "full" });
    expect(mocks.getAIProviderConfig).toHaveBeenCalledWith("enrichment");
    expect(mocks.assertAIProviderPersistenceAllowed).toHaveBeenCalled();
    expect(mocks.enrichCanonicalGraphWithAI).toHaveBeenCalledWith(canonicalGraph);
    expect(mocks.createEnrichmentCacheRun).toHaveBeenCalled();
    expect(result).toMatchObject({ processingMode: "full", enrichmentRequired: true, enrichmentCalls: 1, openAIGenerationCallsAfterReconciliation: 1 });
  });

  it("runs a local lean import through local core providers without touching the enrichment/OpenAI path", async () => {
    mocks.getAIProviderConfig.mockImplementation((stage: string) => ({ providerId: "local", modelId: `${stage}-local`, baseUrl: "http://localhost:11434/v1", allowPersistence: true }));
    mocks.getStructuredModelProvider.mockImplementation((stage: string) => ({ providerId: "local", modelId: `${stage}-local`, parseStructured: vi.fn() }));
    const result = await processCampaign("campaign");
    expect(mocks.extractChunksLimited.mock.calls[0][3]).toMatchObject({ providerId: "local", modelId: "extraction-local" });
    expect(mocks.reconcileGroupsWithAI.mock.calls[0][1]).toMatchObject({ providerId: "local", modelId: "reconciliation-local" });
    expect(mocks.getAIProviderConfig).not.toHaveBeenCalledWith("enrichment");
    expect(mocks.enrichCanonicalGraphWithAI).not.toHaveBeenCalled();
    expect(result).toMatchObject({ processingMode: "lean", enrichmentCalls: 0, openAIGenerationCallsAfterReconciliation: 0 });
  });

  it("marks persistence failures failed and never marks the campaign complete", async () => {
    mocks.persistCanonicalGraph.mockRejectedValueOnce(new Error("transaction failed"));
    await expect(processCampaign("campaign")).rejects.toThrow("transaction failed");
    expect(mocks.updateCampaign.mock.calls.some(([, values]) => values.status === "complete")).toBe(false);
    expect(mocks.updateCampaign).toHaveBeenCalledWith("campaign", expect.objectContaining({ status: "failed", error_message: "transaction failed" }));
  });
});
