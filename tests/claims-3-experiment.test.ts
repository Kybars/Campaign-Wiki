import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorizeClaims3Live } from "../lib/ai/claims-3-dispatch";
import { claims3CheckpointIdentity, claims3OutputSchema, cleanSectionHeading, HEROES_ID, planClaims3Request, serializeClaims3Request, validateAndUnionClaims3 } from "../lib/ai/claims-3-experiment";
import { claims3Preflight, loadFrozenClaims3Benchmarks } from "../lib/ai/claims-3-benchmarks";
import type { Claims2Request, EvidenceUnit } from "../lib/ai/claims-2-experiment";

const raw = ["Drakus is immortal thanks to the Torch.", "Drakus is immortal thanks to the Torch.", "Drakus can die if the Torch is destroyed.",
  "If the Heroes do nothing, Turinn falls.", "Other chroniclers say Drakus is mortal.", "The Heroes encounter an unknown warden.",
  "A political party met Drakus.", "S1. Rotted Pantry"];
const units: EvidenceUnit[] = raw.map((text, index) => ({ unitId: `p10.u${index + 1}`, segmentId: "p10", page: 10,
  kind: index === 7 ? "heading" : "sentence", text, context: index === 3 ? "what_if_they_do_nothing" : index === 7 ? "[S1] Rotted Pantry" : "main", order: index,
  rawSource: { page: 10, start: index * 100, end: index * 100 + text.length, text } }));
const base: Claims2Request = { requestId: "test9-claims2-1", evidenceUnits: units,
  entities: [{ canonicalId: "drakus", name: "Drakus", type: "npc", aliases: [] }, { canonicalId: "torch", name: "Torch", type: "item", aliases: [] },
    { canonicalId: "turinn", name: "Turinn", type: "location", aliases: [] }] };
const request = planClaims3Request(base);
const candidate = (statement: string, entities: string[], index: number, page = 10) => ({ statement, entities, evidence: [{ unit_id: units[index].unitId, page }] });
const run = (claims: ReturnType<typeof candidate>[]) => validateAndUnionClaims3([{ requestId: request.requestId, output: { claims } }], [request]);

describe("isolated Claims-3 contract", () => {
  it("parses strict claims and validates physical page, unit, and heading citations", () => {
    expect(claims3OutputSchema.parse({ claims: [candidate("Drakus is immortal thanks to the Torch.", ["Drakus", "Torch"], 0)] }).claims).toHaveLength(1);
    expect(() => claims3OutputSchema.parse({ claims: [{ ...candidate("x", ["Drakus"], 0), target: "Torch" }] })).toThrow();
    const result = run([candidate("Wrong page", ["Drakus"], 0, 11), candidate("Heading", ["Drakus"], 7),
      { statement: "Missing", entities: ["Drakus"], evidence: [{ unit_id: "missing", page: 10 }] }]);
    expect([result.invalidPages, result.headingCitations, result.invalidUnits, result.claims.length]).toEqual([1, 1, 1, 0]);
  });

  it("retains causes, qualifications, multi-entity links, contradictions, and evidence union", () => {
    const result = run([
      candidate("Drakus is immortal thanks to the Torch.", ["Drakus"], 0),
      candidate("Drakus is immortal thanks to the Torch.", ["Torch"], 1),
      candidate("Drakus is immortal.", ["Drakus"], 0),
      candidate("Drakus can die if the Torch is destroyed.", ["Drakus", "Torch"], 2),
      candidate("Other chroniclers say Drakus is mortal.", ["Drakus"], 4),
    ]);
    expect(result.claims).toHaveLength(3);
    expect(result.claims[0].entityIds).toEqual(["drakus", "torch"]);
    expect(result.claims[0].provenance).toHaveLength(2);
    expect(result.omittedNamedCauses).toBe(1);
    expect(result.claims[1].statement).toContain("can die");
    expect(result.claims[2].statement).toContain("mortal");
  });

  it("preserves inventory misses and the one permanent Heroes identity", () => {
    const result = run([candidate("The Heroes encounter an unknown warden.", ["Heroes", "Unknown Warden"], 5)]);
    expect(result.claims[0].entityIds).toEqual([HEROES_ID]);
    expect(result.claims[0].unresolvedEntities).toEqual(["Unknown Warden"]);
    expect(result.unresolvedCandidates).toBe(1);
    expect(result.possibleRescueTargets).toEqual(["Unknown Warden"]);
    expect(request.entities.filter((entity) => entity.canonicalId === HEROES_ID)).toHaveLength(1);
    expect(planClaims3Request({ ...base, evidenceUnits: [units[0]] }).entities.some((entity) => entity.canonicalId === HEROES_ID)).toBe(true);
    expect(run([candidate("A political party met Drakus.", ["Party", "Drakus"], 6)]).claims[0].unresolvedEntities).toEqual(["Party"]);
  });

  it("does not turn conditional source text into a played event", () => {
    const result = run([candidate("Turinn fell.", ["Turinn"], 3), candidate("If the Heroes do nothing, Turinn would fall.", ["Heroes", "Turinn"], 3)]);
    expect(result.conditionalRejections).toBe(1);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].entityIds).toContain(HEROES_ID);
  });

  it("cleans only confident section headings and keeps raw ordering", () => {
    expect(cleanSectionHeading("[S1] Rotted Pantry")).toBe("Rotted Pantry");
    expect(cleanSectionHeading("S2. The Room of Sorrow")).toBe("The Room of Sorrow");
    expect(cleanSectionHeading("S3. ???")).toBeUndefined();
    const serialized = serializeClaims3Request(planClaims3Request({ ...base, evidenceUnits: [units[7]] }));
    expect(serialized.source).toContain("SOURCE CONTEXT: Rotted Pantry");
    expect(serialized.source).toContain("HEADING:");
    expect(request.evidenceUnits[0].rawSource.start).toBe(0);
  });

  it("uses a separate behavior, schema, input and operation identity", () => {
    const identity = claims3CheckpointIdentity({ request, fixtureHash: "f", sourceHash: "s", inventoryHash: "i", manifestHash: "m", modelId: "gpt-6-luna" });
    expect(identity.operationType).toBe("claims_3_experiment");
    expect(identity.schemaVersion).toBe(1);
    expect(identity.operationKey).toBe("test9-claims3-1");
  });
});

describe("Claims-3 offline dispatch gate", () => {
  const args = { live: true, authorization: "1", allowedRequestIds: ["a"], maxCalls: 1, plannedRequestIds: ["a", "b"], existingAttempts: [] };
  it("requires fresh Claims-3 authorization, explicit live mode and allowlist", () => {
    expect(() => authorizeClaims3Live({ ...args, live: false })).toThrow();
    expect(() => authorizeClaims3Live({ ...args, authorization: undefined })).toThrow();
    expect(() => authorizeClaims3Live({ ...args, allowedRequestIds: [] })).toThrow();
    expect(() => authorizeClaims3Live({ ...args, allowedRequestIds: ["not-planned"] })).toThrow();
    expect(() => authorizeClaims3Live({ ...args, maxCalls: 0 })).toThrow();
    expect(authorizeClaims3Live(args)).toEqual(["a"]);
  });
  it("blocks failed, uncertain, duplicate and over-budget dispatches", () => {
    expect(() => authorizeClaims3Live({ ...args, existingAttempts: [{ requestId: "a", state: "dispatching" }] })).toThrow();
    expect(() => authorizeClaims3Live({ ...args, existingAttempts: [{ requestId: "a", state: "failed" }] })).toThrow();
    expect(() => authorizeClaims3Live({ ...args, allowedRequestIds: ["a", "b"] })).toThrow();
    expect(() => authorizeClaims3Live({ ...args, existingAttempts: [{ requestId: "a", state: "completed" }, { requestId: "a", state: "completed" }] })).toThrow();
  });
});

const privateFixturePresent = existsSync(join(process.cwd(), "fixtures/private/test9-focused-ab/fixture.json")) &&
  existsSync(join(process.cwd(), "fixtures/private/test10-sweetwater-v1/result.v3.json")) &&
  existsSync(join(process.cwd(), "fixtures/private/test11-tales-claims2-v1/result.v1.json"));
describe.skipIf(!privateFixturePresent)("local private frozen benchmark verification", () => {
  it("reconstructs exactly four completed Claims-2 request windows", async () => {
    const benchmarks = await loadFrozenClaims3Benchmarks();
    expect(benchmarks.map((benchmark) => benchmark.baselinePages)).toEqual([[[10, 11, 12], [13, 14]], [[6, 7, 8, 9, 10, 11, 12, 13]], [[27, 28, 29, 30]]]);
    expect(benchmarks.flatMap((benchmark) => benchmark.baselineRequestIds)).toEqual(["test9-claims2-1", "test9-claims2-2", "test10-sweetwater-claims2-v3-1", "test11-tales-claims2-v1-1"]);
    expect(benchmarks.every((benchmark) => benchmark.baselineComplete)).toBe(true);
    expect(claims3Preflight(benchmarks).plannedCalls).toBe(4);
    const sweetwater = benchmarks[1].requests[0];
    expect(sweetwater.evidenceUnits.find((unit) => unit.page === 11 && unit.text === "Mold.")?.context).toBe("[S1] Rotted Pantry");
    expect(sweetwater.evidenceUnits.find((unit) => unit.page === 12 && unit.text.startsWith("The altar is on a ledge"))?.context).toBe("[S3] The Crypts");
    expect(sweetwater.evidenceUnits.find((unit) => unit.page === 12 && unit.text.startsWith("The treasure includes"))?.context).toBe("[S5] Treasure Room");
  }, 30000);
});
