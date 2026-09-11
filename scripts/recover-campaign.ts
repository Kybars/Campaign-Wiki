import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  const args = process.argv.slice(2); const campaignId = args.find((arg) => !arg.startsWith("--"));
  const modeArgument = args.find((arg) => arg.startsWith("--mode="));
  const processingMode = modeArgument?.slice("--mode=".length);
  if (!campaignId || (!args.includes("--dry-run") && !args.includes("--execute"))) throw new Error("Usage: npm run recover:campaign -- <campaign-id> --dry-run|--execute [--mode=lean|full]");
  if (processingMode !== undefined && processingMode !== "lean" && processingMode !== "full") throw new Error("Processing mode must be lean or full");
  const { recoverCampaignFromCachedExtraction } = await import("@/lib/processing/recover-campaign");
  console.log(JSON.stringify(await recoverCampaignFromCachedExtraction(campaignId, { execute: args.includes("--execute"), processingMode }), null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
