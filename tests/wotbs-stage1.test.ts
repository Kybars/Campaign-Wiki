import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildInventoryInput, buildRichExtractionInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT, EXTRACTION_RICH_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { ExtractionRichOutput, ValidatedExtractionInventoryOutput } from "@/lib/ai/schemas";
import { assembleChunkExtraction, validateExtractionRich } from "@/lib/ai/source-validation";
import {
  assertGoldReferenceIsolation, candidateAssemblySafety, loadWotbsGoldReference, loadWotbsStage1Fixture,
  scoreWotbsInventory, WOTBS_STAGE1_EXPECTED_NORMALIZED_TEXT_SHA256, WOTBS_STAGE1_EXPECTED_PDF_SHA256,
} from "../scripts/wotbs-stage1";

const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const pdfPath = new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot);
const localFixtureAvailable = existsSync(pdfPath);

describe("WotBS Stage 1 deterministic fixture", () => {
  (localFixtureAvailable ? it : it.skip)("freezes the canonical PDF and normalized extracted text hashes", async () => {
    const fixture = await loadWotbsStage1Fixture(fileURLToPath(pdfPath));
    expect(fixture.pdfSha256).toBe(WOTBS_STAGE1_EXPECTED_PDF_SHA256);
    expect(fixture.normalizedTextSha256).toBe(WOTBS_STAGE1_EXPECTED_NORMALIZED_TEXT_SHA256);
    expect(fixture.sourceCharacterCount).toBe(11_083);
    expect(fixture.chunks).toHaveLength(1);
  });

  (localFixtureAvailable ? it : it.skip)("preserves original PDF provenance pages 10 through 12", async () => {
    const fixture = await loadWotbsStage1Fixture(fileURLToPath(pdfPath));
    expect(fixture.pages.map((page) => page.pageNumber)).toEqual([10, 11, 12]);
    expect(fixture.chunks[0].pages.map((page) => page.pageNumber)).toEqual([10, 11, 12]);
  });

  it("keeps evaluator-only gold content out of both model inputs", () => {
    const syntheticChunk = { id: "synthetic", pages: [{ pageNumber: 1, text: "Mira Vale guards the Moon Gate." }], characterCount: 31 };
    const inventory: ValidatedExtractionInventoryOutput = { entities: [] };
    const artifacts = [{ path: "private-gold.json", raw: "synthetic evaluator-only marker" }];
    expect(() => assertGoldReferenceIsolation([EXTRACTION_INVENTORY_SYSTEM_PROMPT, buildInventoryInput(syntheticChunk), EXTRACTION_RICH_SYSTEM_PROMPT, buildRichExtractionInput(syntheticChunk, inventory)], artifacts)).not.toThrow();
    expect(() => assertGoldReferenceIsolation(["synthetic evaluator-only marker"], artifacts)).toThrow(/Gold reference leaked/);
  });

  it("matches gold aliases and accepted alternate types without weakening type checks", () => {
    const reference = {
      fixture: "synthetic",
      source: { document: "synthetic", pdf_pages: [1], purpose: "test" },
      hard_entities: [
        { name: "Mira Vale", accepted_types: ["npc"], aliases: ["Mira"] },
        { name: "Moon Gate", accepted_types: ["location", "other"] },
      ],
      soft_entities: [], core_relationships: [], core_facts: [],
    };
    const inventory: ValidatedExtractionInventoryOutput = { entities: [
      { temporary_id: "inv_1", name: "Mira", type: "npc", sources: [{ page_number: 1, supporting_text: "Mira guards the Moon Gate." }] },
      { temporary_id: "inv_2", name: "Moon Gate", type: "other", sources: [{ page_number: 1, supporting_text: "Mira guards the Moon Gate." }] },
    ] };
    const score = scoreWotbsInventory(inventory, reference as ReturnType<typeof loadWotbsGoldReference>["reference"]);
    expect(score.matchedGoldNames).toContain("Mira Vale");
    expect(score.matchedGoldNames).toContain("Moon Gate");
  });

  it("preserves an inventory entity omitted by Pass B and rejects unknown relationship endpoints", () => {
    const inventory: ValidatedExtractionInventoryOutput = { entities: [
      { temporary_id: "inv_gate", name: "Moon Gate", type: "location", sources: [{ page_number: 1, supporting_text: "Mira Vale guards the Moon Gate." }] },
      { temporary_id: "inv_mountains", name: "Silver Hills", type: "location", sources: [{ page_number: 1, supporting_text: "The Moon Gate stands beside the Silver Hills." }] },
    ] };
    const rich: ExtractionRichOutput = { entities: [], relationships: [], suspected_inventory_misses: [] };
    const validated = validateExtractionRich(rich, inventory, [{ pageNumber: 1, text: "Mira Vale guards the Moon Gate. The Moon Gate stands beside the Silver Hills." }]);
    const candidate = assembleChunkExtraction(inventory, validated.rich);
    expect(candidate.entities).toHaveLength(2);
    expect(candidateAssemblySafety(inventory, candidate)).toMatchObject({ inventorySurvives: true, relationshipEndpointsKnownIdsOnly: true });
    expect(() => validateExtractionRich({ ...rich, relationships: [{ source_temporary_id: "inv_gate", target_temporary_id: "unknown", relationship_type: "located_in", description: "The gate stands beside the hills.", confidence: 1, sources: [{ page_number: 1, supporting_text: "The Moon Gate stands beside the Silver Hills." }] }] }, inventory, [{ pageNumber: 1, text: "The Moon Gate stands beside the Silver Hills." }])).toThrow(/Unknown relationship endpoint/);
  });

  it("has no campaign persistence surface", () => {
    const script = readFileSync(new URL("../scripts/evaluate-wotbs-stage1.ts", import.meta.url), "utf8");
    expect(script).not.toMatch(/createAdminClient|lib\/db|\.from\(["'`]campaigns/);
  });
});
