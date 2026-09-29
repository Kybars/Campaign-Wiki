import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExperimentResponseDiagnostics } from "@/lib/ai/experiment-response";

export const CLAIMS3_RECOVERY_VERSION = 1;
export const CLAIMS3_FAILED_CHECKPOINT_SHA256 = "6ab9140003a4255841da06673eae6ee142af703e0338689c9c8ab0d0aee91029";
export const CLAIMS3_FAILED_REQUEST_ID = "test9-claims3-1";
export const claims3AuthorizationVariable = (recovery: boolean) => recovery ? "ALLOW_PAID_CLAIMS3_RECOVERY_V1_LUNA" : "ALLOW_PAID_CLAIMS3_LUNA";

export interface Claims3RecoveryLineage {
  recoveryVersion: number;
  sourceCheckpoint: "fixtures/private/claims3-v1/progress.v1.json";
  sourceCheckpointSha256: string;
  priorAttempt: { requestId: string; state: "failed"; usage: "unknown"; error: string; identity: unknown };
}
export interface Claims3AttemptRecord {
  requestId: string;
  identity: unknown;
  state: "dispatching" | "completed" | "failed";
  diagnostics: ExperimentResponseDiagnostics;
  output?: unknown;
  error?: string;
}
export interface Claims3RecoveryProgress { recoveryOf: Claims3RecoveryLineage; attempts: Claims3AttemptRecord[] }

const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

export function claims3RecoveryLineage(originalBytes: Uint8Array, expectedIdentity: unknown, expectedHash = CLAIMS3_FAILED_CHECKPOINT_SHA256): Claims3RecoveryLineage {
  const actualHash = sha256(originalBytes);
  if (actualHash !== expectedHash) throw new Error("Original failed Claims-3 checkpoint hash changed; recovery is blocked");
  const original = JSON.parse(Buffer.from(originalBytes).toString("utf8")) as { attempts?: Claims3AttemptRecord[] };
  if (!Array.isArray(original.attempts) || original.attempts.length !== 1) throw new Error("Expected exactly one original Claims-3 attempt");
  const prior = original.attempts[0];
  if (prior.requestId !== CLAIMS3_FAILED_REQUEST_ID || prior.state !== "failed" || prior.diagnostics?.usage !== "unknown" ||
      prior.output !== undefined || prior.error !== "Connection error." || JSON.stringify(prior.identity) !== JSON.stringify(expectedIdentity)) {
    throw new Error("Original failed Claims-3 attempt differs from reviewed recovery source");
  }
  return { recoveryVersion: CLAIMS3_RECOVERY_VERSION, sourceCheckpoint: "fixtures/private/claims3-v1/progress.v1.json", sourceCheckpointSha256: actualHash,
    priorAttempt: { requestId: prior.requestId, state: "failed", usage: "unknown", error: prior.error, identity: prior.identity } };
}

export function readClaims3RecoveryProgress(path: string, lineage: Claims3RecoveryLineage): Claims3RecoveryProgress {
  if (!existsSync(path)) return { recoveryOf: lineage, attempts: [] };
  const value = JSON.parse(readFileSync(path, "utf8")) as Claims3RecoveryProgress;
  if (JSON.stringify(value.recoveryOf) !== JSON.stringify(lineage) || !Array.isArray(value.attempts)) throw new Error("Claims-3 recovery checkpoint lineage changed");
  return value;
}

export function saveClaims3RecoveryAttempt(path: string, progress: Claims3RecoveryProgress, attempt: Claims3AttemptRecord) {
  if (attempt.state !== "dispatching" || progress.attempts.some((item) => item.requestId === attempt.requestId)) throw new Error("Claims-3 recovery attempt was already recorded");
  const next: Claims3RecoveryProgress = { recoveryOf: progress.recoveryOf, attempts: [...progress.attempts, attempt] };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporary, path);
  return next;
}

export function requireClaims3SystemCA(execArgv: string[] = process.execArgv) {
  if (!execArgv.includes("--use-system-ca")) throw new Error("Claims-3 live dispatch requires Node --use-system-ca");
}

export function requireClaims3RecoveryFirst(attempts: Array<{ requestId: string; state: "dispatching" | "completed" | "failed" }>, pendingRequestIds: string[]) {
  if (!attempts.some((attempt) => attempt.requestId === CLAIMS3_FAILED_REQUEST_ID && attempt.state === "completed") &&
      pendingRequestIds[0] !== CLAIMS3_FAILED_REQUEST_ID) throw new Error("Recover test9-claims3-1 before dispatching untouched Claims-3 requests");
}
