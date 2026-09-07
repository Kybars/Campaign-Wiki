import { regressionCachedChunks, regressionReconciliationDecision } from "@/fixtures/regression-cache";
import { buildEvaluationMetrics } from "@/lib/evaluation/metrics";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { aggregateCachedChunks } from "@/lib/processing/replay-cache";

const aggregate = aggregateCachedChunks(regressionCachedChunks);
const graph = buildCanonicalGraph(aggregate, regressionReconciliationDecision(aggregate));
console.log(JSON.stringify({ mode: "deterministic cached replay", extractionApiCalls: 0, reconciliationApiCalls: 0, ...buildEvaluationMetrics(aggregate, graph) }, null, 2));
