import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claims41Preflight, loadFrozenClaims41Benchmarks } from "../lib/ai/claims-4-1-benchmarks";

async function main() {
  if (process.argv.length > 2) throw new Error("Claims-4.1 preflight is offline only; no dispatch options exist");
  const plan = claims41Preflight(await loadFrozenClaims41Benchmarks());
  const directory = join(process.cwd(), "fixtures", "private", "claims4-1-v1");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "preflight.v1.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({ path, plannedCalls: plan.plannedCalls, liveCallsMade: plan.liveCallsMade,
    promptHash: plan.promptHash, schemaHash: plan.schemaHash, requests: plan.requests.map((request) => ({
      requestId: request.requestId, pages: request.pages, evidenceUnits: request.evidenceUnits,
      estimatedInputTokens: request.estimatedInputTokens, reservedInputTokens: request.reservedInputTokens,
      maxOutputTokens: request.maxOutputTokens, estimatedCostUsd: request.estimatedCostUsd,
    })) }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
