import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { aggregateCandidates } from "@/lib/graph/aggregate";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { applyLeanGraphDefaults, buildLeanDiagnostics } from "@/lib/graph/lean";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { chunkPages } from "@/lib/pdf/chunk-pages";
import { extractPdfPages } from "@/lib/pdf/extract-text";

loadEnvConfig(process.cwd());

async function main() {
  const [{ getStructuredModelProvider, preflightStructuredModelProvider }, { extractChunksLimited }, { reconcileGroupsWithAI }, { getProcessingEnv }] = await Promise.all([
    import("@/lib/ai/structured-model-provider-runtime"), import("@/lib/ai/extract"), import("@/lib/ai/reconcile"), import("@/lib/env"),
  ]);
  const extractionProvider = getStructuredModelProvider("extraction");
  const reconciliationProvider = getStructuredModelProvider("reconciliation");
  if (extractionProvider.providerId !== "local" || reconciliationProvider.providerId !== "local") throw new Error("smoke:local requires AI_PROVIDER=local");
  const preflight = await Promise.all((["extraction", "reconciliation"] as const).map(async (stage) => ({ stage, ...(await preflightStructuredModelProvider(stage)) })));
  const pages = await extractPdfPages(await readFile(path.join(process.cwd(), "fixtures", "test-campaign.pdf")));
  const chunks = chunkPages(pages, { targetCharacters: getProcessingEnv().PDF_CHUNK_TARGET_CHARACTERS, overlapPages: 1 });
  const extracted = await extractChunksLimited(chunks, undefined, undefined, extractionProvider);
  const aggregate = aggregateCandidates(extracted.map((result) => ({ chunkId: result.chunkId, ...result.extraction })));
  const reconciliation = await reconcileGroupsWithAI(buildDeterministicGroups(aggregate), reconciliationProvider);
  const graph = applyLeanGraphDefaults(buildCanonicalGraph(aggregate, reconciliation.decision));
  console.log(JSON.stringify({ mode: "local lean core fixture smoke", benchmark: false, persistence: "not run", paidOpenAICalls: 0, preflight, pages: pages.length, chunks: chunks.length, entities: graph.entities.length, facts: graph.facts.length, relationships: graph.relationships.length, diagnostics: buildLeanDiagnostics(graph) }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
