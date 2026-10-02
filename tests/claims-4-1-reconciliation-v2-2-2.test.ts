import { describe, expect, it } from "vitest";
import type { Claims41Output, Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41V221 } from "../lib/ai/claims-4-1-reconciliation-v2-2-1";
import { CLAIMS_4_1_RECONCILIATION_V2_2_2_VERSION, reconcileClaims41V222 } from "../lib/ai/claims-4-1-reconciliation-v2-2-2";

function fixture(texts: string[], names: string[] = []): Claims41Request {
  return { requestId: "synthetic-source-reference", baselineRequestId: "synthetic", inputDifferences: [],
    entities: names.map((name) => ({ canonicalId: `e:${name}`, name, type: "npc", aliases: [] })),
    evidenceUnits: texts.map((text, order) => ({ unitId: `u${order}`, segmentId: "block", page: 1,
      context: "section", kind: "sentence", order, text,
      rawSource: { page: 1, start: order * 200, end: order * 200 + text.length, text } })) };
}
function proposal(statement: string, participants: string[], index = 0) {
  return { statement, participants, evidence_unit_ids: [`u${index}`] };
}
const run = (request: Claims41Request, claims: Claims41Output["claims"]) => reconcileClaims41V222({ claims }, request);

describe("Claims-4.1 Reconciliation v2.2.2 source-side identity references", () => {
  it("preserves normalized exact subject discovery and v2.2.1 output", () => {
    const request = fixture(["Arlen became a wraith.", "The wraith guards the coast."], ["Arlen"]);
    const output = { claims: [proposal("Arlen became a wraith.", ["Arlen", "wraith"])] };
    const result = reconcileClaims41V222(output, request);
    expect(result.version).toBe(CLAIMS_4_1_RECONCILIATION_V2_2_2_VERSION);
    expect({ ...result, version: "same" }).toEqual({ ...reconcileClaims41V221(output, request), version: "same" });
    expect(result.claims[0].identityRelations).toEqual([expect.objectContaining({ kind: "identity_transition", sourceClaimIndex: 0 })]);
  });

  it.each([{ names: ["Arlen"] }, { names: [] }])("establishes a definite source subject using explicit local type evidence: inventory %j", ({ names }) => {
    const request = fixture(["Arlen was a nymph.", "The nymph returned as a wraith.", "The wraith guards the coast."], names);
    const result = run(request, [proposal("Arlen returned as a wraith.", ["Arlen", "wraith"], 1)]);
    expect(result.claims[0].identityRelations).toEqual([expect.objectContaining({ kind: "identity_transition", sourceUnitId: "u1", sourceClaimIndex: 0 })]);
    expect(result.claims[0].participants.map((item) => item.kind)).toEqual([names.length ? "canonical_entity" : "candidate_entity", "candidate_entity"]);
    expect(result.claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
    expect(result.claims[0].contextEvidence[0].direct).toBe(false);
    expect(result.claims[0].directEvidence.map((entry) => entry.unitId)).toEqual(["u1"]);
  });

  it.each([{ names: ["Arlen"] }, { names: [] }])("establishes a unique pronoun source subject: inventory %j", ({ names }) => {
    const request = fixture(["Arlen entered the crypt.", "She became the Ash Queen."], names);
    const result = run(request, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"], 1)]);
    expect(result.claims[0].identityRelations).toEqual([expect.objectContaining({ kind: "identity_transition", sourceClaimIndex: 0, sourceUnitId: "u1" })]);
    expect(result.claims[0].entityAssociations).toHaveLength(2);
    expect(result.claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
    expect(result.candidateEntities.map((entity) => entity.name)).not.toContain("She");
  });

  it.each(["also called", "also known as", "formerly known as", "became known as"])("establishes an alias with a pronoun subject without a second entity: %s", (marker) => {
    const request = fixture(["Arlen entered the crypt.", `She ${marker} Silver King.`]);
    const result = run(request, [proposal(`Arlen ${marker} Silver King.`, ["Arlen", "Silver King"], 1)]);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.claims[0].participants[0].canonicalId).toBe(result.claims[0].participants[1].canonicalId);
    expect(result.claims[0].identityRelations).toEqual([expect.objectContaining({ kind: "same_identity_alias", sourceUnitId: "u1", sourceClaimIndex: 0 })]);
    expect(result.aliasMetadata[0]).toMatchObject({ alias: "Silver King", sourceClaimIndex: 0, evidence: { unitId: "u1" } });
    expect(result.claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
  });

  it("establishes a definite-source alias and a possessive nickname construction", () => {
    const request = fixture(["Arlen was a nymph.", "The nymph's nickname is Silver King."], ["Arlen"]);
    const result = run(request, [proposal("Arlen's nickname is Silver King.", ["Arlen", "Silver King"], 1)]);
    expect(result.claims[0].identityRelations[0].kind).toBe("same_identity_alias");
    expect(result.candidateEntities).toEqual([]);
    expect(result.claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
  });

  it("accepts different subject wording only when inventory names/aliases identify the same canonical entity", () => {
    const request = fixture(["Silver King became a wraith.", "The wraith waits."], ["Arlen"]);
    request.entities[0].aliases = ["Silver King"];
    const result = run(request, [proposal("Arlen became a wraith.", ["Arlen", "wraith"])]);
    expect(result.claims[0].identityRelations).toEqual([expect.objectContaining({ fromEntityId: "e:Arlen", sourceClaimIndex: 0 })]);
    expect(result.claims[0].contextEvidence).toEqual([]);
    const unrelated = fixture(["Mira became the Ash Queen."], ["Mira", "Arlen"]);
    expect(run(unrelated, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"])]).claims[0].identityRelations).toEqual([]);
  });

  it.each([
    ["Arlen entered the crypt.", "Mira entered the crypt.", "She became the Ash Queen."],
    ["Arlen and Mira entered the crypt.", "She became the Ash Queen."],
    ["Arlen entered the crypt with Mira.", "She became the Ash Queen."],
  ])("rejects multiple possible pronoun antecedents without gender guessing: %j", (...texts) => {
    const request = fixture(texts, ["Arlen", "Mira"]);
    const result = run(request, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"], texts.length - 1)]);
    expect(result.claims[0].identityRelations).toEqual([]);
  });

  it("counts independently named competing antecedents absent from the inventory", () => {
    const request = fixture(["Arlen entered the crypt.", "Mira entered the crypt.", "She became the Ash Queen."], ["Arlen"]);
    expect(run(request, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"], 2)]).claims[0].identityRelations).toEqual([]);
  });

  it("does not establish a pronoun subject merely from a nearby name mention", () => {
    const request = fixture(["A tablet records the name Arlen.", "She became the Ash Queen."], ["Arlen"]);
    expect(run(request, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"], 1)]).claims[0].identityRelations).toEqual([]);
  });

  it("uses an explicit antecedent in the same direct unit without adding a Luna evidence ID", () => {
    const request = fixture(["Arlen entered the crypt. She became the Ash Queen."], ["Arlen"]);
    const item = run(request, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"])]).claims[0];
    expect(item.identityRelations).toHaveLength(1);
    expect(item.directEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
    expect(item.contextEvidence).toEqual([]);
    expect(item.original.evidence_unit_ids).toEqual(["u0"]);
  });

  it.each(["Arlen met a nymph.", "Arlen stood near a nymph.", "A nymph lives in the crypt beside Arlen."])("requires explicit definite-reference identity/type evidence: %s", (context) => {
    const request = fixture([context, "The nymph returned as a wraith.", "The wraith waits."], ["Arlen"]);
    expect(run(request, [proposal("Arlen returned as a wraith.", ["Arlen", "wraith"], 1)]).claims[0].identityRelations).toEqual([]);
  });

  it("rejects a definite description tied to two independently meaningful subjects", () => {
    const request = fixture(["Arlen was a nymph.", "Mira was a nymph.", "The nymph returned as a wraith.", "The wraith waits."], ["Arlen", "Mira"]);
    expect(run(request, [proposal("Arlen returned as a wraith.", ["Arlen", "wraith"], 2)]).claims[0].identityRelations).toEqual([]);
  });

  it.each(["She became the Ash Queen.", "The nymph returned as a wraith."])("rejects antecedents outside the two-preceding window: %s", (text) => {
    const request = fixture(["Arlen was a nymph.", "Arlen entered the crypt.", "Nothing changes.", "Nothing moves.", text, "The wraith waits."], ["Arlen"]);
    const statement = text.startsWith("She") ? "Arlen became the Ash Queen." : "Arlen returned as a wraith.";
    expect(run(request, [proposal(statement, ["Arlen"], 4)]).claims[0].identityRelations).toEqual([]);
  });

  it("rejects an antecedent across a structural boundary, including intervening section changes", () => {
    for (const changed of [0, 1]) {
      const request = fixture(["Arlen was a nymph.", "Nothing changes.", "The nymph returned as a wraith.", "The wraith waits."], ["Arlen"]);
      request.evidenceUnits[changed].context = "other-section";
      expect(run(request, [proposal("Arlen returned as a wraith.", ["Arlen", "wraith"], 2)]).claims[0].identityRelations).toEqual([]);
    }
  });

  it("allows page changes within the same continuing structural section", () => {
    const request = fixture(["Arlen was a nymph.", "The nymph returned as a wraith.", "The wraith waits."], ["Arlen"]);
    request.evidenceUnits[0].page = request.evidenceUnits[0].rawSource.page = 3;
    request.evidenceUnits[1].page = request.evidenceUnits[1].rawSource.page = 4;
    request.evidenceUnits[1].segmentId = "next-page";
    const item = run(request, [proposal("Arlen returned as a wraith.", ["Arlen", "wraith"], 1)]).claims[0];
    expect(item.identityRelations).toHaveLength(1);
    expect(item.contextEvidence[0]).toMatchObject({ unitId: "u0", page: 3, direct: false });
  });

  it("uses one following identity/type evidence unit, but not two following units", () => {
    for (const following of [1, 2]) {
      const texts = ["The nymph returned as a wraith.", ...(following === 2 ? ["Nothing changes."] : []), "Arlen was a nymph.", "The wraith waits."];
      const item = run(fixture(texts, ["Arlen"]), [proposal("Arlen returned as a wraith.", ["Arlen", "wraith"])]).claims[0];
      expect(item.identityRelations.length).toBe(following === 1 ? 1 : 0);
      if (following === 1) expect(item.contextEvidence.map((entry) => entry.unitId)).toEqual(["u1"]);
    }
  });

  it("exports relation grounding provenance even when a later-use claim precedes the transition proposal", () => {
    const request = fixture(["Unused nearby wording.", "Arlen was a nymph.", "The nymph returned as a wraith.", "The wraith guards the coast."], ["Arlen"]);
    const transition = proposal("Arlen returned as a wraith.", ["Arlen", "wraith"], 2);
    const later = proposal("The wraith guards the coast.", ["wraith"], 3);
    const forward = run(request, [transition, later]), reversed = run(request, [later, transition]);
    expect(reversed.candidateEntities).toEqual(forward.candidateEntities);
    expect(reversed.claims[0].participants).toEqual(forward.claims[1].participants);
    expect(reversed.claims[0].identityRelations[0].sourceClaimIndex).toBe(1);
    expect(reversed.claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u1", "u2"]);
    expect(reversed.claims[1].contextEvidence.map((entry) => entry.unitId)).toEqual(["u1"]);
    expect(reversed.claims[0].directEvidence.map((entry) => entry.unitId)).toEqual(["u3"]);
    expect(reversed.claims[1].directEvidence.map((entry) => entry.unitId)).toEqual(["u2"]);
  });

  it("can use an already source-established alias as the bounded antecedent", () => {
    const request = fixture(["Arlen also called Silver King.", "Silver King entered the crypt.", "She became the Ash Queen."], ["Arlen"]);
    const result = run(request, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"], 2),
      proposal("Arlen also called Silver King.", ["Arlen", "Silver King"])]);
    expect(result.claims[0].identityRelations).toContainEqual(expect.objectContaining({ kind: "identity_transition", sourceClaimIndex: 0, fromEntityId: "e:Arlen" }));
    expect(result.claims[0].contextEvidence.map((entry) => entry.unitId)).toContain("u1");
  });

  it("keeps source-side alias chains claim-order independent without an inventory anchor", () => {
    const request = fixture(["Arlen entered the crypt.", "She also called Silver King.", "She also called Mira."]);
    const first = proposal("Arlen also called Silver King.", ["Arlen", "Silver King"], 1);
    const second = proposal("Silver King also called Mira.", ["Silver King", "Mira"], 2);
    const forward = run(request, [first, second]), reversed = run(request, [second, first]);
    expect(forward.candidateEntities).toHaveLength(1);
    expect(reversed.candidateEntities).toEqual(forward.candidateEntities);
    expect(reversed.candidateEntities[0].name).toBe("Arlen");
    expect(reversed.claims[0].participants.map((entry) => entry.canonicalId)).toEqual(forward.claims[1].participants.map((entry) => entry.canonicalId));
  });

  it("preserves endpoint bridge and common-form persistence requirements", () => {
    for (const persistent of [false, true]) {
      const request = fixture(["Arlen was a nymph.", "The nymph returned as an undead horror known as a wraith.", ...(persistent ? ["The wraith waits."] : [])], ["Arlen"]);
      const item = run(request, [proposal("Arlen returned as an undead horror known as a wraith.", ["Arlen", "wraith"], 1)]).claims[0];
      expect(item.identityRelations.length).toBe(persistent ? 1 : 0);
      expect(item.participants[1].kind).toBe(persistent ? "candidate_entity" : "unresolved");
    }
  });

  it("does not replace or infer the source endpoint or relation kind", () => {
    for (const source of ["She became the Ivory Queen.", "She also called Ash Queen.", "She met the Ash Queen."]) {
      const request = fixture(["Arlen entered the crypt.", source], ["Arlen"]);
      expect(run(request, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"], 1)]).claims[0].identityRelations).toEqual([]);
    }
    const both = fixture(["Arlen entered the crypt.", "She became the Ash Queen. She also called Ash Queen."], ["Arlen"]);
    expect(run(both, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"], 1)]).claims[0].identityRelations).toEqual([
      expect.objectContaining({ kind: "identity_transition", sourceClaimIndex: 0 }),
    ]);
  });

  it("does not manufacture an ungrounded claim-side subject or a missing relationship claim", () => {
    const request = fixture(["Mira entered the crypt.", "She became the Ash Queen."], ["Mira"]);
    const result = run(request, [proposal("Arlen became the Ash Queen.", ["Arlen", "Ash Queen"], 1)]);
    expect(result.claims[0].identityRelations).toEqual([]);
    expect(result.candidateEntities.map((entity) => entity.name)).not.toContain("Arlen");
    const noClaim = run(fixture(["Arlen entered the crypt.", "She became the Ash Queen.", "The Ash Queen waits."], ["Arlen"]),
      [proposal("The Ash Queen waits.", ["Ash Queen"], 2)]);
    expect(noClaim.claims.flatMap((item) => item.identityRelations)).toEqual([]);
    expect(noClaim.claims).toHaveLength(1);
    const generic = fixture(["a creature was a nymph.", "The nymph also called Mira."], ["Mira"]);
    expect(run(generic, [proposal("a creature also called Mira.", ["a creature", "Mira"], 1)]).claims[0].identityRelations).toEqual([]);
  });

  it("preserves original proposals and evidence IDs byte-for-byte and leaves the inventory unchanged", () => {
    const request = fixture(["Arlen entered the crypt.", "She became the Ash Queen."], ["Arlen"]);
    const output = { claims: [proposal(" Arlen became the Ash Queen. ", ["Arlen", "Ash Queen"], 1)] };
    const frozenRequest = JSON.stringify(request), frozenOutput = JSON.stringify(output);
    const result = reconcileClaims41V222(output, request);
    expect(JSON.stringify(result.rawProposals)).toBe(frozenOutput);
    expect(JSON.stringify({ claims: result.claims.map((item) => item.original) })).toBe(frozenOutput);
    expect(result.claims).toHaveLength(output.claims.length);
    expect(result.claims[0].original.evidence_unit_ids).toEqual(["u1"]);
    expect(JSON.stringify(request)).toBe(frozenRequest);
    expect(JSON.stringify(output)).toBe(frozenOutput);
  });

  it("preserves all unrelated v2.2.1 behavior on synthetic mechanics, descriptors, generics and discrepancies", () => {
    const request = fixture(["Mira's guards wait.", "Some creatures wait.", "HP 20.", "Mira opened the chest.", "Arlen is not dead."], ["Mira", "Arlen"]);
    const output = { claims: [proposal("Mira's guards wait.", ["Mira guards"]), proposal("Some creatures wait.", ["some creatures"], 1),
      proposal("HP 20.", ["Arlen"], 2), proposal("Arlen opened the chest.", ["Arlen"], 3), proposal("Arlen is dead.", ["Arlen"], 4)] };
    expect({ ...reconcileClaims41V222(output, request), version: "same" }).toEqual({ ...reconcileClaims41V221(output, request), version: "same" });
  });

  it("does not broaden lexical alias discovery when an endpoint is absent from the existing names index", () => {
    const request = fixture(["Arlen also called Silver King."], ["Arlen"]);
    const output = { claims: [proposal("Arlen also called Silver King.", ["Arlen"])] };
    expect({ ...reconcileClaims41V222(output, request), version: "same" }).toEqual({ ...reconcileClaims41V221(output, request), version: "same" });
  });

  it("retains exact canonical locks on a differently worded source relation", () => {
    const request = fixture(["Arlen was a nymph.", "The nymph returned as a wraith.", "The wraith waits."], ["Arlen", "wraith"]);
    const item = run(request, [proposal("Arlen returned as a wraith.", ["Arlen", "wraith"], 1)]).claims[0];
    expect(item.participants.map((entry) => entry.kind)).toEqual(["canonical_entity", "canonical_entity"]);
    expect(item.participants.map((entry) => entry.canonicalId)).toEqual(["e:Arlen", "e:wraith"]);
  });
});
