export const CLAIMS4_AUTHORIZATION_VARIABLE = "ALLOW_PAID_CLAIMS4_V1_LUNA";
export function authorizeClaims4Live(args: { live: boolean; authorization: string | undefined; allowedRequestIds: string[];
  maxCalls: number; plannedRequestIds: string[]; existingAttempts: Array<{ requestId: string; state: "dispatching" | "completed" | "failed" }> }) {
  if (!args.live || args.authorization !== "1") throw new Error("Fresh Claims-4 paid authorization and --live-luna are required");
  if (!Number.isSafeInteger(args.maxCalls) || args.maxCalls < 1 || args.maxCalls > 4) throw new Error("Claims-4 requires a hard call cap of 1 to 4");
  if (args.plannedRequestIds.length !== 4 || new Set(args.plannedRequestIds).size !== 4) throw new Error("Exactly four frozen requests required");
  const allowed = new Set(args.allowedRequestIds);
  if (!allowed.size || allowed.size !== args.allowedRequestIds.length || [...allowed].some((id) => !args.plannedRequestIds.includes(id))) throw new Error("Claims-4 requires an exact request allowlist");
  if (args.existingAttempts.some((attempt) => attempt.state !== "completed")) throw new Error("Failed or uncertain Claims-4 dispatch requires manual review");
  if (new Set(args.existingAttempts.map((attempt) => attempt.requestId)).size !== args.existingAttempts.length ||
      args.existingAttempts.some((attempt) => !args.plannedRequestIds.includes(attempt.requestId))) throw new Error("Unknown or duplicate Claims-4 attempt");
  const pending = args.allowedRequestIds.filter((id) => !args.existingAttempts.some((attempt) => attempt.requestId === id));
  if (args.existingAttempts.length + pending.length > args.maxCalls) throw new Error("Claims-4 hard call cap exceeded");
  return pending;
}
export function requireClaims4SystemCA(execArgv: string[] = process.execArgv) {
  if (!execArgv.includes("--use-system-ca")) throw new Error("Claims-4 live dispatch requires Node --use-system-ca");
}
