import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blockReplayNetwork } from "./offline-network-guard";

async function main() {
  blockReplayNetwork();
  const [bundle, expectedManifestHash, results, report] = process.argv.slice(2);
  if (!bundle || !expectedManifestHash || !results || !report) throw new Error("Usage: evaluate-tales-live-slices <plan bundle> <manifest sha> <saved outputs JSON> <new private report>");
  if (existsSync(report)) throw new Error("Refusing audit overwrite");
  const { verifyAcceptanceBundle } = await import("../lib/ai/claims-offline-replay");
  const verified = verifyAcceptanceBundle(bundle, expectedManifestHash);
  const { evaluateClaimsSlice } = await import("../lib/ai/claims-slice-evaluation");
  type Request = import("../lib/ai/claims-4-1-experiment").Claims41Request;
  const plan = verified.read<Array<{ id: string; requests: Request[] }>>("live-slice-plan.v1.json");
  const pages = verified.read<import("../lib/pdf/types").DocumentPage[]>("raw-pages.v1.json");
  const outputs = JSON.parse(readFileSync(results, "utf8")) as Array<{ requestId: string; output: import("../lib/ai/claims-4-1-experiment").Claims41Output }>;
  const keys = verified.read<{ removedFragments: Array<{ normalizedKey: string; reason: string }> }>("new-cleaning.v1.json").removedFragments.filter(f => f.reason !== "duplicate_overlay").map(f => f.normalizedKey);
  const requests = plan.flatMap(s => s.requests);
  const normalized = verified.read<{ inventory: import("../lib/ai/entity-reconciliation").GraphInventory }>("global-inventory.v1.json");
  const inventorySources = new Map(normalized.inventory.entities.map(e => [e.temporary_id, e.sources]));
  if (outputs.length !== requests.length || new Set(outputs.map(o => o.requestId)).size !== outputs.length || outputs.some(o => !requests.some(r => r.requestId === o.requestId))) throw new Error("Saved output ownership mismatch");
  const evaluations = plan.map(s => ({ slice: s.id, reports: s.requests.map(r => ({ requestId: r.requestId,
    ...evaluateClaimsSlice(r, outputs.find(o => o.requestId === r.requestId)!.output, pages, keys, inventorySources) })) }));
  const { resolve } = await import("node:path");
  if (!resolve(report).startsWith(resolve("fixtures/private") + "\\") && !resolve(report).startsWith(resolve("fixtures/private") + "/")) throw new Error("Private report required");
  writeFileSync(join(report), JSON.stringify({ evaluations, modelCalls: 0, apiCalls: 0 }, null, 2) + "\n", { flag: "wx" });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
