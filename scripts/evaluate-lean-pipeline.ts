import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const [{ preflightCachedRecovery, TEST_THREE_CAMPAIGN_ID }, { applyLeanGraphDefaults, buildLeanDiagnostics }] = await Promise.all([
    import("@/lib/processing/recover-campaign"),
    import("@/lib/graph/lean"),
  ]);
  const preflight = await preflightCachedRecovery(TEST_THREE_CAMPAIGN_ID, { processingMode: "lean" });
  const graph = applyLeanGraphDefaults(preflight.graph);
  const expectedFingerprint = "3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6";
  if (graph.entities.length !== 112 || graph.facts.length !== 502 || graph.relationships.length !== 145 || preflight.graphFingerprint !== expectedFingerprint) {
    throw new Error("Lean Test 3 cache evaluation did not preserve the canonical graph benchmark");
  }
  const diagnostics = buildLeanDiagnostics(graph);
  if (preflight.expectedEnrichmentCalls !== 0 || diagnostics.openAIGenerationCallsAfterReconciliation !== 0) {
    throw new Error("Lean evaluation planned a post-reconciliation model call");
  }
  console.log(JSON.stringify({
    mode: "deterministic cached lean dry-run",
    writes: 0,
    extraction: "REUSE",
    reconciliation: "REUSE",
    extractionApiCalls: 0,
    reconciliationApiCalls: 0,
    plannedEnrichmentCalls: preflight.expectedEnrichmentCalls,
    plannedOpenAICalls: 0,
    canonicalEntities: graph.entities.length,
    canonicalFacts: graph.facts.length,
    canonicalRelationships: graph.relationships.length,
    graphFingerprint: preflight.graphFingerprint,
    ...diagnostics,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
