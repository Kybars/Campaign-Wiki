import { describe, expect, it } from "vitest";
import type { Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41DocumentV231 } from "../lib/ai/claims-4-1-reconciliation-v2-3-1";
import { resolveInventoryCollision, type InventorySources } from "../lib/ai/claims-inventory-ambiguity";
import { normalizeClaimsInventory, normalizeClaimsInventoryV231 } from "../lib/ai/claims-inventory-normalization";

const fixture = (text: string, types: string[]): Claims41Request => ({ requestId: "synthetic", baselineRequestId: "synthetic", inputDifferences: [],
  entities: types.map((type, i) => ({ canonicalId: `e${i}`, name: "Amber", type, aliases: [] })),
  evidenceUnits: [{ unitId: "u", segmentId: "s", page: 1, order: 0, kind: "sentence", text, context: "main",
    rawSource: { page: 1, start: 0, end: text.length, text } }] });
const run = (r: Claims41Request, sources?: InventorySources) => reconcileClaims41DocumentV231({ claims: [{
  statement: r.evidenceUnits[0].text, participants: ["Amber"], evidence_unit_ids: ["u"] }] }, r, undefined, sources);

describe("2.3.1 source-backed inventory collision resolution", () => {
  it.each([
    ["Amber is a construct.", ["item", "other"], "item"],
    ["Amber is a god.", ["deity", "other"], "deity"],
    ["The villagers worship Amber.", ["deity", "other"], "deity"],
    ["The characters enter Amber.", ["location", "quest"], "location"],
    ["The characters complete the Amber adventure.", ["location", "quest"], "quest"],
    ["Amber employs engineers.", ["faction", "location"], "faction"],
    ["The emperor commissioned Amber to produce soldiers.", ["faction", "location"], "faction"],
    ["The characters stand inside Amber.", ["faction", "location"], "location"],
    ["The disease is called Amber.", ["other", "quest"], "other"],
  ])("%s selects exactly one existing identity", (text, types, selected) => {
    const request = fixture(text as string, types as string[]);
    const result = run(request);
    expect(result.claims[0].participants[0]).toMatchObject({ kind: "canonical_entity", canonicalId: request.entities.find(e => e.type === selected)!.canonicalId });
    expect(result.candidateEntities).toEqual([]);
    expect(result.rawProposals.claims[0].statement).toBe(text);
    expect(result.claims[0].participants[0].supportingEvidence).toMatchObject([{ unitId: "u", direct: true }]);
  });
  it("selects unique direct provenance, never page overlap alone", () => {
    const request = fixture("Amber watches the gate.", ["npc", "npc"]);
    const sources: InventorySources = new Map([["e0", [{ page_number: 1, supporting_text: request.evidenceUnits[0].text }]],
      ["e1", [{ page_number: 1, supporting_text: "Amber lives across the sea." }]]]);
    expect(resolveInventoryCollision(request.entities, "Amber", request.evidenceUnits, sources)?.method).toBe("direct_provenance");
    expect(run(request, sources).claims[0].participants[0].canonicalId).toBe("e0");
    sources.set("e1", sources.get("e0")!);
    expect(run(request, sources).claims[0].participants[0].kind).toBe("unresolved");
  });
  it("leaves genuine indistinguishable homonyms unresolved with zero candidates", () => {
    const result = run(fixture("Amber watches the gate.", ["location", "quest"]));
    expect(result.claims[0].participants[0].kind).toBe("unresolved");
    expect(result.candidateEntities).toEqual([]);
  });
  it("includes alias and article collisions without exact-name precedence", () => {
    const request = fixture("Amber watches the gate.", ["npc", "npc"]);
    request.entities[1].name = "The River"; request.entities[1].aliases = ["The Amber"];
    expect(run(request).claims[0].participants[0].kind).toBe("unresolved");
  });
  it("does not merge type disagreements, even shared provenance", () => {
    const source = { page_number: 1, supporting_text: "Amber watches the gate." };
    const normalized = normalizeClaimsInventory({ entities: ["location", "quest"].map((type, i) => ({
      temporary_id: `e${i}`, name: "Amber", type: type as "location" | "quest", sources: [source] })) });
    expect(normalized.merges).toEqual([]);
    expect(normalized.inventory.entities).toHaveLength(2);
    expect(normalizeClaimsInventoryV231(normalized.inventory).inventory.entities).toHaveLength(2);
  });
  it.each([["item", "Amber is a construct."], ["deity", "The villagers worship Amber."]])("merges proven %s/fallback interpretations with provenance", (type, text) => {
    const source = { page_number: 1, supporting_text: text };
    const input = { entities: [type, "other"].map((t, i) => ({ temporary_id: `e${i}`, name: "Amber", type: t as "item" | "deity" | "other", sources: [source] })) };
    const result = normalizeClaimsInventoryV231(input);
    expect(result.inventory.entities).toHaveLength(1);
    expect(result.inventory.entities[0].memberIds).toEqual(["e0", "e1"]);
    expect(result.merges[0]).toMatchObject({ reason: "shared_source_explicit_specific_type_over_fallback", evidence: [source] });
    expect(normalizeClaimsInventory(input).inventory.entities).toHaveLength(2);
    input.entities[1].sources.push({ page_number: 2, supporting_text: "Another person is named Amber." });
    expect(normalizeClaimsInventoryV231(input).inventory.entities).toHaveLength(2);
  });
  it("never uses unsupported proposal grammar or a chapter title as type proof", () => {
    const request = fixture("Amber watches the gate.", ["location", "quest"]);
    request.evidenceUnits[0].context = "amber";
    const result = reconcileClaims41DocumentV231({ claims: [{ statement: "The characters complete the Amber adventure.", participants: ["Amber"], evidence_unit_ids: ["u"] }] }, request);
    expect(result.claims[0].participants[0].kind).toBe("unresolved");
  });
  it("leaves conflicting or same-type grammar unresolved", () => {
    expect(run(fixture("Amber is a tower. The characters complete the Amber adventure.", ["location", "quest"])).claims[0].participants[0].kind).toBe("unresolved");
    expect(run(fixture("Amber is a tower.", ["location", "location"])).claims[0].participants[0].kind).toBe("unresolved");
  });
  it("does not borrow grammar from a longer identity name", () => {
    expect(run(fixture("RedAmber is a god.", ["deity", "other"])).claims[0].participants[0].kind).toBe("unresolved");
  });
});
