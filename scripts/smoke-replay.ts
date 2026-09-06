import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  // A successful smoke test with this unusable key proves the default replay path
  // never reaches the OpenAI client. The fetch guard below makes that explicit too.
  process.env.OPENAI_API_KEY = "milestone-zero-smoke-test-must-not-be-used";

  const [{ createAdminClient }, repository, replay, graph] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repository"),
    import("@/lib/processing/replay-campaign"),
    import("@/lib/processing/replay-cache"),
  ]);
  const { buildDeterministicGroups } = await import("@/lib/graph/reconcile");

  const client = createAdminClient();
  const campaignId = randomUUID();
  const documentId = randomUUID();
  const sourceText = "Hanna Stone owns the Silver Stag Inn in Greymoor.";
  const extraction = {
    entities: [
      {
        temporary_id: "hanna",
        name: "Hanna Stone",
        type: "npc" as const,
        roles: [],
        aliases: [],
        summary: "The owner of the Silver Stag Inn.",
        sources: [{ page_number: 1, supporting_text: sourceText }],
      },
      {
        temporary_id: "inn",
        name: "Silver Stag Inn",
        type: "location" as const,
        roles: [],
        aliases: [],
        summary: "An inn owned by Hanna Stone.",
        sources: [{ page_number: 1, supporting_text: sourceText }],
      },
    ],
    relationships: [{
      source_temporary_id: "hanna",
      target_temporary_id: "inn",
      relationship_type: "owns",
      description: sourceText,
      confidence: 0.99,
      sources: [{ page_number: 1, supporting_text: sourceText }],
    }],
  };

  let openAIRequests = 0;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url);
    if (url.hostname === "api.openai.com") {
      openAIRequests += 1;
      throw new Error("Smoke test blocked an unexpected OpenAI request");
    }
    return nativeFetch(input, init);
  };

  try {
    const campaignInsert = await client.from("campaigns").insert({
      id: campaignId,
      name: `Milestone 0 replay smoke ${campaignId.slice(0, 8)}`,
      status: "complete",
      processing_stage: "Seeded replay smoke test",
    });
    if (campaignInsert.error) throw new Error(`Seed campaign: ${campaignInsert.error.message}`);

    const documentInsert = await client.from("documents").insert({
      id: documentId,
      campaign_id: campaignId,
      filename: "milestone-zero-smoke.pdf",
      storage_path: `smoke-tests/${campaignId}/${documentId}.pdf`,
      page_count: 1,
    });
    if (documentInsert.error) throw new Error(`Seed document: ${documentInsert.error.message}`);

    const pageInsert = await client.from("document_pages").insert({
      document_id: documentId,
      page_number: 1,
      text: sourceText,
    });
    if (pageInsert.error) throw new Error(`Seed document page: ${pageInsert.error.message}`);

    const cacheRunId = await repository.createExtractionCacheRun(
      campaignId,
      documentId,
      "seeded-no-openai",
      { source: "deterministic-smoke-test", chunkCount: 1, pageCount: 1 },
    );
    await repository.saveExtractionCacheChunk(cacheRunId, {
      chunkId: "chunk-1",
      rawExtraction: extraction,
      extraction,
      diagnostics: [],
      usage: {
        model: "seeded-no-openai",
        responseId: null,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    }, 0, [1]);
    await repository.finishExtractionCacheRun(cacheRunId, "complete");

    const aggregate = graph.aggregateCachedChunks([{ chunk_id: "chunk-1", validated_output: extraction }]);
    const groups = buildDeterministicGroups(aggregate);
    await repository.saveReconciliationCacheResult(cacheRunId, {
      decision: {
        canonical_entities: groups.map((group, index) => ({
          canonical_id: `canonical-${index + 1}`,
          name: group.candidates[0].name,
          group_ids: [group.id],
          type: group.type,
          roles: group.candidates[0].roles,
          aliases: group.candidates[0].aliases,
          summary: group.candidates[0].summary,
          identity_evidence: [],
        })),
      },
      usage: undefined,
    });

    const cachedBeforeReplay = await client.from("extraction_cache_chunks")
      .select("raw_output,validated_output")
      .eq("cache_run_id", cacheRunId)
      .single();
    if (cachedBeforeReplay.error) throw new Error(`Read extraction cache: ${cachedBeforeReplay.error.message}`);
    assert(isDeepStrictEqual(cachedBeforeReplay.data.raw_output, extraction), "Persisted raw extraction does not match the seeded output");
    assert(isDeepStrictEqual(cachedBeforeReplay.data.validated_output, extraction), "Persisted validated extraction does not match the seeded output");

    const replayResult = await replay.replayCampaignFromCache(campaignId);
    assert(replayResult.extractionApiCalls === 0, "Replay reported an extraction API call");
    assert(replayResult.reconciliationApiCalls === 0, "Replay reported a reconciliation API call");
    assert(openAIRequests === 0, `Replay attempted ${openAIRequests} OpenAI request(s)`);

    const [entityIds, relationshipIds] = await Promise.all([
      client.from("entities").select("id").eq("campaign_id", campaignId),
      client.from("relationships").select("id").eq("campaign_id", campaignId),
    ]);
    if (entityIds.error || !entityIds.data) throw new Error(`Load replay entity IDs: ${entityIds.error?.message ?? "no data"}`);
    if (relationshipIds.error || !relationshipIds.data) throw new Error(`Load replay relationship IDs: ${relationshipIds.error?.message ?? "no data"}`);

    const [entities, relationships, entitySources, relationshipSources, replayRuns] = await Promise.all([
      client.from("entities").select("name,type").eq("campaign_id", campaignId).order("name"),
      client.from("relationships").select("relationship_type,description").eq("campaign_id", campaignId),
      client.from("entity_sources").select("page_number,supporting_text").in(
        "entity_id",
        entityIds.data.map((row) => row.id),
      ),
      client.from("relationship_sources").select("page_number,supporting_text").in(
        "relationship_id",
        relationshipIds.data.map((row) => row.id),
      ),
      client.from("processing_runs").select("status,output_metadata").eq("campaign_id", campaignId).eq("stage", "replay"),
    ]);
    if (entities.error || !entities.data) throw new Error(`Verify replay entities: ${entities.error?.message ?? "no data"}`);
    if (relationships.error || !relationships.data) throw new Error(`Verify replay relationships: ${relationships.error?.message ?? "no data"}`);
    if (entitySources.error || !entitySources.data) throw new Error(`Verify entity sources: ${entitySources.error?.message ?? "no data"}`);
    if (relationshipSources.error || !relationshipSources.data) throw new Error(`Verify relationship sources: ${relationshipSources.error?.message ?? "no data"}`);
    if (replayRuns.error || !replayRuns.data) throw new Error(`Verify replay diagnostics: ${replayRuns.error?.message ?? "no data"}`);
    assert(entities.data.length === 2, `Expected 2 canonical entities, found ${entities.data.length}`);
    assert(relationships.data.length === 1, `Expected 1 relationship, found ${relationships.data.length}`);
    assert(entitySources.data.length === 2, `Expected 2 entity sources, found ${entitySources.data.length}`);
    assert(relationshipSources.data.length === 1, `Expected 1 relationship source, found ${relationshipSources.data.length}`);
    assert(replayRuns.data.some((run) => run.status === "complete"), "Replay completion diagnostic was not persisted");

    console.log(JSON.stringify({
      ok: true,
      rawExtractionPersisted: true,
      replayExtractionApiCalls: replayResult.extractionApiCalls,
      replayReconciliationApiCalls: replayResult.reconciliationApiCalls,
      observedOpenAIRequests: openAIRequests,
      canonicalEntities: entities.data.map((entity) => `${entity.name}:${entity.type}`),
      relationships: relationships.data.map((relationship) => relationship.relationship_type),
      sourceCounts: { entities: entitySources.data.length, relationships: relationshipSources.data.length },
    }, null, 2));
  } finally {
    globalThis.fetch = nativeFetch;
    const cleanup = await client.from("campaigns").delete().eq("id", campaignId);
    if (cleanup.error) throw new Error(`Clean up smoke campaign ${campaignId}: ${cleanup.error.message}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
