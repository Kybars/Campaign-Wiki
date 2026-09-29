import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claims4Preflight, loadFrozenClaims4Benchmarks } from "../lib/ai/claims-4-benchmarks";
import { authorizeClaims4Live, CLAIMS4_AUTHORIZATION_VARIABLE, requireClaims4SystemCA } from "../lib/ai/claims-4-dispatch";
import { claims4OutputSchema, planClaims4Request, reconcileClaims4, serializeClaims4Request, type Claims4Request } from "../lib/ai/claims-4-experiment";
import { compareClaims4Coverage, planClaims4Rescue } from "../lib/ai/claims-4-coverage";
import type { Claims3Request } from "../lib/ai/claims-3-experiment";

const source = [
  "The Heroes meet a ranger named Ilya.",
  "Ilya is rumored to be immortal.",
  "Ilya's power depends on the Ember Stone.",
  "If the Heroes do nothing, Ilya would vanish.",
  "A demon with the hero role guards the shrine.",
  "The ranger found a hidden road.",
];
const base: Claims3Request = { requestId: "test9-claims3-1", baselineRequestId: "test9-claims2-1",
  entities: [{ canonicalId: "ilya", name: "Ilya", type: "npc", aliases: ["Ranger Ilya"] },
    { canonicalId: "stone", name: "Ember Stone", type: "item", aliases: [] },
    { canonicalId: "system:heroes-party", name: "Heroes / Party", type: "other", aliases: ["Heroes", "the Heroes"] }],
  evidenceUnits: source.map((text, order) => ({ unitId: `p1.u${order}`, segmentId: "p1", page: 1,
    context: order === 3 ? "what_if_they_do_nothing" : "main", kind: "sentence" as const, order, text,
    rawSource: { page: 1, start: order * 100, end: order * 100 + text.length, text } })) };
const request = planClaims4Request(base);
const candidate = (statement: string, participants: string[], ...evidence_unit_ids: string[]) => ({ statement, participants, evidence_unit_ids });
const run = (claims: ReturnType<typeof candidate>[]) => reconcileClaims4({ claims }, request);

describe("Claims-4 offline pipeline", () => {
  it("keeps original proposals when identity, evidence, or status is unresolved", () => {
    const claims = [
      candidate("The Heroes meet an unknown ranger named Ilya.", ["Heroes", "Unknown Ranger"], "p1.u0"),
      candidate("Ilya found a hidden road.", ["Ilya"], "p1.u4"),
      candidate("Ilya is immortal.", ["Ilya"], "p1.u1"),
    ];
    const result = run(claims);
    expect(result.rawProposals.claims).toEqual(claims);
    expect(result.proposals.map((item) => item.state)).toEqual(["pending_identity", "pending_evidence", "pending_source_status"]);
    expect(result.proposals[0].participants[1]).toMatchObject({ canonicalId: null, diagnostic: "unknown_participant" });
    expect(result.proposals[1].evidence[0]).toMatchObject({ unitId: "p1.u4", page: 1, start: 400 });
    expect(result.proposals[1].reasons).toContain("semantic_support_unverified");
    expect(result.proposals[2].sourceStatus).toBe("rumor");
  });

  it("keeps conditional scenarios and never maps a game role to Heroes", () => {
    const result = run([
      candidate("If the Heroes do nothing, Ilya would vanish.", ["Heroes", "Ilya"], "p1.u3"),
      candidate("A demon with the hero role guards the shrine.", ["Heroes", "demon"], "p1.u4"),
    ]);
    expect(result.proposals[0]).toMatchObject({ state: "ready", sourceStatus: "conditional" });
    expect(result.proposals[1].participants[0]).toMatchObject({ canonicalId: null, diagnostic: "game_role_not_party" });
  });

  it("merges only identical propositions and unions provenance and associations", () => {
    const result = run([
      candidate("Ilya's power depends on the Ember Stone.", ["Ilya"], "p1.u2"),
      candidate("Ilya's power depends on the Ember Stone.", ["Ember Stone"], "p1.u2"),
      candidate("Ilya is rumored to be immortal.", ["Ilya"], "p1.u1"),
      candidate("Ilya is immortal.", ["Ilya"], "p1.u1"),
    ]);
    expect(result.claims).toHaveLength(3);
    expect(result.claims[0].duplicateProposalIndexes).toEqual([1]);
    expect(result.claims[0].participants.map((item) => item.canonicalId)).toEqual(["ilya", "stone"]);
    expect(result.claims[2].state).toBe("pending_source_status");
  });

  it("compares propositions and source units, then plans only missing original spans", () => {
    const result = run([candidate("Ilya's power depends on the Ember Stone.", ["Ilya", "Ember Stone"], "p1.u2")]);
    const comparison = compareClaims4Coverage(request, [
      { origin: "claims2", statement: "Ilya's power depends on the Ember Stone.", unitIds: ["p1.u2"] },
      { origin: "claims3_proposed", statement: "The ranger found a hidden road.", unitIds: ["p1.u5"] },
    ], result.claims);
    expect(comparison.propositions.map((item) => item.representation)).toEqual(["ready", "missing"]);
    const rescue = planClaims4Rescue(request, comparison.gaps);
    expect(rescue).toMatchObject({ executable: false, requiresSeparateModelCallAuthorization: true });
    expect(rescue.batches.map((batch) => batch.unitIds)).toEqual([["p1.u5"]]);
  });

  it("requires the Claims-4-specific gate, system CA, exact allowlist, and cap", () => {
    const ids = ["a", "b", "c", "d"];
    const args = { live: true, authorization: "1", allowedRequestIds: ids, maxCalls: 4, plannedRequestIds: ids, existingAttempts: [] };
    expect(CLAIMS4_AUTHORIZATION_VARIABLE).toBe("ALLOW_PAID_CLAIMS4_V1_LUNA");
    expect(authorizeClaims4Live(args)).toEqual(ids);
    expect(() => authorizeClaims4Live({ ...args, authorization: undefined })).toThrow();
    expect(() => authorizeClaims4Live({ ...args, live: false })).toThrow();
    expect(() => authorizeClaims4Live({ ...args, maxCalls: 3 })).toThrow();
    expect(() => authorizeClaims4Live({ ...args, allowedRequestIds: ["other"] })).toThrow();
    expect(() => authorizeClaims4Live({ ...args, existingAttempts: [{ requestId: "a", state: "dispatching" }] })).toThrow();
    expect(() => requireClaims4SystemCA([])).toThrow();
    expect(() => requireClaims4SystemCA(["--use-system-ca"])).not.toThrow();
    expect(serializeClaims4Request(request).payload).toContain("non-exhaustive");
    expect(() => claims4OutputSchema.parse({ claims: [{ ...candidate("x", [], "p1.u0"), displayStatus: "ready" }] })).toThrow();
  });
});

const privateFixtures = existsSync(join(process.cwd(), "fixtures/private/test9-focused-ab/fixture.json")) &&
  existsSync(join(process.cwd(), "fixtures/private/test10-sweetwater-v1/result.v3.json")) &&
  existsSync(join(process.cwd(), "fixtures/private/test11-tales-claims2-v1/result.v1.json"));
describe.skipIf(!privateFixtures)("Claims-4 original-source regressions", () => {
  let requests: Claims4Request[];
  async function get() { return requests ??= (await loadFrozenClaims4Benchmarks()).flatMap((benchmark) => benchmark.requests); }
  const check = async (index: number, claims: ReturnType<typeof candidate>[]) => reconcileClaims4({ claims }, (await get())[index]);

  it("freezes four exact completed requests and hashes", async () => {
    const benchmarks = await loadFrozenClaims4Benchmarks();
    const preflight = claims4Preflight(benchmarks);
    expect(preflight.requests.map((item) => [item.baselineRequestId, item.pages, item.evidenceUnits])).toEqual([
      ["test9-claims2-1", [10, 11, 12], 71], ["test9-claims2-2", [13, 14], 66],
      ["test10-sweetwater-claims2-v3-1", [6, 7, 8, 9, 10, 11, 12, 13], 163],
      ["test11-tales-claims2-v1-1", [27, 28, 29, 30], 211],
    ]);
    expect(preflight.requests.map((item) => item.maxOutputTokens)).toEqual([12000, 12000, 16000, 18000]);
    expect(preflight.plannedCalls).toBe(4);
    for (const item of preflight.requests) expect(item.evidenceUnitIdsHash).toMatch(/^[a-f0-9]{64}$/);
  }, 30000);

  it("keeps WotBS rumor, Torch reliance, November, August evidence, and separate timelines", async () => {
    const w1 = await check(0, [
      candidate("Shaaladel rules Shahalesti, which has an unstable peace with Ragesia.", ["Shaaladel", "Shahalesti", "Ragesia"], "10b.u02"),
      candidate("Coaltongue is rumored to be immortal.", ["Drakus Coaltongue"], "10d.u01"),
      candidate("Coaltongue's success depended on the Torch of the Burning Sky.", ["Drakus Coaltongue", "Torch of the Burning Sky"], "10d.u02"),
    ]);
    expect(w1.proposals.map((item) => item.state)).toEqual(["ready", "ready", "ready"]);
    const w2 = await check(1, [
      candidate("In the full campaign timeline assuming the heroes succeed, Coaltongue is killed in Castle Korstull and abducted by drow assassins in November.", ["Drakus Coaltongue", "Castle Korstull"], "13a.u02", "13a.u07"),
      candidate("In the full campaign timeline, an August counteroffensive attacks Leska's research fortress.", ["Ragesia", "Leska"], "13g.u05"),
      candidate("In the full campaign timeline, an August counteroffensive attacks Leska's research fortress.", ["Ragesia", "Leska"], "13h.u05"),
      candidate("If the Heroes do nothing, the trillith destroy the Heart and everyone dies.", ["Heroes", "trillith"], "14c.u02"),
    ]);
    expect(w2.proposals[0].evidence.find((item) => item.unitId === "13a.u02")?.direct).toBe(false);
    expect(w2.proposals[0].reasons).not.toContain("nonadjacent_evidence_review");
    expect(w2.proposals[1].sourceStatus).toBe("scheduled");
    expect(w2.proposals[2].state).toBe("pending_evidence");
    expect(w2.proposals[2].reasons).toContain("semantic_support_unverified");
    expect(w2.proposals[3].sourceStatus).toBe("conditional");
  }, 30000);

  it("preserves Sweetwater continuation, Galell identity, source discrepancy, hook and reward", async () => {
    const sweet = (await get())[2];
    expect(sweet.evidenceUnits.find((unit) => unit.unitId === "p11.u004")?.context).toBe("[S1] Rotted Pantry");
    const result = await check(2, [
      candidate("The Rotted Pantry mold lets a poisoned creature speak telepathically to the merath in the tombs.", ["Rotted Pantry", "the merath"], "p11.u004"),
      candidate("The priests bound Ullae with special wards in the temple catacombs.", ["Ullae"], "p6.u013"),
      candidate("Jeanas Clocker can optionally send the characters to kill the merath and escort Phalin and Callia.", ["Jeanas Clocker", "Phalin", "Callia"], "p7.u008", "p7.u012"),
      candidate("If Jeanas promised a reward, he gives the characters two potions of healing after Phalin and Callia return.", ["Jeanas Clocker", "Phalin", "Callia"], "p13.u004"),
      candidate("Galell returned as a merath.", ["Galell", "merath"], "p6.u010"),
    ]);
    expect(result.proposals[0].context).toBe("[S1] Rotted Pantry");
    expect(result.proposals[0].participants.find((item) => item.name === "the merath")?.diagnostic).toBe("source_established_local_identity");
    expect(result.proposals[1].original.statement).toContain("bound Ullae");
    expect(result.proposals[1].reasons).toContain("possible_source_discrepancy");
    expect(result.proposals[1].state).toBe("pending_gm_review");
    expect(result.proposals[2].original.statement).toContain("optionally");
    expect(result.proposals[3].sourceStatus).toBe("conditional");
    expect(result.proposals[4].participants.find((item) => item.name === "merath")?.canonicalId).toBeNull();
  }, 30000);

  it("keeps Tales narration, rumor, blood cause, missed participant, note, markings and schedule", async () => {
    const result = await check(3, [
      candidate("Silas Branson killed Salla Reed near the Black Thorn.", ["Silas Branson", "Salla Reed", "Black Thorn"], "p27.u003"),
      candidate("Verge residents report that Salla Reed has been missing for three days.", ["Salla Reed", "Verge"], "p28.u012"),
      candidate("Because only a trace of Salla's blood touched the ground, the demon was forced back inside the Black Thorn.", ["Salla Reed", "Black Thorn", "demon"], "p27.u009"),
      candidate("Lesser Zeke is the son of Elder Zeke.", ["Lesser Zeke", "Elder Zeke"], "p29.u015"),
      candidate("Characters find a note wedged into the Old Well.", ["Old Well"], "p27.u049"),
      candidate("On Day 1, brigands leave signs resembling Dark Speech after attacking a farm.", ["brigands"], "p30.u004"),
      candidate("A demon with the hero role dwells in Gladys's shrine.", ["Heroes", "Gladys"], "p27.u036"),
      candidate("On Day 1, brigands leave meaningless Dark Speech-like scribbles after attacking a farm.", ["brigands"], "p30.u004"),
    ]);
    expect(result.proposals[0].sourceStatus).toBe("established");
    expect(result.proposals[1].sourceStatus).toBe("rumor");
    expect(result.proposals[2].original.statement).toContain("only a trace");
    expect(result.proposals[3].participants.find((item) => item.name === "Lesser Zeke")?.canonicalId).toBeNull();
    expect(result.proposals[4].original.statement).toContain("note");
    expect(result.proposals[5].sourceStatus).toBe("scheduled");
    expect(result.proposals[6].participants[0].canonicalId).toBeNull();
    expect(result.proposals[7].state).toBe("pending_evidence");
    expect(result.proposals[7].reasons).toContain("semantic_qualifier_unverified");
  }, 30000);
});
