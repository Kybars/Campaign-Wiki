import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { claims2TokenDiagnostics } from "../lib/ai/claims-2-experiment";
import { parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { fixtureHash, planTest10Claims2 } from "../lib/ai/test10-claims2";
import { planTest10Claims2V3, test10V3DispatchStatus, test10V3Identity, TEST10_V3_REQUEST_ID } from "../lib/ai/test10-claims2-v3";
import type { Test10InventoryEntry } from "../lib/ai/test10-claims2-v2";

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

describe("Test 10 v3 single-chunk baseline", () => {
  it("keeps the original evidence segmentation and raw offsets across all pages", () => {
    const v3 = planTest10Claims2V3(pages, entries);
    const originalInventory: GraphInventory = { entities: [{ temporary_id: "galell", name: "Galell", type: "npc", aliases: [], sources: [] }] };
    const original = planTest10Claims2(pages, originalInventory).request;
    expect(v3.request.requestId).toBe(TEST10_V3_REQUEST_ID);
    expect(v3.request.evidenceUnits).toEqual(original.evidenceUnits);
    expect([...new Set(v3.request.evidenceUnits.map((unit) => unit.page))]).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
    expect(v3.request.entities[0].aliases).toEqual([]);
    const firstOn11 = v3.request.evidenceUnits.find((unit) => unit.page === 11)!;
    expect(firstOn11.context).toBe("Temple Catacombs / Room of Sorrow / Crypts");
    for (const unit of v3.request.evidenceUnits) expect(pages.find((page) => page.pageNumber === unit.page)!.text.slice(unit.rawSource.start, unit.rawSource.end)).toBe(unit.rawSource.text);
  });

  it("makes limitations nonfatal while budget reservations gate dispatch", () => {
    const request = planTest10Claims2V3(pages, entries).request;
    const estimated = claims2TokenDiagnostics(request).estimatedTokens.totalInput;
    const makeConfig = (totalTokenBudget: number) => parseExperimentBudgetConfig({ totalTokenBudget, inputReserveMultiplier: 1.2, sdkMaxRetries: 0,
      stageBudgets: { claims2: totalTokenBudget }, requests: { [request.requestId]: { maxOutputTokens: 12000, stage: "claims2" } } }, [request.requestId]);
    const limitations = ["Nonadjacent page 6–7 source fragments remain rejected"];
    const fits = test10V3DispatchStatus(reserveExperimentRequest(makeConfig(24000), request.requestId, estimated, 0), limitations);
    expect(fits).toEqual({ fatalDispatchBlockers: [], knownEvaluationLimitations: limitations, runnable: true });
    const blocked = test10V3DispatchStatus(reserveExperimentRequest(makeConfig(12000), request.requestId, estimated, 0), limitations);
    expect(blocked.runnable).toBe(false);
    expect(blocked.knownEvaluationLimitations).toEqual(limitations);
  });

  it("uses a v3 checkpoint identity and fail-closed resume", () => {
    const plan = planTest10Claims2V3(pages, entries);
    const args = { request: plan.request, fixtureHash: fixtureHash(pages), inventoryHash: "frozen-v2", worksheetHash: "worksheet-v3", manifestHash: "manifest-v3", contextFingerprint: plan.contextFingerprint, modelId: "gpt-6-luna" };
    const a = test10V3Identity(args);
    expect(a.operationType).toBe("test10_claims_2_experiment_v3");
    expect(a.operationKey).toBe(TEST10_V3_REQUEST_ID);
    expect(a.upstreamFingerprint).not.toBe(test10V3Identity({ ...args, worksheetHash: "changed" }).upstreamFingerprint);
    expect(pendingExperimentRequests([TEST10_V3_REQUEST_ID], [])).toEqual([TEST10_V3_REQUEST_ID]);
    expect(() => pendingExperimentRequests([TEST10_V3_REQUEST_ID], [{ requestId: TEST10_V3_REQUEST_ID, state: "dispatching" }])).toThrow();
    expect(pendingExperimentRequests([TEST10_V3_REQUEST_ID], [{ requestId: TEST10_V3_REQUEST_ID, state: "completed" }])).toEqual([]);
  });
});
