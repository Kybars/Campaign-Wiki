import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

async function main() {
  // Read-only offline verification: no dispatch path; block network transports too.
  let blockedNetworkAttempts = 0;
  const disabled = () => { blockedNetworkAttempts++; throw new Error("Network disabled for frozen replay"); };
  globalThis.fetch = disabled;
  http.request = disabled as typeof http.request; http.get = disabled as typeof http.get;
  https.request = disabled as typeof https.request; https.get = disabled as typeof https.get;
  net.connect = disabled as typeof net.connect; net.createConnection = disabled as typeof net.createConnection;
  net.Socket.prototype.connect = disabled as typeof net.Socket.prototype.connect;
  tls.connect = disabled as typeof tls.connect;
  syncBuiltinESMExports();
  const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const directory = join(process.cwd(), "fixtures/private/claims4-1-v2-2-4-review-v1/review-bundle-v1");
  const manifest = JSON.parse(readFileSync(join(directory, "MANIFEST.json"), "utf8")) as { payloads: Array<{ path: string; bytes: number; sha256: string }> };
  const read = (name: string) => {
    const entry = manifest.payloads.find((item) => item.path === name);
    const bytes = readFileSync(join(directory, name));
    if (!entry || bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error(`Frozen artifact hash mismatch: ${name}`);
    return JSON.parse(bytes.toString("utf8"));
  };
  const invariants = read("input-invariants.v1.json") as { benchmarks: Array<{ benchmark: string; requestSha256: string; requestIdentity: { operationKey: string } }> };
  const { loadFrozenClaims41Benchmarks } = await import("../lib/ai/claims-4-1-benchmarks");
  const { reconcileClaims41V224, reconcileClaims41DocumentV224 } = await import("../lib/ai/claims-4-1-reconciliation-v2-2-4");
  const requests = (await loadFrozenClaims41Benchmarks()).flatMap((benchmark) => benchmark.requests);
  const report = [];
  for (const name of ["wotbs", "sweetwater"]) {
    const invariant = invariants.benchmarks.find((item) => item.benchmark === name)!;
    const request = requests.find((item) => item.requestId === invariant.requestIdentity.operationKey);
    if (!request || sha(JSON.stringify(request)) !== invariant.requestSha256) throw new Error(`${name}: frozen request changed`);
    const filename = `${name}.complete-v2.2.4.v1.json`;
    const saved = read(filename) as ReturnType<typeof reconcileClaims41V224> & { exportMetadata?: unknown };
    const { exportMetadata: metadata, ...expected } = saved;
    void metadata; // Export metadata is not an algorithm result field.
    const before = JSON.stringify({ request, output: expected.rawProposals });
    const historical = reconcileClaims41V224(expected.rawProposals, request);
    const document = reconcileClaims41DocumentV224(expected.rawProposals, request);
    if (!isDeepStrictEqual(historical, expected) || !isDeepStrictEqual(document, expected)) throw new Error(`${name}: frozen result changed`);
    if (before !== JSON.stringify({ request, output: expected.rawProposals })) throw new Error(`${name}: inputs mutated`);
    read(filename); // Verify saved bytes remain intact after both entry points.
    report.push({ benchmark: name, proposals: expected.rawProposals.claims.length, historicalEntryEquivalent: true,
      documentEntryEquivalent: true, completeResultHash: sha(JSON.stringify(expected)), savedArtifactUnchanged: true });
  }
  if (blockedNetworkAttempts) throw new Error("Unexpected network attempt during offline replay");
  console.log(JSON.stringify({ reconciliationVersion: "claims-4-1-reconciliation-2.2.4", modelCalls: 0, apiCalls: 0, report }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
