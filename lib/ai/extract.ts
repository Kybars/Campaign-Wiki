import { buildExtractionInput, EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { chunkExtractionSchema, type ChunkExtraction } from "@/lib/ai/schemas";
import { validateChunkExtraction, type ValidationDiagnostic } from "@/lib/ai/source-validation";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { getProcessingEnv } from "@/lib/env";
import type { PageChunk } from "@/lib/pdf/types";

export interface ExtractedChunk {
  chunkId: string;
  rawExtraction: ChunkExtraction;
  extraction: ChunkExtraction;
  diagnostics: ValidationDiagnostic[];
  usage: ModelCallUsage;
}

export async function extractChunk(chunk: PageChunk, provider?: StructuredModelProvider): Promise<ExtractedChunk> {
  const resolvedProvider = provider ?? (await import("@/lib/ai/structured-model-provider-runtime")).getStructuredModelProvider("extraction");
  const response = await resolvedProvider.parseStructured({ system: EXTRACTION_SYSTEM_PROMPT, payload: buildExtractionInput(chunk), schema: chunkExtractionSchema, schemaName: "campaign_chunk_extraction" });
  const validated = validateChunkExtraction(response.output, chunk.pages);
  return {
    chunkId: chunk.id,
    rawExtraction: response.output,
    ...validated,
    usage: response.usage,
  };
}

export async function extractChunksLimited(
  chunks: PageChunk[],
  concurrency?: number,
  onExtracted?: (result: ExtractedChunk, chunk: PageChunk, index: number) => Promise<void>,
  provider?: StructuredModelProvider,
) {
  const resolvedProvider = provider ?? (await import("@/lib/ai/structured-model-provider-runtime")).getStructuredModelProvider("extraction");
  const configuredConcurrency = concurrency ?? (resolvedProvider.providerId === "local" ? getProcessingEnv().LOCAL_AI_EXTRACTION_CONCURRENCY : getProcessingEnv().AI_EXTRACTION_CONCURRENCY);
  const results = new Array<ExtractedChunk>(chunks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      const result = await extractChunk(chunks[index], resolvedProvider);
      if (onExtracted) await onExtracted(result, chunks[index], index);
      results[index] = result;
    }
  }
  await Promise.all(Array.from({ length: Math.min(configuredConcurrency, chunks.length) }, () => worker()));
  return results;
}
