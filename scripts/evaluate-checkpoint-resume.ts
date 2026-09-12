import { memoryCheckpointStore, planAIOperations, type AIOperationIdentity } from "@/lib/ai/operation-checkpoint";

const base: AIOperationIdentity = { campaignId: "fixture-campaign", documentId: "fixture-document", sourceExtractionCacheId: null, providerId: "openai", modelId: "fixture-model", processingMode: "full", stage: "enrichment", operationType: "fact_visibility", operationKey: "0", inputHash: "a".repeat(64), upstreamFingerprint: "fixture-graph", behaviorVersion: "fixture-behavior", schemaVersion: 1 };

async function main() {
  const store = memoryCheckpointStore();
  await store.saveValidated({ identity: base, output: { facts: [] }, usage: [], attemptCount: 1 });
  const operations = [
    { identity: base, operationType: "fact_visibility", operationKey: "0" },
    { identity: { ...base, operationKey: "1" }, operationType: "fact_visibility", operationKey: "1" },
    { identity: { ...base, inputHash: "b".repeat(64) }, operationType: "fact_visibility", operationKey: "0" },
  ];
  const plan = await planAIOperations(store, operations);
  const counts = Object.fromEntries(["REUSE", "RUN", "INVALIDATED"].map((status) => [status, plan.filter((item) => item.status === status).length]));
  console.log(JSON.stringify({ mode: "deterministic checkpoint dry-run", plan, counts, plannedOpenAICalls: 2, plannedLocalCalls: 0, modelCalls: 0, writesDuringDryRun: 0 }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
