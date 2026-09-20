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

describe("relationship instance normalization", () => {
  it.each(["kill", "killed", "teach", "taught", "is a member of", "is member of", "serve"])("preserves the evidence-backed label %s", (input) => {
    expect(normalizeRelationshipFact("a", "b", input).canonicalType).toBe(input);
  });

  it("does not collapse phrases before evidence-aware model reconciliation", () => {
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "killed"))).not.toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "kills")));
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "is a member of"))).not.toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "member of")));
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "serve"))).not.toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "serves")));
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "member of"))).not.toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "second-in-command of")));
    expect(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "owns"))).not.toBe(relationshipSemanticKey(normalizeRelationshipFact("a", "b", "acquired")));
  });
});
