import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext } from "../lib/ai/extraction-context";
import { planTest9Claims2Requests, validateAndUnionClaims2 } from "../lib/ai/claims-2-experiment";
import { completenessCheckpointIdentity, planCompletenessRequests, reviewCompletenessCandidates, serializeCompletenessRequest } from "../lib/ai/claims-2-completeness";
import { assertKnownUsage, parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics } from "../lib/ai/experiment-response";

const inventory: GraphInventory = { entities: ["Drakus", "Turinn", "Sindaire"].map((name, index) => ({ temporary_id: String(index), name, type: "other", aliases: [], sources: [] })) };
const context = buildExtractionContext([10, 11, 12, 13, 14].map((pageNumber) => ({ pageNumber, text: "Drakus was rumored immortal. Turinn is the capital of Sindaire." })), inventory);
const base = planTest9Claims2Requests(context);
const prior = validateAndUnionClaims2([{ requestId: base[0].requestId, output: { claims: [
  { statement: "Drakus was rumored immortal.", entities: ["Drakus"], evidence_units: [base[0].evidenceUnits[0].unitId] },
] } }, { requestId: base[1].requestId, output: { claims: [] } }], base).claims;
const requests = planCompletenessRequests(base, prior);
const ids = requests.map((request) => request.requestId);
const config = parseExperimentBudgetConfig({ totalTokenBudget: 15_000, inputReserveMultiplier: 1.2, sdkMaxRetries: 0,
  requests: Object.fromEntries(ids.map((id) => [id, { maxOutputTokens: 3_000 }])) }, ids);

describe("Claims-2 completeness safeguards", () => {
  it("reserves actual usage plus conservative input, per-call output, and retry allowance before dispatch", () => {
    const first = reserveExperimentRequest(config, ids[0], 4_000, 0);
    expect(first.reservedInputTokens).toBe(4_800);
    expect(first.reservedTokens).toBe(7_800);
    expect(reserveExperimentRequest(config, ids[1], 4_000, 8_000).fits).toBe(false);
    const retryConfig = { ...config, sdkMaxRetries: 2 };
    expect(reserveExperimentRequest(retryConfig, ids[0], 4_000, 0).reservedTokens).toBe(23_400);
    const staged = parseExperimentBudgetConfig({ ...config, stageBudgets: { completeness: 7_000 }, requests: Object.fromEntries(ids.map((id) => [id, { maxOutputTokens: 3_000, stage: "completeness" }])) }, ids);
    expect(reserveExperimentRequest(staged, ids[0], 4_000, 0, 0).fits).toBe(false);
    expect(() => parseExperimentBudgetConfig({ ...config, requests: {} }, ids)).toThrow();
  });

  it("resumes completed requests and blocks uncertain or failed dispatches", () => {
    expect(pendingExperimentRequests(ids, [{ requestId: ids[0], state: "completed" }])).toEqual([ids[1]]);
    expect(() => pendingExperimentRequests(ids, [{ requestId: ids[0], state: "dispatching" }])).toThrow();
    expect(() => pendingExperimentRequests(ids, [{ requestId: ids[0], state: "failed" }])).toThrow();
    expect(() => pendingExperimentRequests(ids, [{ requestId: ids[0], state: "completed" }, { requestId: ids[0], state: "completed" }])).toThrow();
    expect(assertKnownUsage({ inputTokens: 4, outputTokens: 5, totalTokens: 9 })).toBe(9);
    expect(() => assertKnownUsage({ inputTokens: 4, outputTokens: null, totalTokens: 9 })).toThrow();
  });

  it("records available response metadata and leaves absent diagnostics unknown", () => {
    const usage = { model: "gpt-6-luna", responseId: "response", inputTokens: 2, outputTokens: 3, totalTokens: 5,
      cachedInputTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: null };
    const captured = captureExperimentResponseDiagnostics({ id: "response", status: "completed", incomplete_details: null, output: [{ status: "completed" }] }, usage, 3_000, 0);
    expect(captured).toMatchObject({ responseId: "response", status: "completed", incompleteDetails: null, outputItemStatuses: ["completed"], configuredMaxOutputTokens: 3_000, configuredSdkMaxRetries: 0 });
    expect(captureExperimentResponseDiagnostics({}, usage, 3_000, 0).incompleteDetails).toBe("unknown");
    expect(unknownExperimentDiagnostics(3_000, 0).usage).toBe("unknown");
  });

  it("supplies complete saved coverage and reviews every candidate without silently discarding overlap", () => {
    expect(requests.map((request) => request.existingClaims.length)).toEqual([1, 0]);
    expect(serializeCompletenessRequest(requests[0]).coverage).toContain(prior[0].statement);
    expect(serializeCompletenessRequest(requests[0]).coverage).toContain(base[0].evidenceUnits[0].unitId);
    const review = reviewCompletenessCandidates(requests[0], { claims: [
      { statement: prior[0].statement, entities: ["Drakus"], evidence_units: [base[0].evidenceUnits[0].unitId] },
      { statement: "Turinn is Sindaire's capital.", entities: ["Turinn", "Sindaire"], evidence_units: [base[0].evidenceUnits[1].unitId] },
      { statement: "Invalid", entities: ["Drakus"], evidence_units: ["missing"] },
    ] });
    expect(review).toHaveLength(3);
    expect(review[0].exactNormalizedDuplicates).toEqual([1]);
    expect(review[0].potentialOverlap.sharedEvidenceClaimNumbers).toEqual([1]);
    expect(review[1].citedEvidence[0].source?.text).toContain("Turinn");
    expect(review[2].structuralRejectionReason).toBe("invalidUnits");
    const identity = completenessCheckpointIdentity({ request: requests[0], fixtureHash: "fixture", contextFingerprint: "context", baselineFingerprint: "baseline", modelId: "gpt-6-luna", maxOutputTokens: 3_000, sdkMaxRetries: 0 });
    expect(identity.behaviorVersion).toBe("v0.6.7-claims-2-completeness-1");
    expect(identity.inputHash).not.toBe(completenessCheckpointIdentity({ request: requests[0], fixtureHash: "fixture", contextFingerprint: "context", baselineFingerprint: "baseline", modelId: "gpt-6-luna", maxOutputTokens: 4_000, sdkMaxRetries: 0 }).inputHash);
  });
});
