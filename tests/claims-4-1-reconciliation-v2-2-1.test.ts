import { describe, expect, it } from "vitest";
import type { Claims41Output, Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { CLAIMS_4_1_RECONCILIATION_V2_2_1_VERSION, reconcileClaims41V221 } from "../lib/ai/claims-4-1-reconciliation-v2-2-1";
import { reconcileClaims41V2 } from "../lib/ai/claims-4-1-reconciliation-v2";

function fixture(texts: string[], names: string[] = []): Claims41Request {
  return { requestId: "synthetic-v221", baselineRequestId: "synthetic", inputDifferences: [],
    entities: names.map((name) => ({ canonicalId: `e:${name}`, name, type: "npc", aliases: [] })),
    evidenceUnits: texts.map((text, order) => ({ unitId: `u${order}`, segmentId: "block", page: 1,
      context: "section", kind: "sentence", order, text,
      rawSource: { page: 1, start: order * 200, end: order * 200 + text.length, text } })) };
}
function proposal(statement: string, participants: string[], index = 0) {
  return { statement, participants, evidence_unit_ids: [`u${index}`] };
}
const run = (request: Claims41Request, claims: Claims41Output["claims"]) => reconcileClaims41V221({ claims }, request);

describe("Claims-4.1 Reconciliation v2.2.1 corrective invariants", () => {
  it.each(["became", "returned as", "transformed into", "turned into", "was transformed into", "reincarnated as", "was reincarnated as"])("parses direct transition: %s", (verb) => {
    const statement = `Arlen ${verb} Silver King.`;
    const result = run(fixture([statement], ["Arlen"]), [proposal(statement, ["Arlen", "Silver King"])]);
    expect(result.version).toBe(CLAIMS_4_1_RECONCILIATION_V2_2_1_VERSION);
    expect(result.claims[0].participants.map((item) => item.kind)).toEqual(["canonical_entity", "candidate_entity"]);
    expect(result.claims[0].identityRelations).toEqual([expect.objectContaining({ kind: "identity_transition", sourceClaimIndex: 0 })]);
    expect(result.claims[0].entityAssociations).toHaveLength(2);
    expect(result.candidateEntities[0]).toMatchObject({ name: "Silver King", type: "other", origin: "reconciliation_candidate" });
  });

  it.each(["returned as an undead horror known as", "returned as an undead horror called", "returned as an undead horror named", "became an undead horror known as", "transformed into an undead horror known as"])("shares descriptive bridge parsing for source and claims: %s", (bridge) => {
    const text = `Arlen ${bridge} a wraith.`;
    const request = fixture([text, "Nothing changes.", "Nothing moves.", "Nothing happens.", "The wraith guards the coast."], ["Arlen"]);
    const claims = [proposal("The wraith guards the coast.", ["wraith"], 4), proposal(text, ["Arlen", "wraith"])];
    const result = run(request, claims);
    expect(result.claims[0].participants[0].kind).toBe("candidate_entity");
    expect(result.claims[1].identityRelations).toEqual([expect.objectContaining({ kind: "identity_transition", sourceClaimIndex: 1 })]);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.candidateEntities[0].evidence.map((item) => item.unitId)).toEqual(["u0", "u4"]);
    expect(result.candidateEntities[0].firstSourceOccurrence.unitId).toBe("u0");
    const reversed = run(request, [...claims].reverse());
    expect(reversed.candidateEntities).toEqual(result.candidateEntities);
    expect(reversed.claims[1].participants).toEqual(result.claims[0].participants);
  });

  it("leaves a common-form transition endpoint unresolved without later persistence", () => {
    const text = "Arlen returned as an undead horror known as a wraith.";
    const result = run(fixture([text], ["Arlen"]), [proposal(text, ["Arlen", "wraith"])]);
    expect(result.candidateEntities).toEqual([]);
    expect(result.claims[0].participants[1].kind).toBe("unresolved");
    expect(result.claims[0].identityRelations).toEqual([]);
  });

  it("requires later definite or two bare referential endpoint uses, not generic occurrences", () => {
    const text = "Arlen returned as a wraith.";
    for (const later of [["A wraith waits.", "Some wraith guards wait."], ["wraith guards the coast."],
      ["wraith guards are common.", "wraith guards are soldiers."], ["wraith is a creature class.", "wraith is an undead species."]]) {
      const result = run(fixture([text, ...later], ["Arlen"]), [proposal(text, ["Arlen", "wraith"])]);
      expect(result.candidateEntities).toEqual([]);
    }
    const request = fixture([text, "wraith guards the coast.", "wraith waits at the bridge."], ["Arlen"]);
    const result = run(request, [proposal(text, ["Arlen", "wraith"])]);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.candidateEntities[0].evidence.map((item) => item.unitId)).toEqual(["u0", "u1", "u2"]);
    expect(run(fixture(["The wraith waits.", text], ["Arlen"]), [proposal(text, ["Arlen", "wraith"], 1)]).candidateEntities).toEqual([]);
    const otherVerbs = fixture([text, "wraith whispered to the messenger.", "wraith dances."], ["Arlen"]);
    expect(run(otherVerbs, [proposal(text, ["Arlen", "wraith"])]).candidateEntities).toHaveLength(1);
  });

  it.each([".", ";", "?", "!"])("does not bridge the clause boundary %s", (boundary) => {
    const text = `Arlen returned as an undead horror${boundary} known as a wraith.`;
    const result = run(fixture([text, "The wraith waits."], ["Arlen"]), [proposal(text, ["Arlen", "wraith"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
    expect(result.claims[0].participants[1].kind).toBe("unresolved");
  });

  it("enforces the twelve-token descriptive bridge bound", () => {
    for (const count of [12, 13]) {
      const text = `Arlen returned as ${Array(count).fill("ancient").join(" ")} known as a wraith.`;
      const result = run(fixture([text, "The wraith waits."], ["Arlen"]), [proposal(text, ["Arlen", "wraith"])]);
      expect(result.claims[0].identityRelations.length).toBe(count === 12 ? 1 : 0);
    }
  });

  it("requires the same explicit relation in source and an existing extracted claim", () => {
    const request = fixture(["Arlen returned as Silver King.", "Silver King waits."], ["Arlen"]);
    const result = run(request, [proposal("Silver King waits.", ["Silver King"], 1)]);
    expect(result.claims.flatMap((item) => item.identityRelations)).toEqual([]);
    const unsupported = run(fixture(["Arlen meets Silver King."], ["Arlen"]), [proposal("Arlen became Silver King.", ["Arlen", "Silver King"])]);
    expect(unsupported.claims[0].identityRelations).toEqual([]);
    expect(result.claims).toHaveLength(1);
  });

  it.each(["also known as", "also called", "became known as", "was formerly known as"])("keeps pure naming as one identity: %s", (marker) => {
    const text = `Arlen ${marker} Silver King.`;
    const request = fixture([text, "Silver King rules the coast."]);
    const result = run(request, [proposal("Silver King rules the coast.", ["Silver King"], 1), proposal(text, ["Arlen", "Silver King"])]);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.claims[1].participants[0].canonicalId).toBe(result.claims[0].participants[0].canonicalId);
    expect(result.claims[1].identityRelations[0]).toMatchObject({ kind: "same_identity_alias", sourceClaimIndex: 1 });
    expect(result.aliasMetadata[0].alias).toBe("Silver King");
  });

  it.each([
    ["Mira guards", "The guards of Mira wait."],
    ["Mira's students", "Mira students wait."],
    ["priests of Mira", "Mira's priest waits."],
    ["Mira followers", "A follower of Mira waits."],
    ["Mira armies", "The army of Mira waits."],
    ["Mira chambers", "Mira's chamber is empty."],
    ["Mira clergy", "The clergy of Mira wait."],
    ["guards", "The guards of Mira wait."],
  ])("matches equivalent explicit descriptor forms: %s", (mention, text) => {
    const item = run(fixture([text], ["Mira"]), [proposal(text, [mention])]).claims[0];
    expect(item.participants[0]).toMatchObject({ mention, kind: "descriptor", canonicalId: "e:Mira" });
    expect(item.participants[0].supportingEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
  });

  it("retains the derived adjectival-parent mechanism without named demonym exceptions", () => {
    const text = "The Miran fleet patrols the sea.";
    expect(run(fixture([text], ["Mira"]), [proposal(text, ["Miran fleet"])]).claims[0].participants[0].kind).toBe("descriptor");
  });

  it("does not infer descriptor parentage or identity from co-occurrence or interaction", () => {
    const text = "Mira meets guards at the citadel.";
    const item = run(fixture([text], ["Mira"]), [proposal(text, ["Mira guards", "guards"])]).claims[0];
    expect(item.participants[0].kind).toBe("unresolved");
    expect(item.participants[1].kind).toBe("generic_non_entity");
    expect(item.identityRelations).toEqual([]);
    const verb = run(fixture(["Mira guards the citadel."], ["Mira"]), [proposal("Mira guards the citadel.", ["Mira guards"])]).claims[0];
    expect(verb.participants[0].kind).toBe("unresolved");
  });

  it("does not guess between explicit descriptor parents", () => {
    const text = "Mira's guards and the guards of Nera wait.";
    const item = run(fixture([text], ["Mira", "Nera"]), [proposal(text, ["guards"])]).claims[0];
    expect(item.participants[0].kind).toBe("unresolved");
    expect(item.entityAssociations).toEqual([]);
  });

  it.each(["ragged soldiers", "several frightened villagers", "captured creatures", "ordinary wooden objects", "cold iron"])("classifies common non-unique noun phrases conservatively: %s", (mention) => {
    const text = `${mention} remain outside.`;
    expect(run(fixture([text]), [proposal(text, [mention])]).claims[0].participants[0].kind).toBe("generic_non_entity");
  });

  it.each(["native", "local", "several", "many", "some", "ordinary", "captured", "generic"])("does not promote capitalization used only in %s collectives", (modifier) => {
    const text = `The ${modifier} Velori wait outside.`;
    const result = run(fixture([text]), [proposal(text, ["Velori"])]);
    expect(result.candidateEntities).toEqual([]);
    expect(result.claims[0].participants[0].kind).not.toBe("candidate_entity");
  });

  it("preserves one-occurrence proper names and source-named independent groups as local candidates", () => {
    const texts = ["Mira enters the citadel.", "The guild named Silver Guards."];
    const request = fixture(texts);
    const before = structuredClone(request);
    const result = run(request, texts.map((text, index) => proposal(text, [index ? "Silver Guards" : "Mira"], index)));
    expect(result.claims.map((item) => item.participants[0].kind)).toEqual(["candidate_entity", "candidate_entity"]);
    expect(result.candidateEntities[1].type).toBe("faction");
    expect(request).toEqual(before);
    expect(run(request, result.rawProposals.claims)).toEqual(result);
  });

  it("leaves uncertain proper names, unique titles and definite references unresolved", () => {
    const result = run(fixture(["The sovereign waits."]), [proposal("The sovereign waits.", ["Orin", "the sovereign", "angry"])]);
    expect(result.claims[0].participants.map((item) => item.kind)).toEqual(["unresolved", "unresolved", "unresolved"]);
  });

  it("adds required pronoun provenance to locked canonical participants without changing resolution", () => {
    const request = fixture(["Unused nearby wording.", "Arlen entered the chamber.", "She opened the chest."], ["Arlen"]);
    request.evidenceUnits[1].page = request.evidenceUnits[1].rawSource.page = 2;
    request.evidenceUnits[2].page = request.evidenceUnits[2].rawSource.page = 3;
    const original = proposal("Arlen opened the chest.", ["Arlen"], 2);
    const item = run(request, [original]).claims[0];
    expect(item.participants[0]).toMatchObject({ kind: "canonical_entity", canonicalId: "e:Arlen" });
    expect(item.participants[0].supportingEvidence).toEqual([expect.objectContaining({ unitId: "u1", direct: false })]);
    expect(item.contextEvidence.map((entry) => entry.unitId)).toEqual(["u1"]);
    expect(item.directEvidence.map((entry) => entry.unitId)).toEqual(["u2"]);
    expect(item.original).toEqual(original);
  });

  it("adds pronoun provenance to candidates and resolves unresolved definite references", () => {
    const request = fixture(["Arlen entered the chamber.", "She opened the chest.", "Arlen is a dragon.", "The dragon rests."]);
    const result = run(request, [proposal("Arlen entered the chamber.", ["Arlen"]),
      proposal("Arlen opened the chest.", ["Arlen"], 1), proposal("The dragon rests.", ["the dragon"], 3)]);
    expect(result.claims[1].participants[0].kind).toBe("candidate_entity");
    expect(result.claims[1].contextEvidence.map((item) => item.unitId)).toEqual(["u0"]);
    expect(result.claims[2].participants[0].canonicalId).toBe(result.candidateEntities[0].canonicalId);
    expect(result.claims[2].contextEvidence.map((item) => item.unitId)).toEqual(["u2"]);
  });

  it("keeps context bounded, structurally scoped and unambiguous", () => {
    for (const mode of ["distant", "section", "ambiguous"]) {
      const request = mode === "distant" ? fixture(["Arlen entered the chamber.", "Nothing changes.", "Nothing moves.", "She opened the chest."], ["Arlen"]) :
        fixture(["Arlen entered the chamber.", mode === "ambiguous" ? "Mira entered the chamber." : "Nothing changes.", "She opened the chest."], ["Arlen", "Mira"]);
      if (mode === "section") request.evidenceUnits[0].context = "other-section";
      const item = run(request, [proposal("Arlen opened the chest.", ["Arlen"], request.evidenceUnits.length - 1)]).claims[0];
      expect(item.participants[0].kind).toBe("canonical_entity");
      expect(item.contextEvidence).toEqual([]);
    }
  });

  it("supports a multiword definite reference for an already canonical participant", () => {
    const request = fixture(["Arlen is an ancient dragon.", "The ancient dragon opened the chest."], ["Arlen"]);
    const item = run(request, [proposal("Arlen opened the chest.", ["Arlen"], 1)]).claims[0];
    expect(item.participants[0].kind).toBe("canonical_entity");
    expect(item.contextEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
  });

  it("shares case-normalized transition discovery and avoids duplicate article endpoints", () => {
    const request = fixture(["arlen returned as a wraith.", "The wraith waits."], ["Arlen"]);
    const result = run(request, [proposal("Arlen returned as a wraith.", ["Arlen", "a wraith", "wraith"])]);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.claims[0].participants[1].canonicalId).toBe(result.claims[0].participants[2].canonicalId);
    expect(result.claims[0].identityRelations).toHaveLength(1);
  });

  it("rejects an unknown competing proper-name antecedent and unused literal-name context", () => {
    const request = fixture(["Arlen entered the chamber with Nera.", "She opened the chest."], ["Arlen"]);
    expect(run(request, [proposal("Arlen opened the chest.", ["Arlen"], 1)]).claims[0].contextEvidence).toEqual([]);
    const literal = fixture(["Arlen entered the chamber.", "Arlen opened the chest."], ["Arlen"]);
    expect(run(literal, [proposal("Arlen opened the chest.", ["Arlen"], 1)]).claims[0].contextEvidence).toEqual([]);
  });

  it("resolves alias chains to their inventory anchor without creating a second subject", () => {
    const request = fixture(["Arlen also known as Silver King.", "Silver King also known as Mira.", "Arlen waits."], ["Mira"]);
    const result = run(request, [proposal("Arlen waits.", ["Arlen"], 2), proposal(request.evidenceUnits[0].text, ["Arlen", "Silver King"]),
      proposal(request.evidenceUnits[1].text, ["Silver King", "Mira"], 1)]);
    expect(result.candidateEntities).toEqual([]);
    expect(result.claims[0].participants[0].canonicalId).toBe("e:Mira");
    expect(result.claims.flatMap((item) => item.identityRelations).every((relation) => relation.sourceClaimIndex !== null)).toBe(true);
  });

  it("flags only a high-confidence substituted proposition sharing direct evidence", () => {
    const text = "Mira opened the chest. Arlen rested by the door.";
    // The substituted proposition is in its own direct unit; a neighboring assertion shares it.
    const request = fixture(["Mira opened the chest. The chest was wooden."], ["Mira", "Arlen"]);
    const result = run(request, [proposal("Arlen opened the chest.", ["Arlen"]), proposal("The chest was wooden.", ["chest"])]);
    expect(result.claims[0].reviewReasons).toContain("source_discrepancy");
    expect(result.claims[0].resolutionState).toBe("needs_review");
    expect(result.claims[1].reviewReasons).not.toContain("source_discrepancy");
    expect(run(fixture([text], ["Mira", "Arlen"]), [proposal("Arlen slept in the garden.", ["Arlen"])]).claims[0].reviewReasons).not.toContain("source_discrepancy");
    expect(run(fixture([text], ["Mira", "Arlen"]), [proposal("Arlen opened the chest.", ["Arlen"])]).claims[0].reviewReasons).toContain("source_discrepancy");
    expect(run(fixture(["Mira opened the chest. Arlen opened the chest."], ["Mira", "Arlen"]),
      [proposal("Arlen opened the chest.", ["Arlen"])]).claims[0].reviewReasons).not.toContain("source_discrepancy");
  });

  it("normalizes substitution skeletons and avoids alias/coreference false positives", () => {
    const item = run(fixture(["The Silver King opened the chest!"], ["Silver King", "Arlen"]), [proposal("Arlen opened the chest.", ["Arlen"])]).claims[0];
    expect(item.reviewReasons).toContain("source_discrepancy");
    const request = fixture(["Silver King opened the chest."], ["Arlen"]);
    request.entities[0].aliases = ["Silver King"];
    expect(run(request, [proposal("Arlen opened the chest.", ["Arlen"])]).claims[0].reviewReasons).not.toContain("source_discrepancy");
    const pronounRequest = fixture(["Arlen entered the chamber.", "She opened the chest."], ["Arlen"]);
    expect(run(pronounRequest, [proposal("Arlen opened the chest.", ["Arlen"], 1)]).claims[0].reviewReasons).not.toContain("source_discrepancy");
  });

  it("retains explicit-negation discrepancy detection without repairing statements", () => {
    const claim = proposal("Arlen is dead.", ["Arlen"]);
    const item = run(fixture(["Arlen is not dead."], ["Arlen"]), [claim]).claims[0];
    expect(item.reviewReasons).toContain("source_discrepancy");
    expect(item.original).toEqual(claim);
  });

  it.each(["AC 15; HP 40; Immunities poison; Saving Throws Dexterity +3; Damage 2d6 fire.",
    "The creature has armor class 18.", "The creature has resistance to fire.", "The creature has vulnerability to cold.",
    "The creature has attack bonus +5 to-hit.", "The creature has movement speed 30 feet.", "The creature has initiative +2.",
    "The creature is immune to fire and poison.", "Wisdom save +3.",
    "Multiattack. The creature makes two attacks each turn.", "Melee Weapon Attack: +5 to hit. Hit: 2d6 damage.",
    "A creature makes a DC 15 ability check.", "Repeat the saving throw each turn.", "When reduced to 20 hit points, the creature flees to area B."])("keeps pure stat-block/threshold procedure out of GM Review: %s", (text) => {
    const result = run(fixture([text], ["Heroes / Party"]), [proposal(text, ["Heroes / Party"])]);
    expect(result.claims[0]).toMatchObject({ wikiDisposition: "mechanical_only", resolutionState: null, entityAssociations: [], reviewReasons: [] });
    expect(result.gmReview).toEqual([]);
    expect(result.candidateEntities).toEqual([]);
  });

  it.each(["The creature fled the city after the king died.", "Arlen guards the citadel and has AC 18.",
    "Arlen is a knight with AC 18.", "Arlen was born with immunity to fire.", "The artifact empowers movement through walls.",
    "When reduced to 20 hit points, the creature flees to area B and Arlen inherits the city."])("preserves narrative and mixed claims unchanged and unsplit: %s", (text) => {
    const claim = proposal(text, ["Arlen"]);
    const result = run(fixture([text], ["Arlen"]), [claim]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].wikiDisposition).toBe("present");
    expect(result.rawProposals.claims).toEqual([claim]);
    expect(result.claims[0].original).toEqual(claim);
  });

  it("locks exact canonical entities and known aliases before all corrective stages", () => {
    const request = fixture(["Mira's students wait. Arlen became Silver King. Some guards wait."], ["Mira", "Mira's students", "Arlen", "Silver King", "some guards"]);
    request.entities[1].aliases = ["Mira students"];
    const item = run(request, [proposal(request.evidenceUnits[0].text, ["Mira's students", "Mira students", "some guards", "Silver King"])]).claims[0];
    expect(item.participants.map((entry) => entry.kind)).toEqual(Array(4).fill("canonical_entity"));
    expect(item.participants.map((entry) => entry.canonicalId)).toEqual(["e:Mira's students", "e:Mira's students", "e:some guards", "e:Silver King"]);
  });

  it("never demotes an independently source-named candidate group to a descriptor", () => {
    const text = "The guild named Silver Guards. The guards of Silver wait.";
    const result = run(fixture([text], ["Silver"]), [proposal(text, ["Silver Guards"])]);
    expect(result.claims[0].participants[0].kind).toBe("candidate_entity");
  });

  it("never creates or rewrites a claim on any exercised stage, or mutates inputs", () => {
    const texts = ["Arlen became Silver King.", "Silver King guards the coast.", "Mira's followers wait.", "Some creatures wait.", "HP 20."];
    const request = fixture(texts, ["Arlen", "Mira"]);
    const output = { claims: texts.map((text, index) => proposal(` ${text} `, [["Arlen", "Silver King"], ["Silver King"], ["Mira followers"], ["some creatures"], ["creature"]][index], index)) };
    const before = structuredClone({ request, output });
    const result = reconcileClaims41V221(output, request);
    expect(result.claims.map((item) => item.original)).toEqual(output.claims);
    expect(result.claims.map((item) => item.proposalIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(result.rawProposals).toEqual(output);
    expect({ request, output }).toEqual(before);
  });

  it("retains v2 Campaign Timeline association semantics", () => {
    const request = fixture(["November*", "Arlen plans to guard the coast.", "Arlen loses the coast.", "GM: read aloud."] , ["Arlen"]);
    request.evidenceUnits[0].kind = "heading";
    request.evidenceUnits[0].context = request.evidenceUnits[1].context = "full_campaign_timeline_assuming_heroes_succeed";
    request.evidenceUnits[2].context = "what_if_they_do_nothing";
    request.evidenceUnits[3].context = "full_campaign_timeline_assuming_heroes_succeed";
    const claims = [proposal(request.evidenceUnits[1].text, ["Arlen"], 1), proposal(request.evidenceUnits[2].text, ["Arlen"], 2), proposal(request.evidenceUnits[3].text, [], 3)];
    expect(run(request, claims).claims.map((item) => item.timelineAssociation)).toEqual(reconcileClaims41V2({ claims }, request).claims.map((item) => item.timelineAssociation));
  });
});
