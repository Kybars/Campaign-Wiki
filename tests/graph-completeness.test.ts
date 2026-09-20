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
const firstPass = validateGraphExtraction({ relationships: [{ source: "Relic", relationship: "located in", target: "Vault", page: 1, evidence_quote: "The Vault contains the Relic." }] }, inventory, chunk);

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

  it("exposes approved aliases compactly with the cleaned inventory", () => {
    const input = buildGraphCompletenessInput(chunk, { entities: inventory.entities.map((entity) => entity.temporary_id === "captain" ? { ...entity, aliases: ["The Commander"] } : entity) }, firstPass.relationships);
    expect(input).toContain("Captain | npc | aliases: The Commander");
  });

  it("does not use a phrase table to classify opposite wording as duplicate", () => {
    const sweep = validateGraphCompletenessSweep({ relationships: [
      { source: "Vault", relationship: "contains", target: "Relic", page: 1, evidence_quote: "The Vault contains the Relic." },
      { source: "Captain", relationship: "commands", target: "Guard", page: 1, evidence_quote: "The Captain commands the Guard." },
    ] }, inventory, chunk, new Set(firstPass.relationships.map((relationship) => relationship.semanticKey)));
    expect(sweep.classifications.map((item) => item.classification)).toEqual(["NOVEL_ACCEPTED", "NOVEL_ACCEPTED"]);
    expect(sweep.novelRelationships).toHaveLength(2);
  });

  it("retains quote-backed duplicates for final provenance union and rejects entity creation attempts", () => {
    const sweep = validateGraphCompletenessSweep({ relationships: [
      { source: "Captain", relationship: "commands", target: "Guard", page: 1, evidence_quote: "The Captain commands the Guard." },
      { source: "Captain", relationship: "commands", target: "Guard", page: 1, evidence_quote: "Captain commands the Guard" },
      { source: "Unknown", relationship: "commands", target: "Guard", page: 1, evidence_quote: "The Captain commands the Guard." },
    ] }, inventory, chunk, new Set());
    expect(sweep.classifications.map((item) => item.classification)).toEqual(["NOVEL_ACCEPTED", "NOVEL_ACCEPTED", "REJECTED_UNKNOWN_ENDPOINT"]);
    expect(sweep.validation.relationships).toHaveLength(2);
  });

  it("rejects a completeness proposal whose quote is absent from the raw page", () => {
    const sweep = validateGraphCompletenessSweep({ relationships: [
      { source: "Captain", relationship: "commands", target: "Guard", page: 1, evidence_quote: "The Captain leads every soldier." },
    ] }, inventory, chunk, new Set());
    expect(sweep.classifications[0].classification).toBe("REJECTED_EVIDENCE_NOT_FOUND");
    expect(sweep.validation.validationRecords[0].outcome).toBe("REJECTED_EVIDENCE_NOT_FOUND");
    expect(sweep.novelRelationships).toEqual([]);
  });

  it("preserves every first-pass edge and every valid completeness proposal for provenance union", () => {
    const sweep = validateGraphCompletenessSweep({ relationships: [{ source: "Captain", relationship: "commands", target: "Guard", page: 1, evidence_quote: "The Captain commands the Guard." }] }, inventory, chunk, new Set(firstPass.relationships.map((relationship) => relationship.semanticKey)));
    const union = buildGraphCompletenessUnion(firstPass.relationships, sweep.novelRelationships);
    expect(union).toHaveLength(2);
    expect(union.map((relationship) => relationship.semanticKey)).toContain(firstPass.relationships[0].semanticKey);
  });
});
