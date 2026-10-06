import { describe, expect, it } from "vitest";
import type { Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41DocumentV232 } from "../lib/ai/claims-4-1-reconciliation-v2-3-2";
import { sourceFormReference } from "../lib/ai/claims-source-form";

function fixture(texts: string[], types: string[] = [], name = "Amber Tower", contexts = texts.map(() => "amber_tower")): Claims41Request {
  return { requestId: "synthetic", baselineRequestId: "synthetic", inputDifferences: [], entities: types.map((type, i) => ({ canonicalId: `e${i}`, name, type, aliases: [] })),
    evidenceUnits: texts.map((text, order) => ({ unitId: `u${order}`, segmentId: "s", page: 1, kind: "sentence", order, text, context: contexts[order], rawSource: { page: 1, start: 0, end: text.length, text } })) };
}
function run(r: Claims41Request, mention: string, index = r.evidenceUnits.length - 1) {
  return reconcileClaims41DocumentV232({ claims: [{ statement: r.evidenceUnits[index].text, participants: [mention], evidence_unit_ids: [r.evidenceUnits[index].unitId] }] }, r);
}
describe("2.3.2 actual source form", () => {
  it.each([["Creature", "A creature crosses the road."], ["Orcs", "Many orcs cross the road."],
    ["Miners", "Three miners watch the gate."], ["Cursed creature", "While cursed, a creature cannot leave."],
    ["Animated corpse", "An animated corpse blocks the gate."]])("classifies %s without campaign nouns", (mention, text) => {
    const result = run(fixture([text]), mention);
    expect(result.claims[0].participants[0].kind).toBe("generic_non_entity"); expect(result.candidateEntities).toEqual([]);
  });
  it("uses lowercase quantified occurrences for a sentence-initial common class", () => {
    const r = fixture(["Many workers wait outside.", "Workers carry stone while other workers watch."]);
    expect(run(r, "Workers").claims[0].participants[0].kind).toBe("generic_non_entity");
  });
  it("keeps explicit named designations identity-capable", () => {
    expect(run(fixture(["A creature named Ember watches the gate."]), "Ember").candidateEntities.map(e => e.name)).toContain("Ember");
  });
  it("never demotes a known inventory identity", () => {
    expect(run(fixture(["Many workers wait."], ["faction"], "Workers"), "Workers").claims[0].participants[0].kind).toBe("canonical_entity");
  });
  it.each([{ types: ["location"] }, { types: ["location", "quest"] }])("resolves a physical section with $types inventory types", ({ types }) => {
    const r = fixture(["Amber Tower is a stone tower.", "The tower has three entrances."], types);
    const result = run(r, "Amber Tower");
    expect(result.claims[0].participants[0].canonicalId).toBe("e0"); expect(result.candidateEntities).toEqual([]);
    if (types.length > 1) expect(result.claims[0].contextEvidence.map(e => e.unitId)).toContain("u0");
  });
  it("rejects heading alone and unrelated generic participants", () => {
    const r = fixture(["Amber Tower", "The tower has three entrances."], ["location", "quest"]);
    r.evidenceUnits[0].kind = "heading";
    expect(run(r, "Amber Tower").claims[0].participants[0].kind).toBe("unresolved");
    expect(sourceFormReference("City Council", [r.evidenceUnits[1]], r.evidenceUnits, r.entities)).toBeNull();
  });
  it("stops at a competing source subject", () => {
    const r = fixture(["Amber Tower is a stone tower.", "Beryl Tower is a stone tower.", "The tower has three entrances."], ["location", "quest"]);
    r.entities.push({ canonicalId: "b", name: "Beryl Tower", type: "location", aliases: [] });
    expect(run(r, "Amber Tower").claims[0].participants[0].kind).toBe("unresolved");
  });
  it("stops at a sibling section, including repeated context strings", () => {
    const r = fixture(["Amber Tower is a stone tower.", "Other Hall has a door.", "The tower has three entrances."], ["location", "quest"], "Amber Tower", ["amber_tower", "other_hall", "amber_tower"]);
    expect(run(r, "Amber Tower").claims[0].participants[0].kind).toBe("unresolved");
  });
  it("preserves an anchored section over a page break", () => {
    const r = fixture(["Amber Tower is a stone tower.", "The tower has three entrances."], ["location", "quest"]);
    r.evidenceUnits[1].page = 2; r.evidenceUnits[1].rawSource.page = 2;
    expect(run(r, "Amber Tower").claims[0].participants[0].canonicalId).toBe("e0");
  });
  it.each(["The disease spreads by touch.", "The fever causes delirium."])("anchors disease references: %s", text => {
    const r = fixture(["The disease is known as Amber Fever.", text], ["other", "quest"], "Amber Fever", ["amber_fever", "amber_fever"]);
    expect(run(r, "Amber Fever").claims[0].participants[0].canonicalId).toBe("e0");
  });
  it.each([["Amber Academy employs engineers.", "The academy recruits members.", "faction"],
    ["Amber Academy is a sprawling complex.", "The complex has three walls.", "location"]])("resolves the anchored %s interpretation", (anchor, text, type) => {
    const r = fixture([anchor, text], ["faction", "location"], "Amber Academy", ["amber_academy", "amber_academy"]);
    expect(run(r, "Amber Academy").claims[0].participants[0].canonicalId).toBe(r.entities.find(e => e.type === type)!.canonicalId);
  });
  it("keeps conflicting anchors unresolved without candidates", () => {
    const r = fixture(["Amber Academy is a sprawling complex.", "Amber Academy employs engineers.", "The academy has an old name."], ["faction", "location"], "Amber Academy", ["amber_academy", "amber_academy", "amber_academy"]);
    const result = run(r, "Amber Academy"); expect(result.claims[0].participants[0].kind).toBe("unresolved"); expect(result.candidateEntities).toEqual([]);
  });
  it("does not erase unresolved stable qualified designations", () => {
    for (const [mention, text] of [["City council", "A council advises the mayor."], ["Ghastly chorus", "A ghastly chorus lurks here."]])
      expect(run(fixture([text]), mention).claims[0].participants[0].kind).toBe("unresolved");
  });
  it("never borrows a different location's type for a common reference", () => {
    const r = fixture(["A traveller enters Amber Tower.", "The stronghold stands on a hill."], ["location"]);
    expect(sourceFormReference("stronghold", [r.evidenceUnits[1]], r.evidenceUnits, r.entities)).toBeNull();
  });
  it("resolves a local source pronoun without gender inference", () => {
    const r = fixture(["Amber Tower is a stone tower.", "It has three entrances."], ["location", "quest"]);
    expect(run(r, "Amber Tower").claims[0].participants[0].canonicalId).toBe("e0");
  });
  it("rejects a pronoun after an unknown explicit subject", () => {
    const r = fixture(["Amber Tower is a stone tower.", "Beryl watches the gate.", "It has three entrances."], ["location", "quest"]);
    expect(run(r, "Amber Tower").claims[0].participants[0].kind).toBe("unresolved");
  });
  it("preserves source-backed owner descriptors", () => {
    const r = fixture(["Amber's guards watch the gate."], ["faction"], "Amber");
    expect(run(r, "Amber's guards").claims[0].participants[0].kind).toBe("descriptor");
  });
});
