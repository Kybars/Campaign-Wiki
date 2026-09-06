import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const campaignId = args.find((arg) => !arg.startsWith("--"));
  const refreshReconciliation = args.includes("--refresh-reconciliation");
  if (!campaignId) throw new Error("Usage: npm run replay -- <campaign-id> [--refresh-reconciliation]");
  const { replayCampaignFromCache } = await import("@/lib/processing/replay-campaign");
  const result = await replayCampaignFromCache(campaignId, { refreshReconciliation });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
