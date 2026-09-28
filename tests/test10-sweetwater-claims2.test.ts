import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { claims2TokenDiagnostics } from "../lib/ai/claims-2-experiment";
import { parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { fixtureHash, planTest10Claims2, test10Identity } from "../lib/ai/test10-claims2";

const pageTexts = [
  "Intro d uction\nBackground\nGalell waited.\nUl lae\nA sidebar.\nThe Wor ld of\nThe Demonplague\nAnother sidebar.",
  "5 Introduction\nthe ward must be renewed.\nAdventure\nSynopsis\nA synopsis.\nAdventure Hook\nJeanas asks for help.",
  "Sweetwater Vil lage\nRuins\nPhalin lives here.\nPhalin and Callia\nA DC 16 Charisma (Deception or",
  "7 Sweetwater Village Ruins\nPersuasion) check persuades Phalin.\nTrapdoor\nA door is locked.\nTreasure\nA dagger is held.",
  "Temple Catacombs\nA crypt.\nAreas of the\nCatacombs\nRooms follow.\n[S1] Rotted Pantry\nBones stir.\nCat acombs Features\nNo light.",
  "9 Temple Catacombs\n[S2] The Room of Sorrow\nA skeleton.\n[S3] The Crypts\nA merath waits.\nT empl e Cat acombs Level 1",
  "10 Sweetwater Village\nAltar.\nAn altar.\nInterment Niches.\nA niche.\nSecret Door.\nA door.\n[S4] Putrid Moss\nMoss.\n[S5] Treasure Room\nCoins.\nTreasure.\nGold.",
  "11 Temple Catacombs\nConclusion\nThey leave.",
];
const pages = pageTexts.map((text, index) => ({ pageNumber: index + 6, text }));
const inventory: GraphInventory = { entities: [{ temporary_id: "galell", name: "Galell", type: "npc", aliases: ["the merath"], sources: [] }] };

describe("Test 10 offline planning", () => {
  it("requires exact physical pages and preserves raw evidence offsets", () => {
    expect(() => planTest10Claims2(pages.slice(1), inventory)).toThrow(/pages 6–13/);
    const { request } = planTest10Claims2(pages, inventory);
    for (const unit of request.evidenceUnits) {
      const raw = pages.find((page) => page.pageNumber === unit.page)!.text;
      expect(raw.slice(unit.rawSource.start, unit.rawSource.end)).toBe(unit.rawSource.text);
    }
    expect(request.evidenceUnits.find((unit) => unit.text.includes("Deception or"))?.context).toBe("Phalin and Callia");
    expect(request.evidenceUnits.find((unit) => unit.text.includes("Persuasion)"))?.context).toBe("Phalin and Callia");
    const before = request.evidenceUnits.find((unit) => unit.text.includes("Deception or"))!;
    const after = request.evidenceUnits.find((unit) => unit.text.includes("Persuasion)"))!;
    expect(after.order).toBe(before.order + 1);
    expect(request.evidenceUnits.some((unit) => unit.text.includes("T empl e Cat acombs Level 1"))).toBe(false);
    expect(request.evidenceUnits.find((unit) => unit.text === "Trapdoor")?.kind).toBe("heading");
  });

  it("separates source and inventory identities", () => {
    const { context, request } = planTest10Claims2(pages, inventory);
    const a = test10Identity({ request, fixtureHash: fixtureHash(pages), inventoryHash: "inventory-a", contextFingerprint: JSON.stringify(context), modelId: "gpt-6-luna" });
    const b = test10Identity({ request, fixtureHash: fixtureHash(pages), inventoryHash: "inventory-b", contextFingerprint: JSON.stringify(context), modelId: "gpt-6-luna" });
    expect(a.campaignId).toBe("test10-sweetwater-fixture");
    expect(a.operationKey).toBe("test10-sweetwater-claims2-v1-1");
    expect(a.upstreamFingerprint).not.toBe(b.upstreamFingerprint);
    expect(fixtureHash(pages)).not.toBe(fixtureHash(pages.map((page, index) => index === 0 ? { ...page, text: `${page.text} changed` } : page)));
  });

  it("reserves output and zero retry overhead and resumes only completed requests", () => {
    const { request } = planTest10Claims2(pages, inventory);
    const id = request.requestId;
    const config = parseExperimentBudgetConfig({ totalTokenBudget: 100, inputReserveMultiplier: 1.2, sdkMaxRetries: 0, requests: { [id]: { maxOutputTokens: 20 } } }, [id]);
    const estimated = claims2TokenDiagnostics(request).estimatedTokens.totalInput;
    expect(reserveExperimentRequest(config, id, estimated, 0).fits).toBe(false);
    expect(pendingExperimentRequests([id], [])).toEqual([id]);
    expect(pendingExperimentRequests([id], [{ requestId: id, state: "completed" }])).toEqual([]);
    expect(() => pendingExperimentRequests([id], [{ requestId: id, state: "dispatching" }])).toThrow();
  });
});
