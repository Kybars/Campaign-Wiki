import { describe, expect, it } from "vitest";
import { evaluateClaimsSlice } from "../lib/ai/claims-slice-evaluation";
import { buildClaimsEvidenceUnits, documentClaimsRequest } from "../lib/ai/claims-document-source";
import { annotateSourceStructure } from "../lib/ai/claims-source-structure";

describe("future saved-output slice evaluation", () => {
  const pages = [{ pageNumber: 1, text: "# Journey\n\n## Day 1\n\nThe guards arrive.\n\n## Rumors\n\nPeople say the gate is haunted." }];
  const request = documentClaimsRequest(annotateSourceStructure(buildClaimsEvidenceUnits(pages)).units, { entities: [] }, "saved-synthetic");
  it("compares source units with new proposals and scheduled context without count targets", () => {
    const unit = request.evidenceUnits.find(u => u.text === "The guards arrive.")!;
    const result = evaluateClaimsSlice(request, { claims: [{ statement: unit.text, participants: [], evidence_unit_ids: [unit.unitId] }] }, pages, []);
    expect(result.invalidSourceUnits).toEqual([]);
    expect(result.contextChecks).toEqual(expect.arrayContaining([expect.objectContaining({ expected: "scheduled", actual: "scheduled", matches: true })]));
    expect(result.sourceComparison.find(s => s.unitId === unit.unitId)?.proposedClaimIndexes).toEqual([0]);
    expect(result.humanReviewRequired).toContain("no invented lore");
    expect(result.modelCalls).toBe(0); expect(result.apiCalls).toBe(0);
  });
  it("flags heading evidence, unknown IDs, furniture claims and raw provenance mismatch", () => {
    const heading = request.evidenceUnits.find(u => u.kind === "heading")!;
    const bad = evaluateClaimsSlice(request, { claims: [{ statement: "Campaign guide is an entity.", participants: [], evidence_unit_ids: [heading.unitId, "missing"] }] }, [{ pageNumber: 1, text: "changed" }], ["campaign guide"]);
    expect(bad.invalidSourceUnits.length).toBeGreaterThan(0);
    expect(bad.flags[0].problems).toEqual(["unknown_evidence", "heading_as_direct_evidence", "possible_furniture_claim"]);
  });
});
