import { describe, expect, it } from "vitest";
import type { Claims41Output, Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41V22 } from "../lib/ai/claims-4-1-reconciliation-v2-2";
import { reconcileClaims41V2 } from "../lib/ai/claims-4-1-reconciliation-v2";

function fixture(texts: string[], names: string[] = []): Claims41Request {
  return { requestId: "synthetic-v22", baselineRequestId: "synthetic", inputDifferences: [],
    entities: names.map((name) => ({ canonicalId: `e:${name}`, name, type: "npc", aliases: [] })),
    evidenceUnits: texts.map((text, order) => ({ unitId: `u${order}`, segmentId: "block", page: 1,
      context: "section-a", kind: "sentence", order, text,
      rawSource: { page: 1, start: order * 100, end: order * 100 + text.length, text } })) };
}
function proposal(statement: string, participants: string[], index = 0) {
  return { statement, participants, evidence_unit_ids: [`u${index}`] };
}
const run = (request: Claims41Request, claims: Claims41Output["claims"]) => reconcileClaims41V22({ claims }, request);

describe("Claims-4.1 Reconciliation v2.2 offline invariants", () => {
  it("locks exact canonical names and known aliases against later descriptor and generic demotion", () => {
    const request = fixture(["Guards of Citadel defend Citadel. A creature waits."], ["Guards of Citadel", "Citadel", "a creature"]);
    request.entities[0].aliases = ["Citadel staff"];
    const item = run(request, [proposal(request.evidenceUnits[0].text, ["Guards of Citadel", "Citadel staff", "a creature"])]).claims[0];
    expect(item.participants.map((entry) => entry.kind)).toEqual(["canonical_entity", "canonical_entity", "canonical_entity"]);
    expect(item.participants[0].canonicalId).toBe("e:Guards of Citadel");
    expect(item.participants[1].canonicalId).toBe("e:Guards of Citadel");
  });

  it("uses explicit aliases as one subject, with metadata and no inventory mutation", () => {
    for (const inventory of [["Arlen"], []]) {
      const request = fixture(["Arlen, also known as Silver King.", "Silver King rules the coast."], inventory);
      const before = structuredClone(request);
      const result = run(request, [proposal("Arlen, also known as Silver King.", ["Arlen", "Silver King"]),
        proposal("Silver King rules the coast.", ["Silver King"], 1)]);
      expect(result.claims[0].participants[0].canonicalId).toBe(result.claims[0].participants[1].canonicalId);
      expect(result.candidateEntities).toHaveLength(inventory.length ? 0 : 1);
      expect(result.aliasMetadata).toContainEqual(expect.objectContaining({ alias: "Silver King" }));
      expect(request).toEqual(before);
    }
  });

  it.each(["Arlen is also known as Silver King.", "Arlen's nickname is Silver King.", "Arlen was renamed Silver King.",
    "Arlen became known as Silver King.", "Arlen was formerly known as Silver King."])("retains explicit naming changes as one identity: %s", (statement) => {
    const result = run(fixture([statement]), [proposal(statement, ["Arlen", "Silver King"])]);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.claims[0].participants[0].canonicalId).toBe(result.claims[0].participants[1].canonicalId);
    expect(result.claims[0].identityRelations[0].kind).toBe("same_identity_alias");
  });

  it("keeps persistent transition endpoints independently linkable using only the existing claim", () => {
    const request = fixture(["Arlen became Silver King.", "Silver King rules the coast."], ["Arlen"]);
    const claims = [proposal("Arlen became Silver King.", ["Arlen", "Silver King"]),
      proposal("Silver King rules the coast.", ["Silver King"], 1)];
    const result = run(request, claims);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.candidateEntities[0]).toMatchObject({ name: "Silver King", type: "other", aliases: [], origin: "reconciliation_candidate" });
    expect(result.claims[0].participants.map((entry) => entry.kind)).toEqual(["canonical_entity", "candidate_entity"]);
    expect(result.claims[0].identityRelations).toContainEqual(expect.objectContaining({ kind: "identity_transition", sourceClaimIndex: 0 }));
    expect(result.claims[0].entityAssociations).toHaveLength(2);
    expect(result.claims.map((item) => item.original)).toEqual(claims);
    expect(result.rawProposals.claims).toEqual(claims);
    expect(result.claims).toHaveLength(claims.length);
    expect(result.claims[1].participants[0].canonicalId).toBe(result.candidateEntities[0].canonicalId);
  });

  it("does not collapse descriptive changes or synthesize a missing transition claim", () => {
    const request = fixture(["Arlen became angry.", "Arlen returned as Silver King.", "Silver King rules the coast."], ["Arlen"]);
    const result = run(request, [proposal("Arlen became angry.", ["Arlen", "angry"]),
      proposal("Silver King rules the coast.", ["Silver King"], 2)]);
    expect(result.claims[0].participants[1].kind).toBe("unresolved");
    expect(result.claims.flatMap((claim) => claim.identityRelations)).toEqual([]);
    expect(result.claims).toHaveLength(2);
  });

  it("requires persistence for an unnamed transition form and retains separate identities", () => {
    const request = fixture(["Arlen returned as a wraith.", "The wraith guards Citadel."], ["Arlen", "Citadel"]);
    const claims = [proposal("Arlen returned as a wraith.", ["Arlen", "wraith"]),
      proposal("The wraith guards Citadel.", ["wraith", "Citadel"], 1)];
    const result = run(request, claims);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.claims[0].identityRelations).toContainEqual(expect.objectContaining({ kind: "identity_transition", sourceClaimIndex: 0 }));
    expect(result.claims[0].entityAssociations).toHaveLength(2);
    const uncertain = run(fixture(["Arlen returned as a wraith."], ["Arlen"]), [claims[0]]);
    expect(uncertain.candidateEntities).toEqual([]);
    expect(uncertain.claims[0].participants[1].kind).toBe("unresolved");
  });

  it("does not collapse two locked inventory entities through an alias assertion", () => {
    const request = fixture(["Arlen, also called Silver King."], ["Arlen", "Silver King"]);
    const item = run(request, [proposal(request.evidenceUnits[0].text, ["Arlen", "Silver King"])]).claims[0];
    expect(item.participants.map((entry) => entry.canonicalId)).toEqual(["e:Arlen", "e:Silver King"]);
  });

  it("retains explicit source aliases across the source without using document-wide coreference", () => {
    const request = fixture(["Arlen, also known as Silver King.", "Nothing happens.", "Nothing changes.",
      "Nothing moves.", "Silver King guards Citadel."], ["Arlen", "Citadel"]);
    const result = run(request, [proposal("Silver King guards Citadel.", ["Silver King", "Citadel"], 4)]);
    expect(result.claims[0].participants[0].canonicalId).toBe("e:Arlen");
    expect(result.candidateEntities).toEqual([]);
    expect(result.claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
  });

  it("keeps an alias with conflicting inventory anchors unresolved", () => {
    const request = fixture(["Arlen, also called Silver King.", "Mira, also called Silver King.", "Silver King waits."], ["Arlen", "Mira"]);
    const item = run(request, [proposal("Silver King waits.", ["Silver King"], 2)]).claims[0];
    expect(item.participants[0].kind).toBe("unresolved");
    expect(item.entityAssociations).toEqual([]);
  });

  it("creates deterministic local candidates only from grounded independent names", () => {
    const request = fixture(["Mira visits Citadel. Several guards carry ordinary swords."], ["Citadel"]);
    const before = structuredClone(request);
    const claims = [proposal(request.evidenceUnits[0].text, ["Mira", "Citadel", "several guards", "ordinary swords", "Missing Name"])];
    const result = run(request, claims);
    expect(result.claims[0].participants.map((entry) => entry.kind)).toEqual([
      "candidate_entity", "canonical_entity", "generic_non_entity", "generic_non_entity", "unresolved"]);
    expect(result.candidateEntities).toHaveLength(1);
    expect(result.candidateEntities[0].evidence[0].text).toBe(request.evidenceUnits[0].rawSource.text);
    expect(result.candidateEntities[0].firstSourceOccurrence).toMatchObject({ unitId: "u0", sourceOrder: 0 });
    expect(run(request, claims).candidateEntities).toEqual(result.candidateEntities);
    expect(request).toEqual(before);
  });

  it("does not add repeated nearby occurrences when a proper name is already grounded directly", () => {
    const request = fixture(["Mira rests.", "Mira guards Citadel."], ["Citadel"]);
    const item = run(request, [proposal("Mira guards Citadel.", ["Mira", "Citadel"], 1)]).claims[0];
    expect(item.participants[0].kind).toBe("candidate_entity");
    expect(item.contextEvidence).toEqual([]);
  });

  it("considers candidates before descriptors and completes candidate discovery before parent resolution", () => {
    const request = fixture(["Guards of Mira defend Mira."], []);
    const result = run(request, [proposal("Guards of Mira defend Mira.", ["Guards of Mira", "Mira"])]);
    expect(result.claims[0].participants.map((entry) => entry.kind)).toEqual(["descriptor", "candidate_entity"]);
    expect(result.claims[0].participants[0]).toMatchObject({ mention: "Guards of Mira", canonicalId: result.candidateEntities[0].canonicalId });
    expect(result.claims[0].participants[0].supportingEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
  });

  it("requires explicit descriptor parent evidence and never uses co-occurrence, location or actions", () => {
    const request = fixture(["Citadel and northern guards wait. Northern guards attack Mira near Citadel."], ["Citadel", "Mira"]);
    const result = run(request, [proposal(request.evidenceUnits[0].text, ["northern guards", "Citadel"])]);
    expect(result.claims[0].participants[0].kind).toBe("unresolved");
    expect(result.claims[0].entityAssociations.map((entry) => entry.canonicalName)).toEqual(["Citadel"]);
  });

  it("never infers identity from co-occurrence or lexical resemblance", () => {
    const request = fixture(["Mira meets Mirana at Citadel."], ["Mira", "Citadel"]);
    const result = run(request, [proposal(request.evidenceUnits[0].text, ["Mira", "Mirana", "Citadel"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
    expect(result.claims[0].participants[1]).toMatchObject({ kind: "candidate_entity" });
    expect(result.claims[0].participants[1].canonicalId).not.toBe("e:Mira");
  });

  it("keeps ambiguous definite references and unfamiliar concepts unresolved", () => {
    const request = fixture(["The stranger observes the phenomenon."], []);
    const result = run(request, [proposal(request.evidenceUnits[0].text, ["the stranger", "the phenomenon", "mystery"])]);
    expect(result.claims[0].participants.every((item) => item.kind === "unresolved")).toBe(true);
    expect(result.candidateEntities).toEqual([]);
    expect(result.gmReview).toHaveLength(1);
  });

  it("recognizes a source-named independent group before subordinate descriptor inference", () => {
    const request = fixture(["An independent faction is named Silver Guards.", "Silver Guards defend Citadel."], ["Citadel"]);
    const result = run(request, [proposal("Silver Guards defend Citadel.", ["Silver Guards", "Citadel"], 1)]);
    expect(result.claims[0].participants[0].kind).toBe("candidate_entity");
    expect(result.candidateEntities[0].name).toBe("Silver Guards");
    expect(result.candidateEntities[0].type).toBe("faction");
    expect(result.claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
  });

  it("can establish a repeated unique definite designation without generic promotion", () => {
    const request = fixture(["The keeper of dusk waits.", "The keeper of dusk guards Citadel."], ["Citadel"]);
    const result = run(request, [proposal(request.evidenceUnits[1].text, ["the keeper of dusk", "Citadel"], 1)]);
    expect(result.claims[0].participants[0].kind).toBe("candidate_entity");
    expect(result.claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
    const generic = run(fixture(["The creature waits.", "The creature sleeps."]), [proposal("The creature sleeps.", ["the creature"], 1)]);
    expect(generic.candidateEntities).toEqual([]);
  });

  it("resolves bounded explicit references across pages and records only used context", () => {
    const request = fixture(["Citadel stands nearby.", "Arlen, a dragon.", "The dragon guards Citadel.", "Mira rests."], ["Arlen", "Citadel", "Mira"]);
    request.evidenceUnits[2].page = 2;
    request.evidenceUnits[2].rawSource.page = 2;
    request.evidenceUnits[2].segmentId = "page-two";
    const result = run(request, [proposal("The dragon guards Citadel.", ["the dragon", "Citadel"], 2)]);
    expect(result.claims[0].participants[0]).toMatchObject({ kind: "canonical_entity", canonicalId: "e:Arlen" });
    expect(result.claims[0].contextEvidence.map((item) => item.unitId)).toEqual(["u1"]);
    expect(result.claims[0].directEvidence.map((item) => item.unitId)).toEqual(["u2"]);
    expect(result.claims[0].original.evidence_unit_ids).toEqual(["u2"]);
  });

  it("rejects context outside the 2-before/1-after window or structural section", () => {
    const request = fixture(["Arlen, a dragon.", "Nothing happens.", "Nothing changes.", "The dragon waits."], ["Arlen"]);
    expect(run(request, [proposal("The dragon waits.", ["the dragon"], 3)]).claims[0].participants[0].kind).toBe("unresolved");
    request.evidenceUnits[2].text = "Arlen, a dragon.";
    request.evidenceUnits[2].context = "different-room";
    expect(run(request, [proposal("The dragon waits.", ["the dragon"], 3)]).claims[0].contextEvidence).toEqual([]);
  });

  it("permits the immediately following unit but excludes the second following unit", () => {
    const request = fixture(["The dragon waits.", "Arlen, a dragon."], ["Arlen"]);
    expect(run(request, [proposal("The dragon waits.", ["the dragon"])]).claims[0].contextEvidence.map((entry) => entry.unitId)).toEqual(["u1"]);
    const distant = fixture(["The dragon waits.", "Nothing happens.", "Arlen, a dragon."], ["Arlen"]);
    expect(run(distant, [proposal("The dragon waits.", ["the dragon"])]).claims[0].participants[0].kind).toBe("unresolved");
  });

  it("resolves an unambiguous pronoun but keeps multiple antecedents unresolved", () => {
    const request = fixture(["Arlen rests.", "He guards Citadel."], ["Arlen", "Citadel"]);
    expect(run(request, [proposal("He guards Citadel.", ["he", "Citadel"], 1)]).claims[0].contextEvidence.map((item) => item.unitId)).toEqual(["u0"]);
    request.evidenceUnits[0].text = "Arlen meets Mira.";
    request.entities.push({ canonicalId: "e:Mira", name: "Mira", type: "npc", aliases: [] });
    expect(run(request, [proposal("He guards Citadel.", ["he", "Citadel"], 1)]).claims[0].participants[0].kind).toBe("unresolved");
  });

  it("flags only the proposition contradicted by shared direct evidence", () => {
    const request = fixture(["Arlen is not alive. Citadel is intact."], ["Arlen", "Citadel"]);
    const result = run(request, [proposal("Arlen is alive.", ["Arlen"]), proposal("Citadel is intact.", ["Citadel"])]);
    expect(result.claims[0].reviewReasons).toContain("source_discrepancy");
    expect(result.claims[0].original.statement).toBe("Arlen is alive.");
    expect(result.claims[1].reviewReasons).toEqual([]);
    expect(result.claims[1].resolutionState).toBe("resolved");
  });

  it("does not scan unused neighboring propositions for discrepancies", () => {
    const request = fixture(["Arlen is alive.", "Arlen is not alive."], ["Arlen"]);
    const result = run(request, [proposal("Arlen is alive.", ["Arlen"])]);
    expect(result.claims[0].contextEvidence).toEqual([]);
    expect(result.claims[0].reviewReasons).toEqual([]);
  });

  it.each(["A character must make a DC 15 Wisdom saving throw.", "Arlen has AC 18.", "Arlen has 40 hit points.",
    "A creature takes 2d6 damage.", "Arlen must make an attack roll.", "Arlen has movement speed of 30."])(
    "keeps purely mechanical claims out of GM Review and Party associations: %s", (statement) => {
      const result = run(fixture([statement], ["Arlen"]), [proposal(statement, ["Arlen", "Heroes / Party"])]);
      expect(result.claims[0]).toMatchObject({ wikiDisposition: "mechanical_only", resolutionState: null, entityAssociations: [], reviewReasons: [] });
      expect(result.gmReview).toEqual([]);
      expect(result.diagnostics.resolved).toBe(0);
    });

  it.each(["Citadel guards the valley; its defenders make an attack roll.", "Citadel collapses when a character fails a DC 15 check.",
    "Arlen is a dragon with AC 18."])(
    "preserves mixed narrative and mechanics without splitting: %s", (statement) => {
      const claim = proposal(statement, ["Citadel"]);
      const result = run(fixture([statement], ["Citadel"]), [claim]);
      expect(result.claims[0].wikiDisposition).toBe("present");
      expect(result.claims.map((item) => item.original)).toEqual([claim]);
    });

  it("retains genuine Party narrative and both v2 timeline branches", () => {
    const request = fixture(["November * — The war begins.", "The heroes enter Citadel.", "Without the heroes, the war continues."], ["Citadel"]);
    request.entities.push({ canonicalId: "system:heroes-party", name: "Heroes / Party", type: "other", aliases: [] });
    request.evidenceUnits.slice(0, 2).forEach((unit) => { unit.context = "full_campaign_timeline_assuming_heroes_succeed"; });
    request.evidenceUnits[2].context = "what_if_they_do_nothing";
    const result = run(request, [proposal("The heroes enter Citadel.", ["Heroes / Party", "Citadel"], 1),
      proposal("Without the heroes, the war continues.", [], 2)]);
    expect(result.claims[0].participants[0].canonicalId).toBe("system:heroes-party");
    expect(result.claims[0].timelineAssociation).toMatchObject({ timeLabel: "November", branch: "main_assuming_heroes_succeed" });
    expect(result.claims[1].timelineAssociation).toMatchObject({ timeLabel: null, branch: "heroes_do_nothing" });
    expect(result.claims.every((claim) => claim.resolutionState === "resolved")).toBe(true);
  });

  it("requires valid provenance and a safe home without inventing an association", () => {
    const request = fixture(["Water flows."], ["Citadel"]);
    const claims = [proposal("Water flows.", ["water"]), proposal("Citadel is intact.", ["Citadel"], 8)];
    const result = run(request, claims);
    expect(result.claims[0].reviewReasons).toContain("no_useful_home");
    expect(result.claims[0].entityAssociations).toEqual([]);
    expect(result.claims[1].reviewReasons).toContain("unknown_evidence_unit");
  });

  it("validates used context provenance as well as direct evidence", () => {
    const request = fixture(["Arlen, a dragon.", "The dragon waits."], ["Arlen"]);
    request.evidenceUnits[0].rawSource.end = -1;
    const item = run(request, [proposal("The dragon waits.", ["the dragon"], 1)]).claims[0];
    expect(item.reviewReasons).toContain("invalid_source_mapping");
    expect(item.resolutionState).toBe("needs_review");
  });

  it("matches v2 timeline behavior for month propagation, intros, plans, GM prose and alternate branches", () => {
    const texts = ["Timeline introduction.", "November * — Arlen arrives.", "Arlen plans to enter Citadel.",
      "March * — Citadel collapses.", "The GM may compress the timeline.", "Without heroes, Citadel collapses."];
    const request = fixture(texts, ["Arlen", "Citadel"]);
    request.evidenceUnits.forEach((unit) => { unit.context = "full_campaign_timeline_assuming_heroes_succeed"; });
    request.evidenceUnits[5].context = "what_if_they_do_nothing";
    const claims = texts.map((text, index) => proposal(text, [], index));
    expect(run(request, claims).claims.map((item) => item.timelineAssociation)).toEqual(
      reconcileClaims41V2({ claims }, request).claims.map((item) => item.timelineAssociation));
  });

  it("retains proposal bytes, order, duplicates, participant arrays and source mappings", () => {
    const request = fixture(["Arlen rules Citadel."], ["Arlen", "Citadel"]);
    const claim = proposal("  Arlen rules Citadel.  ", ["Arlen", "Citadel"]);
    const output = { claims: [claim, structuredClone(claim)] };
    const before = structuredClone({ request, output });
    const result = reconcileClaims41V22(output, request);
    expect(result.rawProposals).toEqual(output);
    expect(result.claims.map((item) => item.original)).toEqual(output.claims);
    expect({ request, output }).toEqual(before);
  });
});
