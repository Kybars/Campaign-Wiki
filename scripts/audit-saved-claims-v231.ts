import { constants, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { blockReplayNetwork } from "./offline-network-guard";

/** Re-export corrected diagnostics from an immutable result. Never reconciles. */
async function main() {
  const network = blockReplayNetwork();
  const { verifyAcceptanceBundle, sha256 } = await import("../lib/ai/claims-offline-replay");
  const { auditInventoryCollisions, auditResidualParticipants } = await import("./claims-ambiguity-audit");
  const { assertTalesReplay } = await import("./tales-replay-assertions");
  const [acceptancePath, acceptanceHash, replayPath, replayHash, output] = process.argv.slice(2);
  if (!output) throw new Error("Usage: audit-saved-claims-v231 <acceptance> <hash> <saved replay> <hash> <new private output>");
  const acceptance = verifyAcceptanceBundle(acceptancePath, acceptanceHash);
  const saved = verifyAcceptanceBundle(replayPath, replayHash);
  type Replay = ReturnType<typeof import("../lib/ai/claims-offline-replay").replayAcceptanceBundle>;
  const replay: Replay = { originalUnits: acceptance.read("claims/evidence-units.v1.json"),
    originalInventory: acceptance.read<{ finalInventory: Replay["originalInventory"] }>("inventory-review.v1.json").finalInventory,
    structure: saved.read("source-structure.v1.json"), normalized: { inventory: saved.read("normalized-inventory.v1.json"), merges: saved.read("inventory-merge-provenance.v1.json") },
    result: saved.read("reconciliation.v1.json"), provenance: saved.read("proposal-provenance.v1.json"), summary: saved.read("machine-summary.v1.json") };
  const changed: Record<string, unknown> = { "collision-audit.v1.json": auditInventoryCollisions(replay),
    "residual-unresolved-audit.v1.json": auditResidualParticipants(replay), "targeted-regressions.v1.json": assertTalesReplay(replay),
    "reexport-provenance.v1.json": { sourceReplayManifestHash: replayHash, reconciliationByteHash: sha256(saved.bytes("reconciliation.v1.json")),
      additionalReconciliationExecutions: 0, modelCalls: 0, apiCalls: 0 } };
  const target = resolve(output);
  if (!target.startsWith(resolve("fixtures/private") + sep)) throw new Error("Output must be private");
  mkdirSync(target);
  const manifest = JSON.parse(readFileSync(join(replayPath, "MANIFEST.json"), "utf8")) as { artifacts: Array<{ path: string }> };
  const paths = manifest.artifacts.map(e => e.path);
  for (const path of paths) {
    if (path in changed) continue;
    copyFileSync(join(replayPath, path), join(target, path), constants.COPYFILE_EXCL);
  }
  for (const [path, payload] of Object.entries(changed)) {
    writeFileSync(join(target, path), JSON.stringify(payload, null, 2) + "\n", { flag: "wx" });
    if (!paths.includes(path)) paths.push(path);
  }
  writeFileSync(join(target, "MANIFEST.json"), JSON.stringify({ version: 1, classification: "private/local-only", acceptanceManifestHash: acceptanceHash,
    sourceReplayManifestHash: replayHash, artifacts: paths.map(path => { const bytes = readFileSync(join(target, path)); return { path, bytes: bytes.length, sha256: sha256(bytes) }; }) }, null, 2) + "\n", { flag: "wx" });
  const hash = sha256(readFileSync(join(target, "MANIFEST.json")));
  writeFileSync(join(target, "MANIFEST.sha256.json"), JSON.stringify({ sha256: hash }, null, 2) + "\n", { flag: "wx" });
  verifyAcceptanceBundle(output, hash);
  network();
  console.log(JSON.stringify({ manifestHash: hash, additionalReconciliationExecutions: 0, assertions: changed["targeted-regressions.v1.json"], residual: changed["residual-unresolved-audit.v1.json"] }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
