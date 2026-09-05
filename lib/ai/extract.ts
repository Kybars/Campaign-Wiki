import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/ai/client";
import { buildExtractionInput, EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { chunkExtractionSchema, type ChunkExtraction } from "@/lib/ai/schemas";
import { validateChunkExtraction, type ValidationDiagnostic } from "@/lib/ai/source-validation";
import { getOpenAIEnv } from "@/lib/env";
import type { PageChunk } from "@/lib/pdf/types";

export interface ExtractedChunk {
  chunkId: string;
  extraction: ChunkExtraction;
  diagnostics: ValidationDiagnostic[];
}

export async function extractChunk(chunk: PageChunk): Promise<ExtractedChunk> {
  const env = getOpenAIEnv();
  const response = await getOpenAIClient().responses.parse({
    model: env.OPENAI_MODEL,
    input: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: buildExtractionInput(chunk) },
    ],
    text: { format: zodTextFormat(chunkExtractionSchema, "campaign_chunk_extraction") },
  });
  if (!response.output_parsed) throw new Error(`Model returned no parsed extraction for ${chunk.id}`);
  const validated = validateChunkExtraction(response.output_parsed, chunk.pages);
  return { chunkId: chunk.id, ...validated };
}

export async function extractChunksLimited(chunks: PageChunk[], concurrency = getOpenAIEnv().AI_EXTRACTION_CONCURRENCY) {
  const results = new Array<ExtractedChunk>(chunks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await extractChunk(chunks[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
  return results;
}
