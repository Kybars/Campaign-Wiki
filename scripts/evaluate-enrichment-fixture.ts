import { enrichmentFixtureGraph, enrichmentFixtureOutput } from "../fixtures/enrichment-cache";
import { applyCampaignEnrichment, buildEnrichmentDiagnostics } from "../lib/graph/enrichment";
import { enrichmentGraphFingerprint } from "../lib/ai/enrichment-input";
import { summarizeModelUsage } from "../lib/ai/usage";

const graph = enrichmentFixtureGraph();
const enriched = applyCampaignEnrichment(graph, enrichmentFixtureOutput(graph));
console.log(JSON.stringify({
  mode: "deterministic-enrichment-replay",
  modelCalls: 0,
  stageUsage: summarizeModelUsage("enrichment", []),
  graphFingerprint: enrichmentGraphFingerprint(graph),
  ...buildEnrichmentDiagnostics(enriched),
  gmOverviewGenerated: Boolean(enriched.campaignOverview?.gm),
  playerOverviewGenerated: Boolean(enriched.campaignOverview?.player),
}, null, 2));
