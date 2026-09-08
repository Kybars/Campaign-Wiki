import { regressionCachedChunks, regressionReconciliationDecision } from "@/fixtures/regression-cache";
import { buildEvaluationMetrics } from "@/lib/evaluation/metrics";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { aggregateCachedChunks } from "@/lib/processing/replay-cache";
import { richFactCachedChunks } from "@/fixtures/rich-fact-cache";
import { RICH_EXTRACTION_CACHE_SCHEMA_VERSION } from "@/lib/processing/cache-version";

const aggregate = aggregateCachedChunks(regressionCachedChunks);
const graph = buildCanonicalGraph(aggregate, regressionReconciliationDecision(aggregate));
const richAggregate = aggregateCachedChunks(richFactCachedChunks, RICH_EXTRACTION_CACHE_SCHEMA_VERSION);
const richGraph = buildCanonicalGraph(richAggregate);
console.log(JSON.stringify({
  mode: "deterministic cached replay",
  cacheSchemaVersion: RICH_EXTRACTION_CACHE_SCHEMA_VERSION,
  extractionApiCalls: 0,
  reconciliationApiCalls: 0,
  legacyRegression: buildEvaluationMetrics(aggregate, graph),
  richFactFixture: buildEvaluationMetrics(richAggregate, richGraph),
}, null, 2));
