import { describe, expect, it } from "vitest";
import { normalizeCanonicalDisplayName, normalizeName } from "@/lib/graph/normalize";
import { normalizeRelationshipFact, relationshipSemanticKey } from "@/lib/relationships/normalize";

describe("normalizeName", () => {
  it.each([
    [" Ralekai ", "ralekai"],
    ["RALEKAI", "ralekai"],
    ["Tomar’s   Crossing", "tomar s crossing"],
    ["Cult-of-Ash", "cult of ash"],
  ])("normalizes %s", (input, expected) => expect(normalizeName(input)).toBe(expected));
});

describe("canonical display capitalization", () => {
  it.each([["trillith", "Trillith"], ["The Beating of the Aquiline Heart", "The Beating of the Aquiline Heart"], ["d'Artagnan", "D'Artagnan"], ["NPC-01", "NPC-01"]])("normalizes %s conservatively", (input, expected) => {
    expect(normalizeCanonicalDisplayName(input)).toBe(expected);
  });
});

describe("relationship grammar normalization", () => {
  it.each([["kill", "kills"], ["killed", "kills"], ["teach", "teaches"], ["taught", "teaches"], ["is a member of", "member of"], ["is member of", "member of"], ["serve", "serves"]])("normalizes %s to %s", (input, expected) => {
    expect(normalizeRelationshipFact("a", "b", input).canonicalType).toBe(expected);
  });

  it("collapses grammatical variants without collapsing distinct semantics", () => {
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "killed"))).toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "kills")));
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "is a member of"))).toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "member of")));
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "serve"))).toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "serves")));
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "member of"))).not.toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "second-in-command of")));
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "owns"))).not.toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "acquired")));
  });
});
