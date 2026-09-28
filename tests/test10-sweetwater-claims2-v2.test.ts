import { describe, expect, it } from "vitest";
import { parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { fixtureHash } from "../lib/ai/test10-claims2";
import { planTest10Claims2V2, test10V2Identity, type Test10InventoryEntry } from "../lib/ai/test10-claims2-v2";

const texts = [
  "Intro d uction\nBackground\nGalell became the merath. Each day,\nUl lae\nA sidebar.\nThe Wor ld of\nThe Demonplague\nAnother sidebar.",
  "5 Introduction\nthe priests must renew the wards.\nAdventure\nSynopsis\nA synopsis.\nAdventure Hook\nJeanas asks for help.",
  "Sweetwater Vil lage\nRuins\nA village.\nPhalin and Callia\nA DC 16 Charisma (Deception or",
  "7 Sweetwater Village Ruins\nPersuasion) check persuades Phalin.\nTrapdoor\nA door.\nTreasure\nA dagger.",
  "Temple Catacombs\nA crypt.\nAreas of the\nCatacombs\nRooms follow.\n[S1] Rotted Pantry\nBones stir.\nCat acombs Features\nNo light.",
  "9 Temple Catacombs\nMold poisons a creature.\n[S2] The Room of Sorrow\nA skeleton.\n[S3] The Crypts\nA merath waits.\nT empl e Cat acombs Level 1",
  "10 Sweetwater Village\nThe merath attacks.\nAltar.\nAn altar.\nInterment Niches.\nA niche.\nSecret Door.\nA door.\n[S4] Putrid Moss\nMoss.\n[S5] Treasure Room\nCoins.\nTreasure.\nGold.",
  "11 Temple Catacombs\nConclusion\nThey leave.",
];
const pages = texts.map((text, index) => ({ pageNumber: index + 6, text }));
const entries: Test10InventoryEntry[] = [{ id: "galell", name: "Galell", type: "npc", aliases: [],
  sourceReference: { physicalPdfPage: 6, start: 28, end: 34, exactText: "Galell" },
  sourceScopedIdentification: [{ reference: "the merath", evidence: [{ physicalPdfPage: 6, start: 28, end: 53, exactText: "Galell became the merath" }] }] }];

describe("Test 10 v2 chunk proposal", () => {
  it("covers every evidence unit once with exact raw offsets and two fixed page chunks", () => {
    const plan = planTest10Claims2V2(pages, entries);
    expect(plan.requests.map((request) => [...new Set(request.evidenceUnits.map((unit) => unit.page))])).toEqual([[6, 7, 8, 9], [10, 11, 12, 13]]);
    expect(plan.requests.flatMap((request) => request.evidenceUnits.map((unit) => unit.unitId))).toEqual(plan.units.map((unit) => unit.unitId));
    for (const unit of plan.units) expect(pages.find((page) => page.pageNumber === unit.page)!.text.slice(unit.rawSource.start, unit.rawSource.end)).toBe(unit.rawSource.text);
  });

  it("tracks all four page boundaries and reports context that the unchanged harness cannot carry", () => {
    const plan = planTest10Claims2V2(pages, entries);
    const pageUnit = (page: number, fragment: string) => plan.units.find((unit) => unit.page === page && unit.text.includes(fragment))!;
    expect(pageUnit(8, "Deception or").context).toBe(pageUnit(9, "Persuasion)").context);
    expect(pageUnit(10, "Bones stir").context).toBe(pageUnit(11, "Mold poisons").context);
    expect(pageUnit(11, "A merath waits").context).toBe(pageUnit(12, "The merath attacks").context);
    expect(pageUnit(7, "the priests").context).toBe("Background");
    expect(plan.contextGaps.map((gap) => gap.kind).sort()).toEqual(["interrupted_page_continuation", "source_scoped_identity_outside_chunk"]);
    expect(plan.requests[1].entities[0].aliases).toEqual([]);
  });

  it("versions checkpoint identity and stops ambiguous resume and budget plans", () => {
    const plan = planTest10Claims2V2(pages, entries);
    const request = plan.requests[0];
    const args = { request, fixtureHash: fixtureHash(pages), inventoryHash: "inventory-v2", manifestHash: "manifest-a", contextFingerprint: plan.contextFingerprint, modelId: "gpt-6-luna" };
    const a = test10V2Identity(args);
    const b = test10V2Identity({ ...args, manifestHash: "manifest-b" });
    expect(a.operationType).toBe("test10_claims_2_experiment_v2");
    expect(a.upstreamFingerprint).not.toBe(b.upstreamFingerprint);
    const ids = plan.requests.map((item) => item.requestId);
    const config = parseExperimentBudgetConfig({ totalTokenBudget: 100, inputReserveMultiplier: 1.3, sdkMaxRetries: 0,
      requests: Object.fromEntries(ids.map((id) => [id, { maxOutputTokens: 90 }])) }, ids);
    expect(reserveExperimentRequest(config, ids[0], 20, 0).fits).toBe(false);
    expect(pendingExperimentRequests(ids, [{ requestId: ids[0], state: "completed" }])).toEqual([ids[1]]);
    expect(() => pendingExperimentRequests(ids, [{ requestId: ids[0], state: "dispatching" }])).toThrow();
  });
});
