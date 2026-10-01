import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Claims3Request } from "../lib/ai/claims-3-experiment";
import { claims41Preflight, loadFrozenClaims41Benchmarks } from "../lib/ai/claims-4-1-benchmarks";
import { CLAIMS_4_1_PROMPT, planClaims41Request, reconcileClaims41 } from "../lib/ai/claims-4-1-experiment";
import { authorizeClaims41Live, CLAIMS41_AUTHORIZATION_VARIABLE, CLAIMS41_REQUEST_ID } from "../lib/ai/claims-4-1-dispatch";

const sentences = [
  "The characters find a note in the well.",
  "The note names Galell, who returned as a merath.",
  "A creature guards the shrine.",
  "A monster with the hero role lurks nearby.",
  "Thousands of heroes fought in the old war.",
  "Ilya is rumored to be immortal. The characters receive a reward.",
  "The characters may enter the tomb if Jeanas agrees.",
];
const base: Claims3Request = { requestId: "test9-claims3-2", baselineRequestId: "test9-claims2-2",
  entities: [{ canonicalId: "galell", name: "Galell", type: "npc", aliases: [] },
    { canonicalId: "system:heroes-party", name: "Heroes / Party", type: "other", aliases: ["Heroes"] }],
  evidenceUnits: sentences.map((text, order) => ({ unitId: `p13.u${order}`, segmentId: "p13", page: 13,
    context: order === 6 ? "full_campaign_timeline_assuming_heroes_succeed" : "main", kind: "sentence" as const,
    order, text, rawSource: { page: 13, start: order * 100, end: order * 100 + text.length, text } })) };
const request = planClaims41Request(base);
const claim = (statement: string, participants: string[], id: string) => ({ statement, participants, evidence_unit_ids: [id] });

describe("Claims-4.1 isolated reconciliation", () => {
  it("requires a distinct authorization, exact request, one-call cap, and system CA", () => {
    const gate = { live: true, authorization: "1", allowedRequestIds: [CLAIMS41_REQUEST_ID], maxCalls: 1,
      plannedRequestIds: [CLAIMS41_REQUEST_ID], previousAttemptExists: false, execArgv: ["--use-system-ca"] };
    expect(CLAIMS41_AUTHORIZATION_VARIABLE).toBe("ALLOW_PAID_CLAIMS41_WOTBS_LUNA");
    expect(() => authorizeClaims41Live(gate)).not.toThrow();
    expect(() => authorizeClaims41Live({ ...gate, authorization: undefined })).toThrow();
    expect(() => authorizeClaims41Live({ ...gate, live: false })).toThrow();
    expect(() => authorizeClaims41Live({ ...gate, allowedRequestIds: ["test9-claims4-1-1"] })).toThrow();
    expect(() => authorizeClaims41Live({ ...gate, maxCalls: 2 })).toThrow();
    expect(() => authorizeClaims41Live({ ...gate, previousAttemptExists: true })).toThrow();
    expect(() => authorizeClaims41Live({ ...gate, execArgv: [] })).toThrow();
  });
  it("uses the specified fine-grained prompt and a separate identity", () => {
    expect(CLAIMS_4_1_PROMPT).toContain("One independently useful fact is the default claim unit.");
    expect(CLAIMS_4_1_PROMPT).toContain("Return only the fixed candidate-claim schema.");
    expect(request.requestId).toBe("test9-claims4-1-2");
    expect(request.evidenceUnits.map((unit) => unit.rawSource)).toEqual(base.evidenceUnits.map((unit) => unit.rawSource));
  });

  it("links genuine characters and protects in-world heroes and game roles", () => {
    const result = reconcileClaims41({ claims: [
      claim("The characters find a note in the well.", ["Heroes / Party"], "p13.u0"),
      claim("A monster with the hero role lurks nearby.", ["Heroes"], "p13.u3"),
      claim("Thousands of heroes fought in the old war.", ["Heroes"], "p13.u4"),
    ] }, request);
    expect(result.proposals[0].participants[0].canonicalId).toBe("system:heroes-party");
    expect(result.proposals[1].participants[0].diagnostic).toBe("game_role_not_party");
    expect(result.proposals[2].participants[0].diagnostic).toBe("in_world_collective_not_party");
  });

  it("keeps evidence, links, and status decisions independent", () => {
    const result = reconcileClaims41({ claims: [
      claim("The characters find a note in the well.", ["Heroes / Party", "Missing Name", "a creature"], "p13.u0"),
      claim("Galell returned as a merath.", ["Galell", "merath"], "p13.u1"),
      claim("The characters receive a reward.", ["Heroes / Party"], "p13.u5"),
      claim("The characters find a note in the well.", ["Heroes / Party"], "missing"),
    ] }, request);
    expect(result.proposals[0]).toMatchObject({ evidenceValidity: "valid", participantResolution: "pending", sourceStatusDecision: "qualified" });
    expect(result.proposals[0].participants[0].canonicalId).toBe("system:heroes-party");
    expect(result.proposals[0].participants[2].diagnostic).toBe("generic_non_entity");
    expect(result.proposals[1].participants[1].canonicalId).toBeNull();
    expect(result.proposals[2]).toMatchObject({ sourceStatus: "established", sourceStatusDecision: "qualified" });
    expect(result.proposals[3].evidenceValidity).toBe("pending");
    expect(result.claims[0].state).toBe("pending_identity");
  });

  it("uses inherited scenario context and does not poison sound duplicates", () => {
    const result = reconcileClaims41({ claims: [
      claim("The characters may enter the tomb if Jeanas agrees.", ["Heroes / Party"], "p13.u6"),
      claim("The characters find a note in the well.", ["Heroes / Party"], "p13.u0"),
      claim("The characters find a note in the well.", ["Unknown"], "missing"),
    ] }, request);
    expect(result.proposals[0]).toMatchObject({ sourceStatus: "scheduled", sourceStatusDecision: "qualified", state: "ready" });
    expect(result.claims[1]).toMatchObject({ state: "ready", evidenceValidity: "valid", participantResolution: "resolved" });
    expect(result.claims[1].duplicateProposalIndexes).toEqual([2]);
  });
});

const privateFixtures = existsSync(join(process.cwd(), "fixtures/private/test9-focused-ab/fixture.json")) &&
  existsSync(join(process.cwd(), "fixtures/private/test10-sweetwater-v1/result.v3.json")) &&
  existsSync(join(process.cwd(), "fixtures/private/test11-tales-claims2-v1/result.v1.json"));
describe.skipIf(!privateFixtures)("Claims-4.1 frozen source regressions", () => {
  it("preflights only WotBS November physical pages 13–14", async () => {
    const preflight = claims41Preflight(await loadFrozenClaims41Benchmarks());
    expect(preflight).toMatchObject({ plannedCalls: 1, liveCallsMade: 0, hardCallBudget: 1 });
    expect(preflight.requests).toHaveLength(1);
    expect(preflight.requests[0]).toMatchObject({ requestId: "test9-claims4-1-2", pages: [13, 14], evidenceUnits: 66 });
    expect(preflight.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preflight.schemaHash).toMatch(/^[a-f0-9]{64}$/);
  }, 30000);

  it("keeps November developments as separate claims in the inherited timeline", async () => {
    const request = (await loadFrozenClaims41Benchmarks()).flatMap((item) => item.requests)[1];
    const result = reconcileClaims41({ claims: [
      claim("Emperor Coaltongue is killed in Castle Korstull in November.", ["Drakus Coaltongue", "Castle Korstull"], "13a.u07"),
      claim("Drow assassins abduct Emperor Coaltongue in November.", ["drow assassins", "Drakus Coaltongue"], "13a.u07"),
      claim("Teleportation becomes deadly in November.", [], "13a.u08"),
    ] }, request);
    expect(result.claims).toHaveLength(3);
    expect(result.proposals.map((item) => item.sourceStatus)).toEqual(["scheduled", "scheduled", "scheduled"]);
    expect(result.proposals.every((item) => item.sourceStatusDecision === "qualified")).toBe(true);
    expect(result.proposals.every((item) => item.evidenceValidity === "valid")).toBe(true);
  }, 30000);

  it("uses Sweetwater's characters context and keeps merath identity local", async () => {
    const request = (await loadFrozenClaims41Benchmarks()).flatMap((item) => item.requests)[2];
    const result = reconcileClaims41({ claims: [
      claim("Jeanas asks the characters to kill the merath.", ["Jeanas Clocker", "Heroes / Party", "the merath"], "p7.u012"),
      claim("The nymph returned as a merath.", ["merath"], "p6.u010"),
    ] }, request);
    expect(result.proposals[0].participants.find((item) => item.name === "Heroes / Party")?.canonicalId).toBe("system:heroes-party");
    expect(result.proposals[0].participants.find((item) => item.name === "the merath")?.canonicalId)
      .toBe(request.entities.find((item) => item.name === "Galell")?.canonicalId);
    expect(result.proposals[1].participants[0].canonicalId).toBeNull();
  }, 30000);

  it("does not turn Tales' monster role into the Party", async () => {
    const request = (await loadFrozenClaims41Benchmarks()).flatMap((item) => item.requests)[3];
    const result = reconcileClaims41({ claims: [
      claim("A demon with the hero role dwells in the shrine.", ["Heroes"], "p27.u036"),
      claim("Characters find a note wedged into the Old Well.", ["characters", "Old Well"], "p27.u049"),
    ] }, request);
    expect(result.proposals[0].participants[0]).toMatchObject({ canonicalId: null, diagnostic: "game_role_not_party" });
    expect(result.proposals[1].participants[0].canonicalId).toBe("system:heroes-party");
  }, 30000);
});
