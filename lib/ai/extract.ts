import { buildExtractionInput, EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { chunkExtractionSchema, type ChunkExtraction } from "@/lib/ai/schemas";
import { validateChunkExtraction, type ValidationDiagnostic } from "@/lib/ai/source-validation";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { getProcessingEnv } from "@/lib/env";
import type { PageChunk } from "@/lib/pdf/types";
import { EXTRACTION_BEHAVIOR_VERSION, EXTRACTION_CONTRACT_VERSION, modelInputHash, semanticInputHash, type AIOperationCheckpointStore, type AIOperationIdentity } from "@/lib/ai/operation-checkpoint";

export interface ExtractedChunk {
  chunkId: string;
  rawExtraction: ChunkExtraction;
  extraction: ChunkExtraction;
  diagnostics: ValidationDiagnostic[];
  usage: ModelCallUsage;
  checkpointStatus?: "REUSE" | "RUN";
}

export interface ExtractionCheckpointContext {
  campaignId: string;
  documentId: string;
  processingMode: string;
  store: AIOperationCheckpointStore;
}

export async function extractChunk(chunk: PageChunk, provider?: StructuredModelProvider, checkpoint?: ExtractionCheckpointContext): Promise<ExtractedChunk> {
  const resolvedProvider = provider ?? (await import("@/lib/ai/structured-model-provider-runtime")).getStructuredModelProvider("extraction");
  const payload = buildExtractionInput(chunk);
  const identity: AIOperationIdentity | undefined = checkpoint ? {
    campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null,
    providerId: resolvedProvider.providerId, modelId: resolvedProvider.modelId, processingMode: "core",
    stage: "extraction", operationType: "chunk", operationKey: chunk.id,
    inputHash: modelInputHash(EXTRACTION_SYSTEM_PROMPT, payload), upstreamFingerprint: semanticInputHash(chunk.pages),
    behaviorVersion: EXTRACTION_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_CONTRACT_VERSION,
  } : undefined;
  if (identity) {
    const cached = await checkpoint!.store.load<{ rawExtraction: ChunkExtraction; extraction: ChunkExtraction; diagnostics: ValidationDiagnostic[] }>(identity);
    if (cached) {
      const rawExtraction = chunkExtractionSchema.parse(cached.output.rawExtraction);
      const validated = validateChunkExtraction(rawExtraction, chunk.pages);
      return { chunkId: chunk.id, rawExtraction, ...validated, usage: cached.usage[0] ?? { model: resolvedProvider.modelId, responseId: null, inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null }, checkpointStatus: "REUSE" };
    }
  }
  const response = await resolvedProvider.parseStructured({ system: EXTRACTION_SYSTEM_PROMPT, payload, schema: chunkExtractionSchema, schemaName: "campaign_chunk_extraction" }).catch(async (error) => {
    if (identity) await checkpoint!.store.saveFailed(identity, [], error instanceof Error ? error.message : "Extraction provider failure", 1);
    throw error;
  });
  let validated;
  try { validated = validateChunkExtraction(response.output, chunk.pages); }
  catch (error) {
    if (identity) await checkpoint!.store.saveFailed(identity, [response.usage], error instanceof Error ? error.message : "Invalid extraction output", 1);
    throw error;
  }
  if (identity) await checkpoint!.store.saveValidated({ identity, output: { rawExtraction: response.output, extraction: validated.extraction, diagnostics: validated.diagnostics }, usage: [response.usage], attemptCount: 1 });
  return {
    chunkId: chunk.id,
    rawExtraction: response.output,
    ...validated,
    usage: response.usage,
    checkpointStatus: "RUN",
  };
}

export async function extractChunksLimited(
  chunks: PageChunk[],
  concurrency?: number,
  onExtracted?: (result: ExtractedChunk, chunk: PageChunk, index: number) => Promise<void>,
  provider?: StructuredModelProvider,
  checkpoint?: ExtractionCheckpointContext,
) {
  const resolvedProvider = provider ?? (await import("@/lib/ai/structured-model-provider-runtime")).getStructuredModelProvider("extraction");
  const configuredConcurrency = concurrency ?? (resolvedProvider.providerId === "local" ? getProcessingEnv().LOCAL_AI_EXTRACTION_CONCURRENCY : getProcessingEnv().AI_EXTRACTION_CONCURRENCY);
  const results = new Array<ExtractedChunk>(chunks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      const result = await extractChunk(chunks[index], resolvedProvider, checkpoint);
      if (onExtracted) await onExtracted(result, chunks[index], index);
      results[index] = result;
    }
  }
  await Promise.all(Array.from({ length: Math.min(configuredConcurrency, chunks.length) }, () => worker()));
  return results;
}
