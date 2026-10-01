import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFrozenClaims41Benchmarks } from "../lib/ai/claims-4-1-benchmarks";
import { claims41OutputSchema, reconcileClaims41 } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41V2 } from "../lib/ai/claims-4-1-reconciliation-v2";

const ROOT = join(process.cwd(), "fixtures", "private", "claims4-1-sweetwater-v1");
const ID = "test10-sweetwater-claims4-1-v3-1";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function main() {
  if (process.argv.length !== 2) throw new Error("Sweetwater reconciliation replay is offline only");
  const preflight = JSON.parse(readFileSync(join(ROOT, "preflight.v1.json"), "utf8"));
  if (sha(readFileSync(join(process.cwd(), "lib/ai/claims-4-1-reconciliation-v2.ts"))) !== preflight.reconciliationV2CodeHash ||
      sha(readFileSync(join(process.cwd(), "lib/ai/claims-4-1-experiment.ts"))) !== preflight.oldReconciliationCodeHash)
    throw new Error("Reconciliation code changed after preflight; stop replay");
  const saved = JSON.parse(readFileSync(join(ROOT, `${ID}.result.v1.json`), "utf8"));
  if (saved.requestId !== ID || JSON.stringify(saved.identity) !== JSON.stringify(preflight.identity))
    throw new Error("Saved extraction identity differs from frozen preflight");
  const original = claims41OutputSchema.parse(saved.originalParsedOutput);
  const request = (await loadFrozenClaims41Benchmarks()).flatMap((item) => item.requests).find((item) => item.requestId === ID);
  if (!request) throw new Error("Frozen Sweetwater request missing");
  const old = reconcileClaims41(original, request);
  if (JSON.stringify(old) !== JSON.stringify(saved.reconciled)) throw new Error("Old reconciliation no longer reproduces saved result");
  const next = reconcileClaims41V2(original, request);
  if (next.claims.length !== original.claims.length || next.claims.some((item, index) =>
    JSON.stringify(item.original) !== JSON.stringify(original.claims[index])))
    throw new Error("V2 did not preserve every original proposal in order");
  const path = join(ROOT, `${ID}.reconciliation-v2.v1.json`);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ path, old: old.diagnostics, v2: next.diagnostics }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
