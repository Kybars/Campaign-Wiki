import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/ai/client";
import { buildExtractionInput, EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { chunkExtractionSchema, type ChunkExtraction } from "@/lib/ai/schemas";
import { validateChunkExtraction, type ValidationDiagnostic } from "@/lib/ai/source-validation";
import { modelCallUsage, type ModelCallUsage } from "@/lib/ai/usage";
import { getOpenAIEnv } from "@/lib/env";
import type { PageChunk } from "@/lib/pdf/types";

export interface ExtractedChunk {
  chunkId: string;
  rawExtraction: ChunkExtraction;
  extraction: ChunkExtraction;
  diagnostics: ValidationDiagnostic[];
  usage: ModelCallUsage;
}

export async function extractChunk(chunk: PageChunk): Promise<ExtractedChunk> {
  const env = getOpenAIEnv();
  const response = await getOpenAIClient().responses.parse({
    model: env.OPENAI_EXTRACTION_MODEL,
    input: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: buildExtractionInput(chunk) },
    ],
    text: { format: zodTextFormat(chunkExtractionSchema, "campaign_chunk_extraction") },
  });
  if (!response.output_parsed) throw new Error(`Model returned no parsed extraction for ${chunk.id}`);
  const validated = validateChunkExtraction(response.output_parsed, chunk.pages);
  return {
    chunkId: chunk.id,
    rawExtraction: response.output_parsed,
    ...validated,
    usage: modelCallUsage(response.model, response.id, response.usage),
  };
}

export async function extractChunksLimited(
  chunks: PageChunk[],
  concurrency = getOpenAIEnv().AI_EXTRACTION_CONCURRENCY,
  onExtracted?: (result: ExtractedChunk, chunk: PageChunk, index: number) => Promise<void>,
) {
  const results = new Array<ExtractedChunk>(chunks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      const result = await extractChunk(chunks[index]);
      if (onExtracted) await onExtracted(result, chunks[index], index);
      results[index] = result;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
  return results;
}
