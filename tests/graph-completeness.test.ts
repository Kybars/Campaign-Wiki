import { describe, expect, it } from "vitest";
import type { ValidatedExtractionInventoryOutput } from "@/lib/ai/schemas";
import { validateGraphExtraction } from "@/lib/ai/graph-extraction";
import { buildGraphCompletenessInput, buildGraphCompletenessUnion, serializeExistingGraphRelationships, validateGraphCompletenessSweep } from "@/lib/ai/graph-completeness";
import { validatedInventoryFingerprint } from "@/lib/ai/source-validation";

const inventory: ValidatedExtractionInventoryOutput = {
  entities: [
    { temporary_id: "vault", name: "Vault", type: "location", sources: [{ page_number: 1, supporting_text: "The Vault contains the Relic." }] },
    { temporary_id: "relic", name: "Relic", type: "item", sources: [{ page_number: 1, supporting_text: "The Vault contains the Relic." }] },
    { temporary_id: "captain", name: "Captain", type: "npc", sources: [{ page_number: 1, supporting_text: "The Captain commands the Guard." }] },
    { temporary_id: "guard", name: "Guard", type: "faction", sources: [{ page_number: 1, supporting_text: "The Captain commands the Guard." }] },
  ],
};
const chunk = { id: "synthetic", characterCount: 62, pages: [{ pageNumber: 1, text: "The Vault contains the Relic. The Captain commands the Guard." }] };
const firstPass = validateGraphExtraction({ relationships: [{ source: "Relic", relationship: "located in", target: "Vault", page: 1 }] }, inventory, chunk);

describe("graph completeness isolation", () => {
  it("serializes existing canonical relationships in human-readable form without IDs", () => {
    const serialized = serializeExistingGraphRelationships(firstPass.relationships);
    expect(serialized).toBe("Relic | located in | Vault | p. 1");
    expect(serialized).not.toContain("relic");
  });

  it("includes the first pass but no evaluator gold in the compact model input", () => {
    const fingerprint = validatedInventoryFingerprint(inventory);
    const input = buildGraphCompletenessInput(chunk, inventory, firstPass.relationships);
    expect(input).toContain("RELATIONSHIPS ALREADY FOUND\nRelic | located in | Vault | p. 1");
    expect(input).not.toMatch(/GOLD_REFERENCE|accepted_types|core_relationships/);
    expect(validatedInventoryFingerprint(inventory)).toBe(fingerprint);
  });

  it("classifies an inverse of the first pass as a duplicate and keeps a new edge novel", () => {
    const sweep = validateGraphCompletenessSweep({ relationships: [
      { source: "Vault", relationship: "contains", target: "Relic", page: 1 },
      { source: "Captain", relationship: "commands", target: "Guard", page: 1 },
    ] }, inventory, chunk, new Set(firstPass.relationships.map((relationship) => relationship.semanticKey)));
    expect(sweep.classifications.map((item) => item.classification)).toEqual(["DUPLICATE_OF_FIRST_PASS", "NOVEL_ACCEPTED"]);
    expect(sweep.novelRelationships).toHaveLength(1);
  });

  it("dedupes within the sweep and rejects entity creation attempts", () => {
    const sweep = validateGraphCompletenessSweep({ relationships: [
      { source: "Captain", relationship: "commands", target: "Guard", page: 1 },
      { source: "Captain", relationship: "commands", target: "Guard", page: 1 },
      { source: "Unknown", relationship: "commands", target: "Guard", page: 1 },
    ] }, inventory, chunk, new Set());
    expect(sweep.classifications.map((item) => item.classification)).toEqual(["NOVEL_ACCEPTED", "DUPLICATE_WITHIN_SWEEP", "REJECTED_UNKNOWN_ENDPOINT"]);
    expect(sweep.validation.relationships).toHaveLength(1);
  });

  it("preserves every first-pass edge while unioning only novel semantic keys", () => {
    const sweep = validateGraphCompletenessSweep({ relationships: [{ source: "Captain", relationship: "commands", target: "Guard", page: 1 }] }, inventory, chunk, new Set(firstPass.relationships.map((relationship) => relationship.semanticKey)));
    const union = buildGraphCompletenessUnion(firstPass.relationships, sweep.novelRelationships);
    expect(union).toHaveLength(2);
    expect(union.map((relationship) => relationship.semanticKey)).toContain(firstPass.relationships[0].semanticKey);
  });
});
