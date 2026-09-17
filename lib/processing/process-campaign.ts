import "server-only";

import { extractChunksLimited, extractInventoryChunksLimited, planInventoryExtraction, planTwoPassExtraction } from "@/lib/ai/extract";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import { EnrichmentFailure, enrichCanonicalGraphWithAI } from "@/lib/ai/enrich";
import { enrichmentGraphFingerprint } from "@/lib/ai/enrichment-input";
import { parseCampaignEnrichmentOutput } from "@/lib/ai/enrichment-schemas";
import {
  claimCampaignForProcessing,
  createExtractionCacheRun,
  createEnrichmentCacheRun,
  finishExtractionCacheRun,
  finishEnrichmentCacheRun,
  loadCampaignForProcessing,
  loadCompleteEnrichmentCache,
  persistCanonicalGraph,
  recordProcessingRun,
  saveExtractionCacheChunk,
  saveReconciliationCacheResult,
  updateCampaign,
} from "@/lib/db/repository";
import { assertAIProviderPersistenceAllowed, getAIProviderConfig, getProcessingEnv } from "@/lib/env";
import { getStructuredModelProvider } from "@/lib/ai/structured-model-provider-runtime";
import { summarizeModelUsage, type ModelCallUsage } from "@/lib/ai/usage";
import type { Json } from "@/lib/db/types";
import { aggregateCandidates } from "@/lib/graph/aggregate";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { applyCampaignEnrichment, buildEnrichmentDiagnostics } from "@/lib/graph/enrichment";
import { applyLeanGraphDefaults, buildLeanDiagnostics } from "@/lib/graph/lean";
import { applyDeterministicProminence } from "@/lib/graph/prominence";
import type { CanonicalGraph } from "@/lib/graph/types";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { chunkPages } from "@/lib/pdf/chunk-pages";
import { resolveProcessingMode, type ProcessingMode } from "@/lib/processing/mode";
import { databaseCheckpointStore } from "@/lib/processing/checkpoint-store";
import { OpenAICallBudget, OpenAICallBudgetExceededError, withOpenAICallBudget } from "@/lib/ai/openai-call-budget";
import { buildFinalGraphInventory, buildLeanGraphCore, combineGraphPasses, graphAggregationCheckpointIdentity, planGraphCompleteness, planGraphFirstPass, reResolveGraphFirstPass, runGraphCompletenessLimited, runGraphFirstPassLimited } from "@/lib/processing/graph-core";
import { semanticInputHash } from "@/lib/ai/operation-checkpoint";
import { adjudicateDuplicateCandidates, applyEntityMerges, buildDuplicateCandidates, planDuplicateAdjudication } from "@/lib/ai/entity-reconciliation";

async function processLeanGraphCampaign(args: { campaignId: string; documentId: string; pages: import("@/lib/pdf/types").DocumentPage[]; startedAt: number }) {
  const { campaignId, documentId, pages, startedAt } = args;
  const checkpointStore = databaseCheckpointStore();
  const processingMode = "lean" as const;
  const budget = new OpenAICallBudget(getProcessingEnv().OPENAI_MAX_CALLS_PER_RUN ?? 40);
  const inventoryProvider = withOpenAICallBudget(getStructuredModelProvider("extraction_inventory"), budget);
  const graphExtractionProvider = withOpenAICallBudget(getStructuredModelProvider("graph_extraction"), budget);
  const entityReconciliationProvider = withOpenAICallBudget(getStructuredModelProvider("entity_reconciliation"), budget);
  const graphCompletenessProvider = withOpenAICallBudget(getStructuredModelProvider("graph_completeness"), budget);
  assertAIProviderPersistenceAllowed(getAIProviderConfig("extraction_inventory"));
  assertAIProviderPersistenceAllowed(getAIProviderConfig("graph_extraction"));
  assertAIProviderPersistenceAllowed(getAIProviderConfig("entity_reconciliation"));
  assertAIProviderPersistenceAllowed(getAIProviderConfig("graph_completeness"));
  const chunking = { targetCharacters: getProcessingEnv().PDF_CHUNK_TARGET_CHARACTERS, overlapPages: 1 };
  const chunks = chunkPages(pages, chunking);
  const extractionContext = { campaignId, documentId, processingMode, store: checkpointStore };
  const inventoryPlan = await planInventoryExtraction(chunks, { inventory: inventoryProvider }, extractionContext);
  const plannedInventoryCalls = inventoryPlan.filter((item) => item.status !== "REUSE" && inventoryProvider.providerId === "openai").length;
  if (!budget.allowPlanned(plannedInventoryCalls)) throw new OpenAICallBudgetExceededError(budget.maximumAttempts, plannedInventoryCalls);
  await recordProcessingRun(campaignId, "graph_inventory", "started", { input: { processingMode, pageCount: pages.length, chunkCount: chunks.length, checkpointPlan: inventoryPlan } as unknown as Json });
  const inventories = await extractInventoryChunksLimited(chunks, undefined, { inventory: inventoryProvider }, extractionContext);
  const finalInventory = buildFinalGraphInventory(inventories.map((item) => item.inventory));
  // Keep first-pass checkpoint identity compatible with the v0.4 inventory shape;
  // reconciliation-only aliases and additional provenance do not change its model input.
  const finalInventoryFingerprint = semanticInputHash({ entities: finalInventory.entities.map((entity) => ({ temporary_id: entity.temporary_id, name: entity.name, type: entity.type, sources: [entity.sources[0]] })) });
  const finalInventoryUpstreamFingerprint = semanticInputHash(inventories.map((item) => ({ chunkId: item.chunkId, inventory: item.inventory })));
  const graphContext = { campaignId, documentId, processingMode, store: checkpointStore, finalInventoryFingerprint, finalInventoryUpstreamFingerprint };
  const firstPassPlan = await planGraphFirstPass(chunks, finalInventory, graphExtractionProvider, graphContext);
  const plannedFirstPassCalls = firstPassPlan.filter((item) => item.status !== "REUSE" && graphExtractionProvider.providerId === "openai").length;
  if (!budget.allowPlanned(plannedFirstPassCalls)) throw new OpenAICallBudgetExceededError(budget.maximumAttempts, budget.usedAttempts + plannedFirstPassCalls);
  await recordProcessingRun(campaignId, "graph_inventory", "complete", { output: { finalInventoryEntities: finalInventory.entities.length, inventoryCacheHits: inventories.filter((item) => item.inventoryCheckpointStatus === "REUSE" && item.completenessCheckpointStatus === "REUSE").length } as unknown as Json });
  await updateCampaign(campaignId, { status: "reconciling", processing_stage: "Extracting campaign relationships" });
  await recordProcessingRun(campaignId, "graph_extraction", "started", { input: { chunkCount: chunks.length, finalInventoryFingerprint, checkpointPlan: firstPassPlan } as unknown as Json });
  const graphConcurrency = graphExtractionProvider.providerId === "local" || graphCompletenessProvider.providerId === "local" ? getProcessingEnv().LOCAL_AI_EXTRACTION_CONCURRENCY : getProcessingEnv().AI_EXTRACTION_CONCURRENCY;
  const rawFirstPass = await runGraphFirstPassLimited(chunks, finalInventory, graphExtractionProvider, graphContext, graphConcurrency);
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const rawChunks = rawFirstPass.map((result) => ({ chunkId: result.chunkId, raw: result.raw, validPages: chunkById.get(result.chunkId)?.pages.map((page) => page.pageNumber) }));
  const duplicateCandidates = buildDuplicateCandidates(finalInventory, rawChunks);
  const duplicateContext = { campaignId, documentId, processingMode, store: checkpointStore, sourceIdentity: semanticInputHash({ documentId, finalInventoryUpstreamFingerprint }) };
  const duplicatePlan = await planDuplicateAdjudication(finalInventory, duplicateCandidates, rawChunks, entityReconciliationProvider, duplicateContext);
  const plannedDuplicateCalls = duplicateCandidates.pairs.length && duplicatePlan.status !== "REUSE" && entityReconciliationProvider.providerId === "openai" ? 1 : 0;
  if (!budget.allowPlanned(plannedDuplicateCalls)) throw new OpenAICallBudgetExceededError(budget.maximumAttempts, budget.usedAttempts + plannedDuplicateCalls);
  const duplicateAdjudication = await adjudicateDuplicateCandidates(finalInventory, duplicateCandidates, rawChunks, entityReconciliationProvider, duplicateContext);
  const merged = applyEntityMerges(finalInventory, duplicateAdjudication.decision);
  const resolvedFirstPass = reResolveGraphFirstPass(rawFirstPass, chunks, merged.inventory);
  const mergedGraphContext = { ...graphContext, finalInventoryFingerprint: merged.fingerprint };
  const completenessPlan = await planGraphCompleteness(chunks, merged.inventory, resolvedFirstPass, graphCompletenessProvider, mergedGraphContext);
  const plannedCompletenessCalls = completenessPlan.filter((item) => item.status !== "REUSE" && graphCompletenessProvider.providerId === "openai").length;
  if (!budget.allowPlanned(plannedCompletenessCalls)) throw new OpenAICallBudgetExceededError(budget.maximumAttempts, budget.usedAttempts + plannedCompletenessCalls);
  const completeness = await runGraphCompletenessLimited(chunks, merged.inventory, resolvedFirstPass, graphCompletenessProvider, mergedGraphContext, graphConcurrency);
  const graphChunks = combineGraphPasses(resolvedFirstPass, completeness);
  const canonicalGraph = buildLeanGraphCore(merged.inventory, chunks, graphChunks);
  const aggregationIdentity = graphAggregationCheckpointIdentity(canonicalGraph, graphChunks, mergedGraphContext);
  const expectedKeys = canonicalGraph.relationships.map((relationship) => relationship.normalization.semanticType + ":" + relationship.sourceEntityKey + ":" + relationship.targetEntityKey).sort();
  const aggregation = await checkpointStore.load<{ relationshipKeys: string[] }>(aggregationIdentity);
  if (aggregation && JSON.stringify([...aggregation.output.relationshipKeys].sort()) !== JSON.stringify(expectedKeys)) await checkpointStore.saveFailed(aggregationIdentity, aggregation.usage, "Stored graph aggregation does not match deterministic graph", aggregation.attemptCount);
  if (!aggregation || JSON.stringify([...aggregation.output.relationshipKeys].sort()) !== JSON.stringify(expectedKeys)) await checkpointStore.saveValidated({ identity: aggregationIdentity, output: { relationshipKeys: expectedKeys }, usage: [], attemptCount: 1 });
  const graph = applyDeterministicProminence(applyLeanGraphDefaults(canonicalGraph), pages);
  const inventoryCalls = inventories.flatMap((item) => [item.inventoryCheckpointStatus === "RUN" ? item.initialInventoryUsage : null, item.completenessCheckpointStatus === "RUN" ? item.completenessUsage : null].filter((usage): usage is ModelCallUsage => usage !== null));
  const graphCalls = [...graphChunks.flatMap((item) => [item.firstPassUsage, item.completenessUsage].filter((usage): usage is ModelCallUsage => usage !== null)), ...(duplicateAdjudication.usage ? [duplicateAdjudication.usage] : [])];
  await recordProcessingRun(campaignId, "graph_extraction", "complete", { output: { finalInventoryEntities: finalInventory.entities.length, reconciledInventoryEntities: merged.inventory.entities.length, duplicateCandidatePairs: duplicateCandidates.pairs.length, duplicateMergeGroups: duplicateAdjudication.decision.merge_groups.length, duplicateReviewPairs: duplicateAdjudication.decision.review_pairs.length, duplicateAdjudicationCheckpointStatus: duplicateAdjudication.checkpointStatus, graphExtractionCacheHits: graphChunks.filter((item) => item.firstPassCheckpointStatus === "REUSE").length, graphCompletenessCacheHits: graphChunks.filter((item) => item.completenessCheckpointStatus === "REUSE").length, firstPassRelationships: graphChunks.reduce((count, item) => count + item.firstPass.length, 0), completenessRelationships: graphChunks.reduce((count, item) => count + item.completeness.length, 0), canonicalRelationships: graph.relationships.length, graphExtractionProvider: graphExtractionProvider.providerId, graphExtractionModel: graphExtractionProvider.modelId, entityReconciliationProvider: entityReconciliationProvider.providerId, entityReconciliationModel: entityReconciliationProvider.modelId, graphCompletenessProvider: graphCompletenessProvider.providerId, graphCompletenessModel: graphCompletenessProvider.modelId } as unknown as Json });
  await recordProcessingRun(campaignId, "enrichment", "complete", { output: { ...buildLeanDiagnostics(graph), mode: "not_part_of_graph_core", modelUsage: summarizeModelUsage("enrichment", []) } as unknown as Json });
  await updateCampaign(campaignId, { status: "persisting", processing_stage: "Building wiki" });
  await persistCanonicalGraph(campaignId, documentId, graph);
  const durationMs = Date.now() - startedAt;
  const diagnostics = { processingMode, pageCount: pages.length, chunkCount: chunks.length, finalInventoryEntities: finalInventory.entities.length, reconciledInventoryEntities: merged.inventory.entities.length, canonicalEntityCount: graph.entities.length, relationshipCount: graph.relationships.length, factCandidateCount: 0, canonicalFactCount: 0, graphExtractionCalls: graphChunks.filter((item) => item.firstPassCheckpointStatus === "RUN").length, duplicateAdjudicationCalls: duplicateAdjudication.checkpointStatus === "RUN" ? 1 : 0, graphCompletenessCalls: graphChunks.filter((item) => item.completenessCheckpointStatus === "RUN").length, graphExtractionProvider: `${graphExtractionProvider.providerId}:${graphExtractionProvider.modelId}`, entityReconciliationProvider: `${entityReconciliationProvider.providerId}:${entityReconciliationProvider.modelId}`, graphCompletenessProvider: `${graphCompletenessProvider.providerId}:${graphCompletenessProvider.modelId}`, modelUsage: [summarizeModelUsage("candidate_extraction", inventoryCalls), summarizeModelUsage("candidate_extraction", graphCalls)], durationMs };
  await updateCampaign(campaignId, { status: "complete", processing_stage: "Wiki generated", processing_diagnostics: diagnostics as unknown as Json });
  return diagnostics;
}

export async function processCampaign(campaignId: string, options: { processingMode?: ProcessingMode } = {}) {
  const startedAt = Date.now();
  const processingMode = resolveProcessingMode(options.processingMode);
  let ownsProcessing = false;
  let cacheRunId: string | undefined;
  let cacheComplete = false;
  try {
    const { campaign, document, pages } = await loadCampaignForProcessing(campaignId);
    if (campaign.status === "complete") return { alreadyComplete: true };
    if (!(["uploaded", "failed"] as string[]).includes(campaign.status)) throw new Error(`Campaign is already processing (${campaign.status})`);
    if (pages.length === 0) throw new Error("Campaign document has no extracted pages");

    if (!(await claimCampaignForProcessing(campaignId))) throw new Error("Campaign was claimed by another processing request");
    ownsProcessing = true;
    if (Boolean(processingMode === "lean")) return await processLeanGraphCampaign({ campaignId, documentId: document.id, pages, startedAt });
    const checkpointStore = databaseCheckpointStore();
    const openAIBudget = new OpenAICallBudget(getProcessingEnv().OPENAI_MAX_CALLS_PER_RUN ?? 40);
    const inventoryProvider = withOpenAICallBudget(getStructuredModelProvider("extraction_inventory"), openAIBudget);
    const richProvider = withOpenAICallBudget(getStructuredModelProvider("extraction_rich"), openAIBudget);
    const reconciliationProvider = withOpenAICallBudget(getStructuredModelProvider("reconciliation"), openAIBudget);
    assertAIProviderPersistenceAllowed(getAIProviderConfig("extraction_inventory"));
    assertAIProviderPersistenceAllowed(getAIProviderConfig("extraction_rich"));
    assertAIProviderPersistenceAllowed(getAIProviderConfig("reconciliation"));
    const chunking = { targetCharacters: getProcessingEnv().PDF_CHUNK_TARGET_CHARACTERS, overlapPages: 1 };
    const chunks = chunkPages(pages, chunking);
    const extractionCheckpointContext = { campaignId, documentId: document.id, processingMode, store: checkpointStore };
    const extractionPlan = await planTwoPassExtraction(chunks, { inventory: inventoryProvider, rich: richProvider }, extractionCheckpointContext);
    const plannedOpenAIExtractionCalls = extractionPlan.filter((item) => item.status !== "REUSE" && (item.operationType === "inventory" ? inventoryProvider.providerId : richProvider.providerId) === "openai").length;
    if (!openAIBudget.allowPlanned(plannedOpenAIExtractionCalls)) throw new OpenAICallBudgetExceededError(openAIBudget.maximumAttempts, plannedOpenAIExtractionCalls);
    cacheRunId = await createExtractionCacheRun(
      campaignId,
      document.id,
      `${inventoryProvider.providerId}:${inventoryProvider.modelId}|${richProvider.providerId}:${richProvider.modelId}`,
      { ...chunking, pageCount: pages.length, chunkCount: chunks.length },
    );
    await recordProcessingRun(campaignId, "candidate_extraction", "started", { input: { processingMode, pageCount: pages.length, chunkCount: chunks.length, inventoryOperations: chunks.length, richOperations: chunks.length, extractionOperations: chunks.length * 2, plannedOpenAIExtractionCalls, checkpointPlan: extractionPlan } as unknown as Json });
    const extracted = await extractChunksLimited(chunks, undefined, async (result, chunk, index) => {
      await saveExtractionCacheChunk(cacheRunId!, result, index, chunk.pages.map((page) => page.pageNumber));
    }, { inventory: inventoryProvider, rich: richProvider }, extractionCheckpointContext);
    await finishExtractionCacheRun(cacheRunId, "complete");
    cacheComplete = true;
    const rejectedSources = extracted.reduce((count, chunk) => count + chunk.diagnostics.length, 0);
    const aggregate = aggregateCandidates(extracted.map((chunk) => ({ chunkId: chunk.chunkId, ...chunk.extraction })));
    const inventoryCalls = extracted.filter((chunk) => chunk.inventoryCheckpointStatus !== "REUSE").map((chunk) => chunk.inventoryUsage);
    const richCalls = extracted.filter((chunk) => chunk.richCheckpointStatus !== "REUSE").map((chunk) => chunk.richUsage);
    const extractionCalls = [...inventoryCalls, ...richCalls];
    const extractionUsage = summarizeModelUsage("candidate_extraction", extractionCalls);
    await recordProcessingRun(campaignId, "candidate_extraction", "complete", {
      output: {
        mode: "live",
        processingMode,
        provider: inventoryProvider.providerId,
        inventoryModel: inventoryProvider.modelId,
        richModel: richProvider.modelId,
        inventoryCacheHits: extracted.filter((chunk) => chunk.inventoryCheckpointStatus === "REUSE").length,
        richCacheHits: extracted.filter((chunk) => chunk.richCheckpointStatus === "REUSE").length,
        cacheHits: extracted.filter((chunk) => chunk.inventoryCheckpointStatus === "REUSE").length + extracted.filter((chunk) => chunk.richCheckpointStatus === "REUSE").length,
        cacheMisses: extractionCalls.length,
        inventoryOperations: chunks.length,
        richOperations: chunks.length,
        extractionOperations: chunks.length * 2,
        inventoryEntities: extracted.reduce((count, chunk) => count + chunk.inventory.entities.length, 0),
        inventoryOutputBytes: extracted.reduce((count, chunk) => count + Buffer.byteLength(JSON.stringify(chunk.rawInventory), "utf8"), 0),
        richOutputBytes: extracted.reduce((count, chunk) => count + Buffer.byteLength(JSON.stringify(chunk.rawRichExtraction), "utf8"), 0),
        suspectedInventoryMisses: extracted.reduce((count, chunk) => count + chunk.richExtraction.suspected_inventory_misses.length, 0),
        inventoryModelUsage: summarizeModelUsage("candidate_extraction", inventoryCalls),
        richModelUsage: summarizeModelUsage("candidate_extraction", richCalls),
        entityCandidates: aggregate.entities.length,
        factCandidates: aggregate.entities.reduce((count, entity) => count + (entity.facts?.length ?? 0), 0),
        relationshipCandidates: aggregate.relationships.length,
        rejectedItems: rejectedSources,
        modelUsage: extractionUsage,
      } as unknown as Json,
    });

    await updateCampaign(campaignId, { status: "reconciling", processing_stage: "Connecting campaign information" });
    const groups = buildDeterministicGroups(aggregate);
    const reconciliation = await reconcileGroupsWithAI(groups, reconciliationProvider, { campaignId, documentId: document.id, sourceExtractionCacheId: cacheRunId, store: checkpointStore });
    await saveReconciliationCacheResult(cacheRunId, reconciliation);
    const canonicalGraph = buildCanonicalGraph(aggregate, reconciliation.decision);
    const reconciliationUsage = summarizeModelUsage("reconciliation", reconciliation.usage ? [reconciliation.usage] : []);
    await recordProcessingRun(campaignId, "reconciliation", "complete", {
      input: { candidateEntities: aggregate.entities.length, deterministicGroups: groups.length },
      output: {
        canonicalEntities: canonicalGraph.entities.length,
        processingMode,
        provider: reconciliationProvider.providerId,
        model: reconciliationProvider.modelId,
        ...canonicalGraph.factAggregationDiagnostics,
        resolvedRelationships: canonicalGraph.relationships.length,
        discardedRelationships: canonicalGraph.discardedRelationships.length,
        locationHierarchyDiagnostics: canonicalGraph.locationHierarchyDiagnostics,
        modelUsage: reconciliationUsage,
      } as unknown as Json,
    });

    const graphFingerprint = enrichmentGraphFingerprint(canonicalGraph);
    let graph: CanonicalGraph;
    let enrichmentCalls: ModelCallUsage[] = [];
    let enrichmentCheckpointReport: Array<{ status: "REUSE" | "RUN" }> = [];
    let openAIGenerationCallsAfterReconciliation = 0;
    let enrichmentDiagnostics: ReturnType<typeof buildEnrichmentDiagnostics> | ReturnType<typeof buildLeanDiagnostics>;
    if (processingMode === "lean") {
      graph = applyDeterministicProminence(applyLeanGraphDefaults(canonicalGraph), pages);
      enrichmentDiagnostics = buildLeanDiagnostics(graph);
      await recordProcessingRun(campaignId, "enrichment", "complete", { output: {
        ...enrichmentDiagnostics,
        mode: "skipped_by_processing_mode",
        cacheHits: 0,
        cacheMisses: 0,
        provider: null,
        model: null,
        modelUsage: summarizeModelUsage("enrichment", []),
      } as unknown as Json });
    } else {
      await updateCampaign(campaignId, { processing_stage: "Classifying campaign knowledge" });
      const enrichmentProvider = getAIProviderConfig("enrichment");
      assertAIProviderPersistenceAllowed(enrichmentProvider);
      const enrichmentStructuredProvider = withOpenAICallBudget(getStructuredModelProvider("enrichment"), openAIBudget);
      const enrichmentModel = enrichmentProvider.providerId === "openai" ? enrichmentProvider.modelId : `local:${enrichmentProvider.modelId}`;
      const cachedEnrichment = await loadCompleteEnrichmentCache(campaignId, document.id, graphFingerprint, enrichmentModel);
      let enrichmentMode: "live" | "replay" = "replay";
      if (cachedEnrichment?.output) {
        graph = applyCampaignEnrichment(canonicalGraph, parseCampaignEnrichmentOutput(cachedEnrichment.output));
      } else {
        enrichmentMode = "live";
        const enrichmentCacheId = await createEnrichmentCacheRun(campaignId, document.id, cacheRunId, enrichmentModel, graphFingerprint);
        try {
          const enriched = await enrichCanonicalGraphWithAI(canonicalGraph, { provider: enrichmentStructuredProvider, checkpointStore, checkpointContext: { campaignId, documentId: document.id, sourceExtractionCacheId: cacheRunId, processingMode: "full", providerId: enrichmentStructuredProvider.providerId, modelId: enrichmentStructuredProvider.modelId, graphFingerprint } });
          graph = enriched.graph;
          enrichmentCalls = enriched.usage;
          enrichmentCheckpointReport = enriched.checkpointReport ?? [];
          const usage = summarizeModelUsage("enrichment", enrichmentCalls);
          await finishEnrichmentCacheRun(enrichmentCacheId, "complete", enriched.output, usage as unknown as Json);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown enrichment failure";
          enrichmentCalls = error instanceof EnrichmentFailure ? error.usage : enrichmentCalls;
          await finishEnrichmentCacheRun(enrichmentCacheId, "failed", undefined, summarizeModelUsage("enrichment", enrichmentCalls) as unknown as Json, message).catch(() => undefined);
          throw error;
        }
      }
      graph = applyDeterministicProminence(graph, pages);
      enrichmentDiagnostics = buildEnrichmentDiagnostics(graph);
      const enrichmentUsage = summarizeModelUsage("enrichment", enrichmentCalls);
      openAIGenerationCallsAfterReconciliation = enrichmentProvider.providerId === "openai" ? enrichmentCalls.length : 0;
      await recordProcessingRun(campaignId, "enrichment", "complete", { output: {
        processingMode,
        enrichmentRequired: true,
        enrichmentCalls: enrichmentCalls.length,
        openAIGenerationCallsAfterReconciliation,
        mode: enrichmentMode,
        cacheHits: enrichmentMode === "replay" ? 1 : enrichmentCheckpointReport.filter((item) => item.status === "REUSE").length,
        cacheMisses: enrichmentMode === "live" ? enrichmentCalls.length : 0,
        modelUsage: enrichmentUsage,
        provider: enrichmentProvider.providerId,
        model: enrichmentProvider.modelId,
        ...enrichmentDiagnostics,
        checkpointReport: enrichmentCheckpointReport,
      } as unknown as Json });
    }
    const enrichmentUsage = summarizeModelUsage("enrichment", enrichmentCalls);

    await updateCampaign(campaignId, { status: "persisting", processing_stage: "Building wiki" });
    await persistCanonicalGraph(campaignId, document.id, graph);
    const durationMs = Date.now() - startedAt;
    const diagnostics = {
      pageCount: pages.length,
      chunkCount: chunks.length,
      candidateEntityCount: aggregate.entities.length,
      canonicalEntityCount: graph.entities.length,
      ...graph.factAggregationDiagnostics,
      relationshipCount: graph.relationships.length,
      discardedRelationshipCount: graph.discardedRelationships.length,
      locationHierarchyDiagnostics: graph.locationHierarchyDiagnostics,
      rejectedSourceCount: rejectedSources,
      modelUsage: [extractionUsage, reconciliationUsage, enrichmentUsage],
      knowledgeConsistencyDiagnostics: graph.knowledgeConsistencyDiagnostics,
      processingMode,
      enrichmentRequired: processingMode === "full",
      enrichmentCalls: enrichmentCalls.length,
      openAIGenerationCallsAfterReconciliation,
      graphFingerprint,
      enrichmentDiagnostics,
      mode: "live",
      inventoryCacheHits: extracted.filter((chunk) => chunk.inventoryCheckpointStatus === "REUSE").length,
      richCacheHits: extracted.filter((chunk) => chunk.richCheckpointStatus === "REUSE").length,
      cacheHits: extracted.filter((chunk) => chunk.inventoryCheckpointStatus === "REUSE").length + extracted.filter((chunk) => chunk.richCheckpointStatus === "REUSE").length,
      cacheMisses: extractionCalls.length,
      durationMs,
    };
    await updateCampaign(campaignId, { status: "complete", processing_stage: "Wiki generated", processing_diagnostics: diagnostics as unknown as Json });
    return diagnostics;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown campaign processing failure";
    if (cacheRunId && !cacheComplete) await finishExtractionCacheRun(cacheRunId, "failed", message).catch(() => undefined);
    if (ownsProcessing) {
      await updateCampaign(campaignId, { status: "failed", processing_stage: "Processing failed", error_message: message }).catch(() => undefined);
      await recordProcessingRun(campaignId, "pipeline", "failed", { input: { processingMode }, error: message });
    }
    throw error;
  }
}
