import { describe, expect, it } from "vitest";
import type { Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41V21 } from "../lib/ai/claims-4-1-reconciliation-v2-1";

function fixture(texts: string[], names: string[], context = "ordinary_section"): Claims41Request {
  return { requestId: "source-one", baselineRequestId: "baseline", inputDifferences: [],
    entities: names.map((name) => ({ canonicalId: `e:${name}`, name, type: "npc", aliases: [] })),
    evidenceUnits: texts.map((text, order) => ({ unitId: `u${order}`, segmentId: "s1", page: 1, context,
      kind: "sentence", order, text, rawSource: { page: 1, start: order * 200, end: order * 200 + text.length, text } })) };
}
function reconcile(request: Claims41Request, statement: string, participants: string[], unit = 0) {
  return reconcileClaims41V21({ claims: [{ statement, participants, evidence_unit_ids: [`u${unit}`] }] }, request);
}

describe("Claims-4.1 Reconciliation v2.1", () => {
  it("excludes pure procedure while preserving the original proposal and narrative next to mechanics", () => {
    const request = fixture(["A character must make a DC 15 Wisdom saving throw.",
      "The citadel guards the valley; its defenders may make an attack roll.",
      "The citadel collapses when a character fails a DC 15 check."], ["Citadel"]);
    const procedure = reconcile(request, "A character must make a DC 15 Wisdom saving throw.", ["Heroes / Party"], 0);
    expect(procedure.rawProposals.claims[0].participants).toEqual(["Heroes / Party"]);
    expect(procedure.claims[0]).toMatchObject({ wikiDisposition: "mechanical_only", resolutionState: null, entityAssociations: [],
      timelineAssociation: null, reviewReasons: [] });
    expect(procedure.gmReview).toEqual([]);
    expect(procedure.diagnostics).toMatchObject({ resolved: 0, mechanicalOnly: 1 });
    const narrative = reconcile(request, "The citadel guards the valley; its defenders may make an attack roll.", ["Citadel"], 1);
    expect(narrative.claims[0]).toMatchObject({ wikiDisposition: "present", resolutionState: "resolved" });
    expect(reconcile(request, "The citadel collapses when a character fails a DC 15 check.", ["Citadel"], 2)
      .claims[0].wikiDisposition).toBe("present");
  });

  it("resolves source-scoped former names and keeps direct and contextual evidence separate", () => {
    const request = fixture(["Nyra, formerly Sereth, rules the coast.", "Sereth's reign ended in winter."], ["Nyra"]);
    const result = reconcile(request, "Sereth's reign ended in winter.", ["Sereth"], 1);
    const item = result.claims[0];
    expect(item.original).toEqual({ statement: "Sereth's reign ended in winter.", participants: ["Sereth"], evidence_unit_ids: ["u1"] });
    expect(item.participants[0]).toMatchObject({ kind: "canonical_entity", canonicalId: "e:Nyra", identitySourceUnitId: "u0" });
    expect(item.identityRelationships).toContainEqual(expect.objectContaining({ kind: "former_identity", alternateName: "Sereth", sourceUnitId: "u0" }));
    expect(item.directEvidence.map((entry) => entry.unitId)).toEqual(["u1"]);
    expect(item.contextEvidence.map((entry) => [entry.unitId, entry.direct, entry.purpose])).toEqual([["u0", false, "identity"]]);
    expect(item.resolutionState).toBe("resolved");
    const separate = fixture(["Sereth's reign ended in winter."], ["Nyra"]);
    expect(reconcile(separate, "Sereth's reign ended in winter.", ["Sereth"]).claims[0].participants[0].kind).toBe("unresolved");
  });

  it("uses an explicit rename for presentation metadata without changing inventory identity", () => {
    const request = fixture(["Veyra was renamed Ash Queen.", "Ash Queen rules the citadel."], ["Veyra"]);
    const result = reconcile(request, "Ash Queen rules the citadel.", ["Ash Queen"], 1);
    const item = result.claims[0];
    expect(item.participants[0]).toMatchObject({ canonicalId: "e:Veyra", canonicalName: "Veyra" });
    expect(item.identityRelationships).toContainEqual(expect.objectContaining({ kind: "renamed_identity", presentationName: "Ash Queen",
      canonicalId: "e:Veyra", sourceUnitId: "u0" }));
    expect(result.canonicalPresentations).toContainEqual(expect.objectContaining({ canonicalId: "e:Veyra",
      canonicalName: "Veyra", presentationName: "Ash Queen", alternateNames: ["Ash Queen"] }));
    expect(request.entities[0].name).toBe("Veyra");
    const reverse = fixture(["Veyra was renamed Ash Queen.", "Veyra built the citadel."], ["Ash Queen"]);
    const reversed = reconcile(reverse, "Veyra built the citadel.", ["Veyra"], 1);
    expect(reversed.claims[0].participants[0]).toMatchObject({ kind: "canonical_entity", canonicalId: "e:Ash Queen" });
    expect(reversed.canonicalPresentations[0]).toMatchObject({ canonicalName: "Ash Queen", presentationName: "Ash Queen" });
  });

  it("recognizes explicit aliases and keeps conflicting presentation candidates at the inventory name", () => {
    const request = fixture(["Veyra, also known as Ash Queen, arrived.", "Veyra was renamed Ember Queen.",
      "Veyra was renamed Fire Queen.", "Ash Queen left."], ["Veyra"]);
    const result = reconcile(request, "Ash Queen left.", ["Ash Queen"], 3);
    expect(result.claims[0].participants[0]).toMatchObject({ kind: "canonical_entity", canonicalId: "e:Veyra" });
    expect(result.canonicalPresentations[0]).toMatchObject({ canonicalName: "Veyra", presentationName: "Veyra" });
    expect(result.canonicalPresentations[0].alternateNames).toEqual(expect.arrayContaining(["Ash Queen", "Ember Queen", "Fire Queen"]));
  });

  it("grounds a definite local reference and a subordinate descriptor without creating pages", () => {
    const request = fixture(["Veyra, a dragon, settled near the citadel.", "The dragon guards the northern chamber of Citadel."],
      ["Veyra", "Citadel"]);
    const item = reconcile(request, "The dragon guards the northern chamber of Citadel.", ["the dragon", "northern chamber of Citadel"], 1).claims[0];
    expect(item.participants).toEqual([
      expect.objectContaining({ mention: "the dragon", kind: "canonical_entity", canonicalId: "e:Veyra" }),
      expect.objectContaining({ mention: "northern chamber of Citadel", kind: "descriptor", canonicalId: "e:Citadel" }),
    ]);
    expect(item.entityAssociations.map((entry) => entry.canonicalId)).toEqual(["e:Veyra", "e:Citadel"]);
    expect(item.identityRelationships).toContainEqual(expect.objectContaining({ kind: "local_reference", alternateName: "the dragon", sourceUnitId: "u0" }));
  });

  it("classifies ordinary participants without suppressing a distinct unknown name", () => {
    const request = fixture(["Several guards carry ordinary swords into the citadel.", "Velorien visits the citadel."], ["Citadel"]);
    const ordinary = reconcile(request, "Several guards carry ordinary swords into the citadel.", ["several guards", "ordinary swords", "Citadel"]);
    expect(ordinary.claims[0].participants.map((entry) => entry.kind)).toEqual(["generic_non_entity", "generic_non_entity", "canonical_entity"]);
    expect(ordinary.claims[0].resolutionState).toBe("resolved");
    const named = reconcile(request, "Velorien visits the citadel.", ["Velorien", "Citadel"], 1);
    expect(named.claims[0].participants[0].kind).toBe("unresolved");
    expect(named.gmReview).toHaveLength(1);
  });

  it("flags a nearby literal contradiction without rewriting the claim or its evidence", () => {
    const request = fixture(["Arlen is alive.", "Arlen is not alive."], ["Arlen"]);
    const item = reconcile(request, "Arlen is alive.", ["Arlen"]).claims[0];
    expect(item.original.statement).toBe("Arlen is alive.");
    expect(item.original.evidence_unit_ids).toEqual(["u0"]);
    expect(item.directEvidence.map((entry) => entry.unitId)).toEqual(["u0"]);
    expect(item.reviewReasons).toContain("possible_source_error");
    expect(item.resolutionState).toBe("needs_review");
  });

  it("retains v2 timeline placement for narrative claims", () => {
    const request = fixture(["November * — The war begins.", "The heroes enter the citadel."], ["Citadel"],
      "full_campaign_timeline_assuming_heroes_succeed");
    const item = reconcile(request, "The heroes enter the citadel.", ["Heroes / Party", "Citadel"], 1).claims[0];
    expect(item.timelineAssociation).toMatchObject({ timeLabel: "November", branch: "main_assuming_heroes_succeed" });
    expect(item.participants[0]).toMatchObject({ kind: "canonical_entity", canonicalId: "system:heroes-party" });
  });
});
