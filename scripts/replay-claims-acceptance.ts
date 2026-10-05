import { mkdirSync, writeFileSync, copyFileSync, constants, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { blockReplayNetwork } from "./offline-network-guard";

async function main() {
  const network = blockReplayNetwork();
  const { verifyAcceptanceBundle, replayAcceptanceBundle, sha256 } = await import("../lib/ai/claims-offline-replay");
  const [source, output, manifestHash, historicalReport] = process.argv.slice(2);
  if (!source || !output || !manifestHash) throw new Error("Usage: replay-claims-acceptance <acceptance directory> <new private output> <expected manifest sha256>");
  const target = resolve(output), privateRoot = resolve("fixtures/private");
  if (!target.startsWith(privateRoot + "\\") && !target.startsWith(privateRoot + "/")) throw new Error("Replay output must be private");
  const bundle = verifyAcceptanceBundle(source, manifestHash);
  const { annotateSourceStructure } = await import("../lib/ai/claims-source-structure");
  const { normalizeClaimsInventory } = await import("../lib/ai/claims-inventory-normalization");
  const { reconcileClaims41DocumentV230 } = await import("../lib/ai/claims-4-1-reconciliation-v2-3-0");
  const replay = replayAcceptanceBundle(bundle, { structure: annotateSourceStructure, inventory: normalizeClaimsInventory,
    reconcile: (raw, request) => reconcileClaims41DocumentV230(raw, request, stage => console.log(stage)) });
  const { assertTalesReplay } = await import("./tales-replay-assertions");
  const assertions = assertTalesReplay(replay);
  network();
  mkdirSync(target); // Exclusive new version; never overwrite.
  const files: string[] = [];
  const write = (name: string, value: unknown) => { writeFileSync(join(target, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); files.push(name); };
  write("source-structure.v1.json", replay.structure);
  write("normalized-inventory.v1.json", replay.normalized.inventory);
  write("inventory-merge-provenance.v1.json", replay.normalized.merges);
  write("reconciliation.v1.json", replay.result);
  write("candidate-entities.v1.json", replay.result.candidateEntities);
  for (const kind of ["unresolved", "generic_non_entity"]) write(`${kind}-participants.v1.json`, replay.result.claims.flatMap(c => c.participants.filter(p => p.kind === kind).map(participant => ({ proposalIndex: c.proposalIndex, participant }))));
  write("gm-review.v1.json", replay.result.gmReview);
  write("timeline-associations.v1.json", replay.result.claims.filter(c => c.timelineAssociation).map(c => ({ proposalIndex: c.proposalIndex, association: c.timelineAssociation })));
  write("entity-associations.v1.json", replay.result.claims.map(c => ({ proposalIndex: c.proposalIndex, associations: c.entityAssociations })));
  write("machine-summary.v1.json", replay.summary);
  write("source-status-summary.v1.json", { before: replay.summary.before.sourceStatus, after: replay.summary.after.sourceStatus });
  if (historicalReport) write("historical-deltas.v1.json", JSON.parse(readFileSync(historicalReport, "utf8")));
  write("targeted-regressions.v1.json", assertions);
  write("proposal-provenance.v1.json", replay.provenance);
  copyFileSync(join(resolve(source), "claims-raw.v1.json"), join(target, "claims-raw.v1.json"), constants.COPYFILE_EXCL); files.push("claims-raw.v1.json");
  write("raw-claims-verification.v1.json", { count: replay.result.rawProposals.claims.length, byteHash: sha256(bundle.bytes("claims-raw.v1.json")),
    copiedByteHash: sha256(readFileSync(join(target, "claims-raw.v1.json"))), rawProposalHashEquivalent: replay.summary.rawProposalHashEquivalent });
  write("MANIFEST.json", { version: 1, classification: "private/local-only", acceptanceManifestHash: manifestHash,
    artifacts: files.map(path => { const b = readFileSync(join(target, path)); return { path, bytes: b.length, sha256: sha256(b) }; }) });
  write("MANIFEST.sha256.json", { sha256: sha256(readFileSync(join(target, "MANIFEST.json"))) });
  verifyAcceptanceBundle(source, manifestHash);
  console.log(JSON.stringify({ ...replay.summary, assertions, replayManifestHash: sha256(readFileSync(join(target, "MANIFEST.json"))) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
