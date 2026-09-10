import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { preflightStructuredModelProvider } = await import("@/lib/ai/structured-model-provider-runtime");
  console.log(JSON.stringify(await preflightStructuredModelProvider("enrichment"), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
