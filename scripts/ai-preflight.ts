import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { preflightStructuredModelProvider } = await import("@/lib/ai/structured-model-provider-runtime");
  const stages = await Promise.all((["extraction_inventory", "extraction_rich", "reconciliation", "enrichment"] as const).map(async (stage) => ({ stage, ...(await preflightStructuredModelProvider(stage)) })));
  console.log(JSON.stringify({ generationCalls: 0, stages }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
