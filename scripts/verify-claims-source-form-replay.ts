// Read-only acceptance assertions over saved bytes. Never invokes reconciliation.
import { isDeepStrictEqual } from "node:util";
import { blockReplayNetwork } from "./offline-network-guard";

async function main() {
  const restore = blockReplayNetwork();
  const { verifyAcceptanceBundle } = await import("../lib/ai/claims-offline-replay");
  const { precedingSourceScope } = await import("../lib/ai/claims-source-form");
  const saved = verifyAcceptanceBundle("fixtures/private/tales-full-reconciliation-232-replay-v1", "e9a40e03cc185787103d2d47ab52b97773dbd0e34420ed04c166d81c5adf1d79");
  const prior = verifyAcceptanceBundle("fixtures/private/tales-full-reconciliation-231-replay-v2", "7a16d46c5a9fadfd17a6a92d492a8b0b8e50db7ddfe539dbd7b7b5cd8e49fb2d");
  type Result = ReturnType<typeof import("../lib/ai/claims-4-1-reconciliation-v2-3-2").reconcileClaims41DocumentV232>;
  type Structure = ReturnType<typeof import("../lib/ai/claims-source-structure").annotateSourceStructure>;
  const result = saved.read<Result>("reconciliation.v1.json");
  const structure = saved.read<Structure>("source-structure.v1.json");
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  for (const path of ["normalized-inventory.v1.json", "inventory-merge-provenance.v1.json"])
    assert(isDeepStrictEqual(saved.read(path), prior.read(path)), `Inventory changed: ${path}`);
  assert(saved.bytes("claims-raw.v1.json").equals(prior.bytes("claims-raw.v1.json")), "Raw proposals changed");
  const unitById = new Map(structure.units.map(u => [u.unitId, u]));
  for (const decision of result.sourceFormDecisions) {
    const claim = result.claims[decision.proposalIndex];
    const participant = claim.participants[decision.participantIndex];
    assert(participant.kind !== "candidate_entity", "Source-form candidate created");
    if (decision.anchorUnitId) {
      const anchor = unitById.get(decision.anchorUnitId)!;
      assert(anchor?.kind === "sentence", "Heading-only anchor");
      assert(claim.directEvidence.some(e => precedingSourceScope(structure.units, unitById.get(e.unitId)!).some(u => u.unitId === anchor.unitId)), "Anchor outside scope");
      assert(participant.supportingEvidence.some(e => e.unitId === anchor.unitId), "Missing anchor provenance");
    }
  }
  for (const name of ["Moon Spire", "Gibbering Fever", "Academy of Engineers", "Void"])
    assert(result.sourceFormDecisions.some(d => d.mention === name && d.method === "source_form_coreference"), `No anchored acceptance case: ${name}`);
  for (const name of ["Cursed creature", "Character", "Orcs", "Gremlins", "Boggarts"])
    assert(result.sourceFormDecisions.some(d => d.mention.toLowerCase() === name.toLowerCase() && d.method === "source_form_generic"), `No source-form generic case: ${name}`);
  assert(result.claims.some(c => c.participants.some(p => p.mention === "Moon Spire" && p.kind === "unresolved")), "Ambiguity forced resolved");
  restore();
  console.log(JSON.stringify({ verifiedManifest: "e9a40e03cc185787103d2d47ab52b97773dbd0e34420ed04c166d81c5adf1d79", assertions: "passed", additionalReconciliationExecutions: 0, modelCalls: 0, apiCalls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
