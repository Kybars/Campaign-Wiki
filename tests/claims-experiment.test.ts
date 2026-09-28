import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext } from "../lib/ai/extraction-context";
import { claimCheckpointIdentity, planTest9ClaimRequests, validateAndUnionClaims } from "../lib/ai/claims-experiment";

const names = ["Drakus", "Torch of the Burning Sky", "Ragesian Army", "Gate Pass", "The Scourge"];
const inventory: GraphInventory = { entities: names.map((name, index) => ({ temporary_id: String(index), name, type: "other", aliases: index === 0 ? ["Lord Drakus"] : [], sources: [] })) };
const context = buildExtractionContext([10, 11, 12, 13, 14].map((pageNumber) => ({ pageNumber, text: "Drakus used the Torch of the Burning Sky to move the Ragesian Army to Gate Pass. The Scourge followed." })), inventory);
const requests = planTest9ClaimRequests(context);
const output = (claims: Array<{ statement: string; entities: string[]; page: number; evidence_segment: string }>) => ({ claims });
const row = (entities: string[], page = 10, statement = "Drakus moved the army.") => ({ statement, entities, page, evidence_segment: `${page}a` });

describe("isolated Claims experiment", () => {
  it("retains one, two, and four participant claims with canonical names and raw provenance", () => {
    const result = validateAndUnionClaims([{ requestId: requests[0].requestId, output: output([
      row(["Lord Drakus"]), row(["Drakus", "Gate Pass"], 11),
      row(["Drakus", "Torch of the Burning Sky", "Ragesian Army", "Gate Pass"], 12, "Drakus used the Torch of the Burning Sky to move the Ragesian Army to Gate Pass."),
    ]) }, { requestId: requests[1].requestId, output: output([]) }], requests);
    expect(result.claims.map((claim) => claim.entities.length)).toEqual([1, 2, 4]);
    expect(result.claims[0].entities).toEqual(["Drakus"]);
    expect(result.claims[2].provenance[0].text).toContain("Torch of the Burning Sky");
  });

  it("normalizes unique leading The and rejects unknown, ambiguous, duplicate participants and invalid provenance", () => {
    const ambiguous = { ...requests[0], entities: [...requests[0].entities, { canonicalId: "other", name: "Other", type: "Other", aliases: ["Lord Drakus"] }] };
    const result = validateAndUnionClaims([{ requestId: ambiguous.requestId, output: output([
      row(["Scourge"]), row(["Unknown"]), row(["Lord Drakus"]), row(["Drakus", "Drakus"]),
      { ...row(["Drakus"]), evidence_segment: "missing" }, { ...row(["Drakus"]), page: 14 },
    ]) }, { requestId: requests[1].requestId, output: output([]) }], [ambiguous, requests[1]]);
    expect(result.claims[0].entities).toEqual(["The Scourge"]);
    expect([result.unknownParticipants, result.ambiguousParticipants, result.duplicateParticipants, result.invalidSegments, result.invalidPageSegments]).toEqual([1, 1, 1, 1, 1]);
  });

  it("dedupes only normalized exact statements and participant sets across chunks", () => {
    const result = validateAndUnionClaims([{ requestId: requests[0].requestId, output: output([row(["Drakus", "Gate Pass"])]) },
      { requestId: requests[1].requestId, output: output([row(["Gate Pass", "Drakus"], 13, "drakus   moved the army.")]) }], requests);
    expect(result.duplicates).toBe(1);
    expect(result.claims[0].provenance).toHaveLength(2);
  });

  it("keys checkpoints to model and behavior version", () => {
    const args = { request: requests[0], fixtureHash: "fixture", contextFingerprint: "context", modelId: "gpt-6-luna" };
    const first = claimCheckpointIdentity(args);
    expect(first.behaviorVersion).toBe("v0.6.7-claims-1");
    expect(first.modelId).toBe("gpt-6-luna");
    expect(claimCheckpointIdentity({ ...args, modelId: "other" }).modelId).not.toBe(first.modelId);
  });
});
