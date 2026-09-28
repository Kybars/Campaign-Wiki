import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext } from "../lib/ai/extraction-context";
import { CLAIMS_2_BEHAVIOR_VERSION, claims2CheckpointIdentity, planTest9Claims2Requests, serializeClaims2Request, validateAndUnionClaims2 } from "../lib/ai/claims-2-experiment";

const names = ["Drakus", "Turinn", "Sindaire", "Magdus", "Ostalin"];
const inventory: GraphInventory = { entities: names.map((name, index) => ({ temporary_id: String(index), name, type: "other", aliases: [], sources: [] })) };
const pages = [10, 11, 12, 13, 14].map((pageNumber) => ({ pageNumber, text: pageNumber === 14
  ? "The armies gather.\nWhat If They Do Nothing?\nMagdus takes his army to Turinn, capital of Sindaire. He defeats Ostalin there."
  : "Drakus was rumored to be immortal. Turinn is the capital of Sindaire. Magdus and Ostalin fought." }));
const context = buildExtractionContext(pages, inventory);
const requests = planTest9Claims2Requests(context);
const one = requests[0];
const two = requests[1];
const output = (claims: Array<{ statement: string; entities: string[]; evidence_units: string[] }>) => ({ claims });
const empty = { requestId: two.requestId, output: output([]) };

describe("isolated Claims-2 evidence", () => {
  it("splits sentences with stable raw offsets and inherits hypothetical context after the heading", () => {
    const first = one.evidenceUnits[0];
    expect(first.text).toBe("Drakus was rumored to be immortal.");
    expect(pages[0].text.slice(first.rawSource.start, first.rawSource.end)).toBe(first.rawSource.text);
    expect(first.unitId).toBe(planTest9Claims2Requests(context)[0].evidenceUnits[0].unitId);
    const heading = two.evidenceUnits.find((unit) => unit.text === "What If They Do Nothing?")!;
    expect(heading.kind).toBe("heading");
    expect(two.evidenceUnits.find((unit) => unit.text.startsWith("Magdus takes"))?.context).toBe("what_if_they_do_nothing");
    expect(serializeClaims2Request(two).source).toContain("SOURCE CONTEXT: what_if_they_do_nothing");
  });

  it("accepts one unit and two adjacent units with exact provenance and rejects boundary failures", () => {
    const evidence = one.evidenceUnits.filter((unit) => unit.page === 10 && unit.kind === "sentence");
    const a = evidence[0].unitId, b = evidence[1].unitId, c = evidence[2].unitId;
    const result = validateAndUnionClaims2([{ requestId: one.requestId, output: output([
      { statement: "Drakus was rumored immortal.", entities: ["Drakus"], evidence_units: [a] },
      { statement: "Turinn is Sindaire's capital.", entities: ["Turinn", "Sindaire"], evidence_units: [a, b] },
      { statement: "Invalid", entities: ["Drakus"], evidence_units: [a, c] },
      { statement: "Invalid", entities: ["Drakus"], evidence_units: ["missing"] },
      { statement: "Invalid", entities: ["Drakus"], evidence_units: [a, a] },
    ]) }, empty], requests);
    expect(result.claims).toHaveLength(2);
    expect(result.claims[1].provenance[0].unitIds).toEqual([a, b]);
    expect([result.invalidUnits, result.nonadjacentUnits]).toEqual([2, 1]);
  });

  it("rejects heading and cross-context citations, and keeps context in dedupe identity", () => {
    const heading = two.evidenceUnits.find((unit) => unit.kind === "heading" && unit.text === "What If They Do Nothing?")!;
    const before = two.evidenceUnits[heading.order - 1];
    const after = two.evidenceUnits[heading.order + 1];
    const result = validateAndUnionClaims2([{ requestId: one.requestId, output: output([]) }, { requestId: two.requestId, output: output([
      { statement: "Invalid", entities: ["Magdus"], evidence_units: [heading.unitId] },
      { statement: "Invalid", entities: ["Magdus"], evidence_units: [before.unitId, after.unitId] },
      { statement: "Magdus travels to Turinn.", entities: ["Magdus", "Turinn"], evidence_units: [after.unitId] },
    ]) }], requests);
    expect(result.headingCitations).toBe(1);
    expect(result.crossContextUnits).toBe(1);
    expect(result.claims[0].context).toBe("what_if_they_do_nothing");
  });

  it("uses an independent behavior and schema identity", () => {
    const identity = claims2CheckpointIdentity({ request: one, fixtureHash: "fixture", contextFingerprint: "context", modelId: "gpt-6-luna" });
    expect(identity.behaviorVersion).toBe(CLAIMS_2_BEHAVIOR_VERSION);
    expect(identity.schemaVersion).toBe(2);
    expect(identity.operationType).toBe("claims_2_experiment");
  });
});
