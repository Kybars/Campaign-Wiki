import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const size = (value: unknown) => {
  const serialized = JSON.stringify(value ?? null);
  return { characters: serialized.length, utf8Bytes: Buffer.byteLength(serialized, "utf8") };
};

async function main() {
  const { preflightCachedRecovery, TEST_THREE_CAMPAIGN_ID } = await import("@/lib/processing/recover-campaign");
  const { cache, aggregate, graphFingerprint } = await preflightCachedRecovery(TEST_THREE_CAMPAIGN_ID, { processingMode: "lean" });
  const chunks = cache.chunks.map((chunk) => {
    const raw = chunk.raw_output;
    const validated = chunk.validated_output as { entities?: Array<{ facts?: unknown[]; aliases?: unknown[]; sources?: unknown[] }>; relationships?: Array<{ sources?: unknown[] }> };
    return { chunk: chunk.chunk_index + 1, raw: size(raw), validated: size(validated), candidates: { entities: validated.entities?.length ?? 0, facts: validated.entities?.reduce((sum, entity) => sum + (entity.facts?.length ?? 0), 0) ?? 0, relationships: validated.relationships?.length ?? 0 } };
  });
  const validatedOutputs = cache.chunks.map((chunk) => chunk.validated_output as { entities?: Array<{ facts?: unknown[]; aliases?: unknown[]; sources?: unknown[] }>; relationships?: Array<{ sources?: unknown[] }> });
  const collections = {
    entities: size(validatedOutputs.flatMap((output) => output.entities ?? [])),
    facts: size(validatedOutputs.flatMap((output) => (output.entities ?? []).flatMap((entity) => entity.facts ?? []))),
    relationships: size(validatedOutputs.flatMap((output) => output.relationships ?? [])),
    aliases: size(validatedOutputs.flatMap((output) => (output.entities ?? []).flatMap((entity) => entity.aliases ?? []))),
    evidence: size(validatedOutputs.flatMap((output) => [
      ...(output.entities ?? []).flatMap((entity) => [...(entity.sources ?? []), ...(entity.facts ?? []).flatMap((fact) => (fact as { sources?: unknown[] }).sources ?? [])]),
      ...(output.relationships ?? []).flatMap((relationship) => relationship.sources ?? []),
    ])),
    validationDiagnostics: size(cache.chunks.flatMap((chunk) => Array.isArray(chunk.validation_diagnostics) ? chunk.validation_diagnostics : [])),
  };
  const total = (field: "characters" | "utf8Bytes", kind: "raw" | "validated") => chunks.reduce((sum, chunk) => sum + chunk[kind][field], 0);
  const largest = [...chunks].sort((left, right) => right.validated.utf8Bytes - left.validated.utf8Bytes)[0];
  console.log(JSON.stringify({ mode: "read-only cached Test 3 extraction workload", writes: 0, modelCalls: 0, chunkCount: chunks.length, entityCandidates: aggregate.entities.length, factCandidates: aggregate.entities.reduce((sum, entity) => sum + (entity.facts?.length ?? 0), 0), relationshipCandidates: aggregate.relationships.length, graphFingerprint, serializedOutput: { raw: { characters: total("characters", "raw"), utf8Bytes: total("utf8Bytes", "raw") }, validated: { characters: total("characters", "validated"), utf8Bytes: total("utf8Bytes", "validated") }, averageValidatedUtf8BytesPerChunk: Math.round(total("utf8Bytes", "validated") / chunks.length), largestValidatedChunk: largest }, collections, chunks }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
