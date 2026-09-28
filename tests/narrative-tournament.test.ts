import { describe, expect, it } from "vitest";
import { inputIdentity, narrativeOutputSchema, reservePaidDispatch, scoreReviewed, validateGrounding } from "../lib/ai/narrative-tournament";

describe("development narrative tournament", () => {
  it("binds checkpoints to prompt and exact input", () => {
    const page = [{ physicalPdfPage: 1, text: "Mira intends to travel." }];
    expect(inputIdentity("baseline", "synthetic", page).inputHash).not.toBe(inputIdentity("narrative_first", "synthetic", page).inputHash);
    expect(inputIdentity("baseline", "synthetic", page).inputHash).not.toBe(inputIdentity("baseline", "synthetic", [{ ...page[0], text: "Mira travels." }]).inputHash);
  });
  it("requires source quotes and resolved endpoints", () => {
    const output = narrativeOutputSchema.parse({ propositions: [{ id: "p1", statement: "Mira intends to travel.", modality: "intention", subjects: ["Mira"], evidence: [{ page: 1, quote: "intends to travel" }] }],
      entities: [{ name: "Mira", type: "npc", presentation: "page", parentOrAttachment: "", existencePage: 1, existenceQuote: "Mira" }], relationships: [], sourceDiscrepancies: [] });
    expect(validateGrounding(output, [{ physicalPdfPage: 1, text: "Mira intends to travel." }])).toEqual([]);
    expect(validateGrounding(output, [{ physicalPdfPage: 1, text: "Mira plans nothing." }])).toHaveLength(1);
  });
  it("blocks dispatches before exceeding token, money and call ceilings", () => {
    const state = { dispatches: 0, actualInputTokens: 0, actualOutputTokens: 0, actualTotalTokens: 0, unresolvedDispatch: false };
    const caps = { maxUsd: 1, inputUsdPerMillion: 1, outputUsdPerMillion: 1 };
    expect(reservePaidDispatch(state, caps, "hello", 30000).totalReservation).toBeGreaterThan(30000);
    expect(() => reservePaidDispatch({ ...state, dispatches: 50 }, caps, "hello", 1)).toThrow(/50-dispatch/);
    expect(() => reservePaidDispatch({ ...state, actualInputTokens: 1_990_000, actualTotalTokens: 1_990_000 }, caps, "hello", 30000)).toThrow(/token reservation/);
    expect(() => reservePaidDispatch(state, { ...caps, maxUsd: 0.001 }, "hello", 30000)).toThrow(/money cap/);
    expect(() => reservePaidDispatch({ ...state, unresolvedDispatch: true }, caps, "hello", 1)).toThrow(/Unresolved/);
  });
  it("scores only reviewed meaning, modality and evidence", () => {
    const gold = { claims: [{ id: "G1", importance: 3, subjects: ["Mira", "Joran"] }, { id: "G2", importance: 2, subjects: ["Mira"] }], entities: [{ id: "E1" }], negativeChecks: [{ id: "X1" }] };
    const score = scoreReviewed(gold, { propositions: [{ goldId: "G1", outputIds: ["p1"], meaning: "correct", modality: false, evidence: true }],
      entities: [{ goldId: "E1", outputName: "Mira", identity: true, presentation: false, parent: true }], relationships: [{ goldClaimId: "G1", outputIndex: null, endpoints: true, meaning: false, evidence: true }], negativeChecks: [{ goldId: "X1", passed: true }], unsupportedOutputIds: ["p2"] });
    expect(score.propositionPoints).toBe(0);
    expect(score.weightedTotal).toBe(5);
    expect(score.presentationPoints).toBe(0);
    expect(score.relationshipPoints).toBe(0);
    expect(score.complete).toBe(false);
  });
});
