import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { blockReplayNetwork } from "./offline-network-guard";

async function main() {
  const network = blockReplayNetwork();
  const { loadFrozenClaims41Benchmarks } = await import("../lib/ai/claims-4-1-benchmarks");
  const { reconcileClaims41V224 } = await import("../lib/ai/claims-4-1-reconciliation-v2-2-4");
  const { reconcileClaims41V230 } = await import("../lib/ai/claims-4-1-reconciliation-v2-3-0");
  const root = "fixtures/private/claims4-1-v2-2-4-review-v1/review-bundle-v1";
  const hash = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
  const manifest = JSON.parse(readFileSync(join(root, "MANIFEST.json"), "utf8")) as { payloads: Array<{ path: string; bytes: number; sha256: string }> };
  const read = (path: string) => {
    const bytes = readFileSync(join(root, path)), entry = manifest.payloads.find(e => e.path === path);
    if (!entry || entry.bytes !== bytes.length || entry.sha256 !== hash(bytes)) throw new Error(`Historical hash mismatch: ${path}`);
    return JSON.parse(bytes.toString("utf8"));
  };
  const invariants = read("input-invariants.v1.json");
  const requests = (await loadFrozenClaims41Benchmarks()).flatMap(b => b.requests);
  const reports = [];
  const count = (values: string[]) => values.reduce<Record<string, number>>((r, s) => { r[s] = (r[s] ?? 0) + 1; return r; }, {});
  for (const benchmark of ["wotbs", "sweetwater"]) {
    const invariant = invariants.benchmarks.find((b: { benchmark: string }) => b.benchmark === benchmark);
    const request = requests.find(r => r.requestId === invariant.requestIdentity.operationKey);
    if (!request || hash(JSON.stringify(request)) !== invariant.requestSha256) throw new Error("Historical request changed");
    const { exportMetadata, ...saved } = read(`${benchmark}.complete-v2.2.4.v1.json`);
    void exportMetadata;
    const before = reconcileClaims41V224(saved.rawProposals, request);
    if (JSON.stringify(before) !== JSON.stringify(saved)) throw new Error("Historical v2.2.4 result changed");
    const after = reconcileClaims41V230(saved.rawProposals, request);
    const summarize = (r: typeof before) => ({ candidates: r.candidateEntities.length, participants: count(r.claims.flatMap(c => c.participants.map(p => p.kind))),
      states: count(r.claims.map(c => c.resolutionState ?? "mechanical_only")), gmReview: r.gmReview.length,
      sourceStatus: count(r.claims.map(c => c.sourceStatus)), timeline: r.claims.filter(c => c.timelineAssociation).length });
    reports.push({ benchmark, proposals: saved.rawProposals.claims.length, v224Equivalent: true,
      before: summarize(before), after: summarize(after), changedProposalIndexes: before.claims.filter((c, i) => JSON.stringify(c) !== JSON.stringify(after.claims[i])).map(c => c.proposalIndex) });
  }
  network();
  const report = { modelCalls: 0, apiCalls: 0, reports };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
