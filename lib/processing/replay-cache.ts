import { chunkExtractionSchema, reconciliationDecisionSchema, type ReconciliationDecision } from "@/lib/ai/schemas";
import type { Json } from "@/lib/db/types";
import { aggregateCandidates } from "@/lib/graph/aggregate";

export interface CachedChunkPayload {
  chunk_id: string;
  validated_output: Json;
}

export function aggregateCachedChunks(chunks: CachedChunkPayload[]) {
  if (chunks.length === 0) throw new Error("Extraction cache contains no chunks");
  return aggregateCandidates(chunks.map((chunk) => ({
    chunkId: chunk.chunk_id,
    ...chunkExtractionSchema.parse(chunk.validated_output),
  })));
}

export function parseCachedReconciliation(decision: Json): ReconciliationDecision | undefined {
  return decision === null ? undefined : reconciliationDecisionSchema.parse(decision);
}
