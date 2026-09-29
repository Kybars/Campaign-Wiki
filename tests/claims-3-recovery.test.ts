import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorizeClaims3Live } from "../lib/ai/claims-3-dispatch";
import { claims3AuthorizationVariable, claims3RecoveryLineage, readClaims3RecoveryProgress, requireClaims3RecoveryFirst, requireClaims3SystemCA, saveClaims3RecoveryAttempt } from "../lib/ai/claims-3-recovery";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const identity = { operationKey: "test9-claims3-1", inputHash: "frozen" };
const failed = { requestId: "test9-claims3-1", identity, state: "failed" as const, diagnostics: { usage: "unknown" as const }, error: "Connection error." };
const plannedRequestIds = ["test9-claims3-1", "test9-claims3-2", "test10-sweetwater-claims3-v3-1", "test11-tales-claims3-v1-1"];

describe("Claims-3 versioned recovery", () => {
  it("keeps ordinary resume blocked and requires a distinct recovery authorization", () => {
    expect(() => authorizeClaims3Live({ live: true, authorization: "1", allowedRequestIds: [failed.requestId], maxCalls: 4,
      plannedRequestIds, existingAttempts: [failed] })).toThrow(/no automatic retry/);
    expect(claims3AuthorizationVariable(false)).toBe("ALLOW_PAID_CLAIMS3_LUNA");
    expect(claims3AuthorizationVariable(true)).toBe("ALLOW_PAID_CLAIMS3_RECOVERY_V1_LUNA");
    expect(claims3AuthorizationVariable(true)).not.toBe(claims3AuthorizationVariable(false));
    expect(() => authorizeClaims3Live({ live: true, authorization: undefined, allowedRequestIds: [failed.requestId], maxCalls: 4,
      plannedRequestIds, existingAttempts: [] })).toThrow(/authorization/);
  });

  it("records the original failure in a separate recovery attempt without changing it", () => {
    const root = mkdtempSync(join(tmpdir(), "claims3-recovery-test-"));
    try {
      const originalPath = join(root, "original.json");
      const recoveryPath = join(root, "recovery", "progress.v1.json");
      const originalBytes = Buffer.from(`${JSON.stringify({ attempts: [failed] }, null, 2)}\n`);
      writeFileSync(originalPath, originalBytes);
      const originalHash = digest(readFileSync(originalPath));
      const lineage = claims3RecoveryLineage(readFileSync(originalPath), identity, originalHash);
      expect(lineage).toMatchObject({ sourceCheckpointSha256: originalHash,
        priorAttempt: { requestId: failed.requestId, state: "failed", usage: "unknown", error: "Connection error." } });
      const progress = readClaims3RecoveryProgress(recoveryPath, lineage);
      const dispatching = { requestId: failed.requestId, identity, state: "dispatching" as const,
        diagnostics: { responseId: "unknown" as const, status: "unknown", incompleteDetails: "unknown",
          outputItemStatuses: "unknown" as const, finishReason: "unknown", usage: "unknown" as const,
          configuredMaxOutputTokens: 9000, configuredSdkMaxRetries: 0 } };
      saveClaims3RecoveryAttempt(recoveryPath, progress, dispatching);
      const saved = readClaims3RecoveryProgress(recoveryPath, lineage);
      expect(saved.attempts).toEqual([dispatching]);
      expect(digest(readFileSync(originalPath))).toBe(originalHash);
      expect(() => saveClaims3RecoveryAttempt(recoveryPath, saved, dispatching)).toThrow(/already recorded/);
      expect(() => authorizeClaims3Live({ live: true, authorization: "1", allowedRequestIds: [failed.requestId], maxCalls: 4,
        plannedRequestIds, existingAttempts: saved.attempts })).toThrow(/no automatic retry/);
      expect(() => claims3RecoveryLineage(readFileSync(originalPath), identity, "wrong")).toThrow(/hash changed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("counts every new attempt and permits untouched requests only after a completed recovery", () => {
    const recovered = { requestId: failed.requestId, state: "completed" as const };
    expect(() => requireClaims3RecoveryFirst([], plannedRequestIds.slice(1))).toThrow(/Recover test9/);
    expect(() => requireClaims3RecoveryFirst([], plannedRequestIds)).not.toThrow();
    expect(() => requireClaims3RecoveryFirst([recovered], plannedRequestIds.slice(1))).not.toThrow();
    expect(authorizeClaims3Live({ live: true, authorization: "1", allowedRequestIds: plannedRequestIds.slice(1), maxCalls: 4,
      plannedRequestIds, existingAttempts: [recovered] })).toEqual(plannedRequestIds.slice(1));
    expect(() => authorizeClaims3Live({ live: true, authorization: "1", allowedRequestIds: plannedRequestIds.slice(1), maxCalls: 3,
      plannedRequestIds, existingAttempts: [recovered] })).toThrow(/hard call budget/);
    expect(() => authorizeClaims3Live({ live: true, authorization: "1", allowedRequestIds: plannedRequestIds.slice(1), maxCalls: 4,
      plannedRequestIds, existingAttempts: [failed] })).toThrow(/no automatic retry/);
  });

  it("requires the actual Node process to have system CA enabled", () => {
    expect(() => requireClaims3SystemCA(["--conditions=react-server"])).toThrow(/--use-system-ca/);
    expect(() => requireClaims3SystemCA(["--use-system-ca", "--conditions=react-server"])).not.toThrow();
  });
});
