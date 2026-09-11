import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCampaignAndDocument: vi.fn(), loadLatestCompleteExtractionCache: vi.fn(),
  persistCanonicalGraph: vi.fn(), recordProcessingRun: vi.fn(), updateCampaign: vi.fn(),
  createEnrichmentCacheRun: vi.fn(), finishEnrichmentCacheRun: vi.fn(),
  getAIProviderConfig: vi.fn(), assertAIProviderPersistenceAllowed: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/repository", () => ({
  loadCampaignAndDocument: mocks.loadCampaignAndDocument,
  loadLatestCompleteExtractionCache: mocks.loadLatestCompleteExtractionCache,
  persistCanonicalGraph: mocks.persistCanonicalGraph,
  recordProcessingRun: mocks.recordProcessingRun,
  updateCampaign: mocks.updateCampaign,
  createEnrichmentCacheRun: mocks.createEnrichmentCacheRun,
  finishEnrichmentCacheRun: mocks.finishEnrichmentCacheRun,
}));
vi.mock("@/lib/env", () => ({
  getAIProviderConfig: mocks.getAIProviderConfig,
  assertAIProviderPersistenceAllowed: mocks.assertAIProviderPersistenceAllowed,
}));

import { recoverCampaignFromCachedExtraction } from "@/lib/processing/recover-campaign";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCampaignAndDocument.mockResolvedValue({ campaign: { name: "Fixture", status: "failed" }, document: { id: "document" } });
  mocks.loadLatestCompleteExtractionCache.mockResolvedValue({
    run: { id: "cache", document_id: "document", cache_schema_version: 4, chunking_metadata: { chunkCount: 1 } },
    chunks: [{ chunk_index: 0, chunk_id: "chunk", validated_output: { entities: [{ temporary_id: "mira", name: "Mira", type: "npc", roles: [], aliases: [], summary: "A hunter.", sources: [{ page_number: 1, supporting_text: "Mira is a hunter." }], facts: [{ temporary_id: "job", field_key: "occupation", content: "Hunter", sources: [{ page_number: 1, supporting_text: "Mira is a hunter." }] }] }], relationships: [] } }],
    reconciliation: { decision: { canonical_entities: [] } },
  });
});

describe("v0.4 lean cached recovery", () => {
  it("dry-runs from rich extraction and reconciliation caches with no writes, provider resolution, or model calls", async () => {
    const report = await recoverCampaignFromCachedExtraction("fixture-campaign", { processingMode: "lean" });
    expect(report).toMatchObject({ processingMode: "lean", extraction: "REUSE", reconciliation: "REUSE", extractionApiCalls: 0, reconciliationApiCalls: 0, expectedEnrichmentCalls: 0, plannedEnrichmentCalls: 0, plannedOpenAICalls: 0, plannedLocalCalls: 0, canonicalEntities: 1, canonicalFacts: 1, canonicalRelationships: 0, persistence: "dry-run; no writes or model calls" });
    expect(report.graphFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.getAIProviderConfig).not.toHaveBeenCalled();
    expect(mocks.persistCanonicalGraph).not.toHaveBeenCalled();
    expect(mocks.recordProcessingRun).not.toHaveBeenCalled();
    expect(mocks.updateCampaign).not.toHaveBeenCalled();
    expect(mocks.createEnrichmentCacheRun).not.toHaveBeenCalled();
  });
});
