import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41V2 } from "../lib/ai/claims-4-1-reconciliation-v2";
import { loadFrozenClaims41Benchmarks } from "../lib/ai/claims-4-1-benchmarks";

const sources = [
  ["heading", "Timeline for the War", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "You should expand or compress the timeline to suit the GM's campaign.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "In general, the war moves at the speed of marching troops.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "November * — Teleportation becomes deadly.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "General Magdus commands the First Ragesian Army.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "The Second Ragesian Army advances, while the Third Ragesian Army waits and the Fourth Ragesian Army retreats.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "A creature frightens Seaquen.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "An unknown named captain, Velorien, enters Seaquen.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "Pilus plans to use the Tempest to seize power.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "March * — A supernatural hurricane strikes Seaquen.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "The Shahalesti fleet is destroyed by the hurricane.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "Agents of Seaquen recover the Torch.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "Gabal and his students defend the city.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "Bookkeepers of the Merchant Guild record the payments.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["sentence", "The western storeroom of Castle Korstull contains supplies.", "full_campaign_timeline_assuming_heroes_succeed"],
  ["heading", "What If They Do Nothing?", "what_if_they_do_nothing"],
  ["sentence", "Without the heroes, the war continues elsewhere.", "what_if_they_do_nothing"],
] as const;
const entities = ["Ragesian Army", "General Magdus", "Seaquen", "Shahalesti", "Pilus", "The Tempest", "Gabal", "Merchant Guild", "Castle Korstull"]
  .map((name) => ({ canonicalId: `e:${name}`, name, type: "faction", aliases: [] }));
const request: Claims41Request = { requestId: "synthetic-claims41", baselineRequestId: "synthetic", entities,
  evidenceUnits: sources.map(([kind, text, context], order) => ({ unitId: `u${order}`, segmentId: "synthetic", page: 1,
    context, kind, order, text, rawSource: { page: 1, start: order * 200, end: order * 200 + text.length, text } })), inputDifferences: [] };
const claim = (statement: string, participants: string[], index: number) => ({ statement, participants, evidence_unit_ids: [`u${index}`] });
const one = (statement: string, participants: string[], index: number) => reconcileClaims41V2({ claims: [claim(statement, participants, index)] }, request).claims[0];

describe("Claims-4.1 Reconciliation v2", () => {
  it("retains ordinal military wording as descriptors linked to the parent and allows many-to-many links", () => {
    const item = one("General Magdus commands the First Ragesian Army.", ["General Magdus", "First Ragesian Army"], 4);
    expect(item.original.statement).toContain("First Ragesian Army");
    expect(item.participants).toEqual([
      { mention: "General Magdus", kind: "canonical_entity", canonicalId: "e:General Magdus", canonicalName: "General Magdus" },
      { mention: "First Ragesian Army", kind: "descriptor", canonicalId: "e:Ragesian Army", canonicalName: "Ragesian Army" },
    ]);
    expect(item.entityAssociations.map((entity) => entity.canonicalName)).toEqual(["General Magdus", "Ragesian Army"]);
    expect(item.resolutionState).toBe("resolved");
    for (const ordinal of ["Second", "Third", "Fourth"]) {
      const next = one(`${ordinal} Ragesian Army moves.`, [`${ordinal} Ragesian Army`], 5);
      expect(next.participants[0]).toMatchObject({ kind: "descriptor", canonicalName: "Ragesian Army" });
    }
  });

  it("resolves descriptive groups and subrooms only through explicit source affiliation", () => {
    const cases = [
      ["Shahalesti fleet", 10, "Shahalesti"], ["agents of Seaquen", 11, "Seaquen"],
      ["Gabal's students", 12, "Gabal"], ["guild bookkeepers", 13, "Merchant Guild"],
      ["western storeroom of Castle Korstull", 14, "Castle Korstull"],
    ] as const;
    for (const [mention, index, parent] of cases) {
      const item = one(sources[index][1], [mention], index);
      expect(item.participants[0]).toMatchObject({ mention, kind: "descriptor", canonicalName: parent });
      expect(item.resolutionState).toBe("resolved");
    }
  });

  it("treats generic participants as nonentities without review, and unknown names as unresolved even on a timeline", () => {
    const generic = one("A creature frightens Seaquen.", ["a creature", "Seaquen"], 6);
    expect(generic.participants[0].kind).toBe("generic_non_entity");
    expect(generic.resolutionState).toBe("resolved");
    const unknown = one("Velorien enters Seaquen.", ["Velorien", "Seaquen"], 7);
    expect(unknown.participants[0].kind).toBe("unresolved");
    expect(unknown.timelineAssociation?.timeLabel).toBe("November");
    expect(unknown.resolutionState).toBe("needs_review");
  });

  it("propagates months, keeps pre-November prose out of the timeline, and resolves timeline-only claims", () => {
    const intro = one("In general, the war moves at the speed of marching troops.", [], 2);
    expect(intro.timelineAssociation).toBeNull();
    expect(intro.resolutionState).toBe("needs_review");
    expect(intro.reviewReasons).toContain("no_useful_home");
    const november = one("Teleportation becomes deadly.", [], 3);
    expect(november.timelineAssociation).toMatchObject({ branch: "main_assuming_heroes_succeed", timeLabel: "November", propositionStatus: "published_scheduled" });
    expect(november.resolutionState).toBe("resolved");
    expect(one("A creature frightens Seaquen.", ["Seaquen"], 6).timelineAssociation?.timeLabel).toBe("November");
    expect(one("The Shahalesti fleet is destroyed by the hurricane.", ["Shahalesti fleet"], 10).timelineAssociation?.timeLabel).toBe("March");
  });

  it("keeps the alternate branch separate, plans as plans, and GM instructions off the event timeline", () => {
    const alternate = one("Without the heroes, the war continues elsewhere.", [], 16);
    expect(alternate.timelineAssociation).toMatchObject({ branch: "heroes_do_nothing", timeLabel: null });
    expect(alternate.resolutionState).toBe("resolved");
    const plan = one("Pilus plans to use the Tempest to seize power.", ["Pilus", "The Tempest"], 8);
    expect(plan.sourceStatus).toBe("plan");
    expect(plan.timelineAssociation?.propositionStatus).toBe("plan");
    const instruction = one("The GM may expand or compress the timeline.", [], 1);
    expect(instruction.sourceStatus).toBe("gm_instruction");
    expect(instruction.timelineAssociation).toBeNull();
    expect(instruction.resolutionState).toBe("needs_review");
  });

  it("preserves every proposal, emits one GM Review collection, and never creates an entity", () => {
    const originals = [claim("A creature frightens Seaquen.", ["a creature", "Seaquen"], 6),
      claim("Velorien enters Seaquen.", ["Velorien", "Seaquen"], 7),
      claim("In general, the war moves at the speed of marching troops.", [], 2)];
    const result = reconcileClaims41V2({ claims: originals }, request);
    expect(result.rawProposals.claims).toEqual(originals);
    expect(result.claims.map((item) => item.original)).toEqual(originals);
    expect(result.gmReview.map((item) => item.proposalIndex)).toEqual([1, 2]);
    expect(result.claims.flatMap((item) => item.entityAssociations).every((item) => entities.some((entity) => entity.canonicalId === item.canonicalId))).toBe(true);
  });
});

const privateResult = join(process.cwd(), "fixtures/private/claims4-1-v1/test9-claims4-1-2.result.v1.json");
describe.skipIf(!existsSync(privateResult))("Claims-4.1 private saved replay", () => {
  it("preserves all 106 proposals without creating entities", async () => {
    const { readFileSync } = await import("node:fs");
    const saved = JSON.parse(readFileSync(privateResult, "utf8"));
    const frozen = (await loadFrozenClaims41Benchmarks()).flatMap((benchmark) => benchmark.requests)
      .find((item) => item.requestId === "test9-claims4-1-2")!;
    const result = reconcileClaims41V2(saved.originalParsedOutput, frozen);
    expect(result.claims).toHaveLength(106);
    expect(result.claims.map((item) => item.original)).toEqual(saved.originalParsedOutput.claims);
    expect(result.claims.flatMap((item) => item.entityAssociations).every((item) => frozen.entities.some((entity) => entity.canonicalId === item.canonicalId))).toBe(true);
    expect(result.claims[3]).toMatchObject({ resolutionState: "needs_review", timelineAssociation: null });
    expect(result.claims[6].participants.find((item) => item.mention === "drow assassins")?.kind).toBe("generic_non_entity");
    expect(result.claims[7]).toMatchObject({ resolutionState: "resolved", timelineAssociation: { timeLabel: "November" } });
    expect(result.claims[35].participants[0]).toMatchObject({ kind: "descriptor", canonicalName: "Shahalesti" });
    expect(result.claims[51]).toMatchObject({ resolutionState: "resolved", timelineAssociation: { timeLabel: "April" } });
    expect(result.claims[60]).toMatchObject({ sourceStatus: "plan", timelineAssociation: { timeLabel: "May", propositionStatus: "plan" } });
    expect(result.claims[74].timelineAssociation).toMatchObject({ timeLabel: "October" });
    expect(result.claims[81].timelineAssociation).toMatchObject({ branch: "heroes_do_nothing", timeLabel: null });
  }, 30000);
});
