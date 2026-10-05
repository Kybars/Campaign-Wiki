import { describe, expect, it } from "vitest";
import type { Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41DocumentV230 } from "../lib/ai/claims-4-1-reconciliation-v2-3-0";
import { annotateSourceStructure } from "../lib/ai/claims-source-structure";
import { normalizeClaimsInventory } from "../lib/ai/claims-inventory-normalization";

const fixture = (texts: string[], names: string[] = []): Claims41Request => ({ requestId: "synthetic", baselineRequestId: "synthetic", inputDifferences: [],
  entities: names.map((name, i) => ({ canonicalId: `e${i}`, name, type: "npc", aliases: [] })),
  evidenceUnits: texts.map((text, order) => ({ unitId: `u${order}`, segmentId: `s${order}`, page: order + 1, kind: "sentence", text,
    order, context: "main", rawSource: { page: order + 1, start: 0, end: text.length, text } })) });
const run = (request: Claims41Request, names: string[]) => reconcileClaims41DocumentV230({ claims: request.evidenceUnits.map(u => ({ statement: u.text, participants: names, evidence_unit_ids: [u.unitId] })) }, request);

describe("v2.3.0 conservative source identity", () => {
  it("keeps existing homonyms ambiguous, with no extra candidate", () => {
    const r = run(fixture(["Arlen watches the gate."], ["Arlen", "Arlen"]), ["Arlen"]);
    expect(r.candidateEntities).toEqual([]);
    expect(r.claims[0].participants[0].kind).toBe("unresolved");
    expect(r.gmReview).toHaveLength(1);
  });
  it("reuses repeated stable candidates", () => {
    const r = run(fixture(["Iron Titan watches the gate.", "Iron Titan leaves the gate."]), ["Iron Titan"]);
    expect(r.candidateEntities).toHaveLength(1);
    expect(r.claims[0].participants[0].canonicalId).toBe(r.claims[1].participants[0].canonicalId);
  });
  it.each(["Creature", "Cultists", "Children", "Farm", "Portal", "Fog", "Island", "Guards", "Small demon"])("does not promote %s from capitalization", name => {
    const r = run(fixture([`${name} blocks the road.`]), [name]);
    expect(r.candidateEntities).toEqual([]);
    expect(r.claims[0].participants[0].kind).toBe("generic_non_entity");
    expect(r.claims[0].reviewReasons).not.toContain("unresolved_participant");
  });
  it("retains an explicitly named subject", () => {
    const r = run(fixture(["A person named Ember."]), ["Ember"]);
    expect(r.candidateEntities.map(e => e.name)).toEqual(["Ember"]);
  });
  it("requires evidence beyond a single sentence-initial capitalized noun", () => {
    const r = run(fixture(["Gate blocks the road."]), ["Gate"]);
    expect(r.candidateEntities).toEqual([]);
  });
  it("does not resolve an alias collision by name precedence", () => {
    const request = fixture(["Arlen watches the gate."], ["Arlen", "Mira"]);
    request.entities[1].aliases = ["Arlen"];
    const r = run(request, ["Arlen"]);
    expect(r.candidateEntities).toEqual([]);
    expect(r.claims[0].participants[0].kind).toBe("unresolved");
  });
  it("retains source substitution detection in long evidence units", () => {
    const statement = "At the old stone bridge Arlen guards the sacred silver gate.";
    const request = fixture(["Ordinary surrounding narrative. ".repeat(100) + statement.replace("Arlen", "Mira")], ["Arlen", "Mira"]);
    const r = reconcileClaims41DocumentV230({ claims: [{ statement, participants: ["Arlen"], evidence_unit_ids: ["u0"] }] }, request);
    expect(r.claims[0].reviewReasons).toContain("source_discrepancy");
    request.evidenceUnits[0].text += ` ${statement}`;
    request.evidenceUnits[0].rawSource.text = request.evidenceUnits[0].text;
    request.evidenceUnits[0].rawSource.end = request.evidenceUnits[0].text.length;
    const supported = reconcileClaims41DocumentV230({ claims: [{ statement, participants: ["Arlen"], evidence_unit_ids: ["u0"] }] }, request);
    expect(supported.claims[0].reviewReasons).not.toContain("source_discrepancy");
  });
  it("preserves source spans, ignores running furniture and bounds statblocks", () => {
    const request = fixture(["Book Title\nRumors\nArlen visits.", "Book Title\nMAGIC\nFire burns.", "Book Title\nEvents near Town\nDay 1\nArlen arrives."]);
    const annotated = annotateSourceStructure(request.evidenceUnits);
    expect(annotated.units.map(u => u.rawSource)).toEqual(request.evidenceUnits.map(u => u.rawSource));
    expect(annotated.units[0].context).toBe("rumors");
    expect(annotated.units[2].context).toBe("events_near_town > day_1");
    const r = run({ ...request, evidenceUnits: annotated.units }, ["Arlen"]);
    expect(r.claims[0].sourceStatus).toBe("rumor");
    expect(r.claims[2].timelineAssociation).toMatchObject({ timeLabel: "Day 1", propositionStatus: "published_scheduled" });
  });
  it("keeps random sections conditional", () => {
    const request = fixture(["Arlen arrives."]);
    request.evidenceUnits[0].context = "random_events > day_1";
    const r = run(request, ["Arlen"]);
    expect(r.claims[0].sourceStatus).toBe("conditional");
    expect(r.claims[0].timelineAssociation).toBeNull();
  });
  it("rejects wrapped capitalized fragments and retains labeled rumor subheadings", () => {
    const request = fixture(["Rumors\nPeople\ndescribe the stranger.", "Different rumors concern various regions.",
      "Highlands\nA stranger appeared.", "River Valley\nA castle vanished.", "More Events\nArlen arrives."]);
    request.evidenceUnits.forEach(u => { u.page = 1; u.rawSource.page = 1; });
    const s = annotateSourceStructure(request.evidenceUnits);
    expect(s.hierarchy.some(h => h.text === "People")).toBe(false);
    expect(s.units[2].context).toBe("rumors > highlands");
    expect(s.units[3].context).toBe("rumors > river_valley");
    expect(s.units[4].context).toBe("more_events");
  });
  it("retains plan and GM-instruction precedence in relative schedules", () => {
    const request = fixture(["Arlen plans to leave the city.", "The GM should send Arlen to the city."], ["Arlen"]);
    request.evidenceUnits.forEach(u => { u.context = "events_near_town > day_2"; });
    const r = run(request, ["Arlen"]);
    expect(r.claims[0].sourceStatus).toBe("plan");
    expect(r.claims[0].timelineAssociation).toMatchObject({ timeLabel: "Day 2", propositionStatus: "plan" });
    expect(r.claims[1].sourceStatus).toBe("gm_instruction");
    expect(r.claims[1].timelineAssociation).toBeNull();
  });
  it("recognizes random tables with lowercase column labels and suppresses numbered rows", () => {
    const request = fixture(["Random Events\nd6 Result\n1 Ada\n2 Mira\n3 Ember\nEach event occurs randomly."]);
    const s = annotateSourceStructure(request.evidenceUnits);
    expect(s.units[0].context).toBe("random_events");
    expect(s.hierarchy.map(h => h.text)).toEqual(["Random Events"]);
  });
  it("merges articles and uniquely supported surnames, preserves different types", () => {
    const source = { page_number: 1, supporting_text: "A person named Ada Rivers. Rivers returns." };
    const entities = [ ["Ada Rivers", "npc"], ["Rivers", "npc"], ["The Guild", "faction"], ["Guild", "faction"], ["Guild", "location"] ] as const;
    const r = normalizeClaimsInventory({ entities: entities.map(([name, type], i) => ({ temporary_id: `e${i}`, name, type, sources: [source] })) });
    expect(r.inventory.entities).toHaveLength(3);
    expect(r.merges).toHaveLength(2);
    expect(r.inventory.entities.find(e => e.type === "location")).toBeDefined();
  });
});
