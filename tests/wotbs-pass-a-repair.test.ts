import { describe, expect, it } from "vitest";
import { extractionInventoryOutputSchema } from "@/lib/ai/schemas";
import { deterministicInventoryId, groundInventoryIdentity, validateExtractionInventory, validatedInventoryFingerprint } from "@/lib/ai/source-validation";
import { wotbsIdentityOnlySchema, wotbsIdentityPageSchema } from "../scripts/wotbs-pass-a-repair";

const pages = [
  { pageNumber: 10, text: "Mira Vale guards the Moon Gate. The rebels later assassinated Mira Vale during the Ashfall uprising." },
  { pageNumber: 11, text: "Recover the Ember Key is the first adventure." },
];
const chunk = { id: "grounding", pages, characterCount: pages.reduce((sum, page) => sum + page.text.length, 0) };

describe("WotBS Pass-A identity/page grounding repair", () => {
  it("enforces strict identity-only and identity-page diagnostic schemas", () => {
    expect(wotbsIdentityOnlySchema.parse({ entities: [{ name: "Mira Vale", type: "npc" }] }).entities).toHaveLength(1);
    expect(() => wotbsIdentityOnlySchema.parse({ entities: [{ name: "Mira Vale", type: "npc", page: 10 }] })).toThrow();
    expect(wotbsIdentityPageSchema.parse({ entities: [{ name: "Mira Vale", type: "npc", page: 10 }] }).entities).toHaveLength(1);
    expect(() => wotbsIdentityPageSchema.parse({ entities: [{ name: "Mira Vale", type: "npc", page: 13 }] })).toThrow();
  });

  it("makes production inventory model output strictly name, type, and page", () => {
    expect(extractionInventoryOutputSchema.parse({ entities: [{ name: "Mira Vale", type: "npc", page: 10 }] }).entities[0]).toEqual({ name: "Mira Vale", type: "npc", page: 10 });
    expect(() => extractionInventoryOutputSchema.parse({ entities: [{ name: "Mira Vale", type: "npc", page: 10, excerpt: "model prose" }] })).toThrow();
  });

  it("extracts bounded deterministic evidence from an exact normalized mention", () => {
    const first = groundInventoryIdentity({ name: "Mira Vale", type: "npc", page: 10 }, pages);
    const second = groundInventoryIdentity({ name: "Mira Vale", type: "npc", page: 10 }, pages);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ strategy: "exact_normalized_name", source: { page_number: 10 } });
    expect(first.source?.supporting_text.length).toBeLessThanOrEqual(240);
  });

  it("allows clear inferred Event page grounding but fails unsupported identities closed", () => {
    expect(groundInventoryIdentity({ name: "Assassination of Mira Vale", type: "event", page: 10 }, pages)).toMatchObject({ strategy: "inferred_event_or_quest_tokens", source: { page_number: 10 } });
    expect(groundInventoryIdentity({ name: "Unknown Betrayal", type: "event", page: 10 }, pages)).toMatchObject({ source: null });
    expect(groundInventoryIdentity({ name: "Mira Vale", type: "npc", page: 12 }, pages)).toMatchObject({ source: null, reason: "page 12 is not in this chunk" });
  });

  it("excludes grounding failures from the authoritative inventory with diagnostics", () => {
    const result = validateExtractionInventory({ entities: [{ name: "Mira Vale", type: "npc", page: 10 }, { name: "Invented Stranger", type: "npc", page: 10 }] }, chunk);
    expect(result.inventory.entities.map((entity) => entity.name)).toEqual(["Mira Vale"]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ identifier: "npc:Invented Stranger", reason: "no valid source evidence" })]));
  });

  it("keeps IDs stable across reorder, serialization, and evidence presentation while separating type collisions", () => {
    const raw = { entities: [{ name: "Mira Vale", type: "npc" as const, page: 10 }, { name: "Recover the Ember Key", type: "quest" as const, page: 11 }] };
    const forward = validateExtractionInventory(raw, chunk).inventory;
    const reversed = validateExtractionInventory({ entities: [...raw.entities].reverse() }, chunk).inventory;
    expect(reversed).toEqual(forward);
    expect(JSON.parse(JSON.stringify(forward))).toEqual(forward);
    const sourceFingerprint = "a".repeat(64);
    const idBeforeExcerptFormatting = deterministicInventoryId(sourceFingerprint, "npc", "Mira Vale", 10);
    const idAfterExcerptFormatting = deterministicInventoryId(sourceFingerprint, "npc", "Mira Vale", 10);
    expect(idAfterExcerptFormatting).toBe(idBeforeExcerptFormatting);
    expect(deterministicInventoryId(sourceFingerprint, "npc", "Echo", 10)).not.toBe(deterministicInventoryId(sourceFingerprint, "quest", "Echo", 10));
    expect(new Set(forward.entities.map((entity) => entity.temporary_id)).size).toBe(forward.entities.length);
    expect(validatedInventoryFingerprint(forward)).toBe(validatedInventoryFingerprint(reversed));
    const evidenceFormattingChanged = { entities: forward.entities.map((entity) => ({ ...entity, sources: [{ ...entity.sources[0], supporting_text: `${entity.sources[0].supporting_text} ` }] as [typeof entity.sources[0]] })) };
    expect(evidenceFormattingChanged.entities.map((entity) => entity.temporary_id)).toEqual(forward.entities.map((entity) => entity.temporary_id));
    expect(validatedInventoryFingerprint(evidenceFormattingChanged)).not.toBe(validatedInventoryFingerprint(forward));
  });
});
