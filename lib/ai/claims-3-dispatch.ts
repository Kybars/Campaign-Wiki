/** Pure authorization gate. Offline callers do not import a model client. */
export function authorizeClaims3Live(args: { live: boolean; authorization: string | undefined; allowedRequestIds: string[]; maxCalls: number; plannedRequestIds: string[]; existingAttempts: Array<{ requestId: string; state: "dispatching" | "completed" | "failed" }> }) {
  if (!args.live || args.authorization !== "1") throw new Error("Fresh Claims-3 authorization and --live-luna are both required");
  if (!Number.isSafeInteger(args.maxCalls) || args.maxCalls < 1 || args.maxCalls > 4) throw new Error("Claims-3 requires an explicit hard call budget from 1 to 4");
  const allowed = new Set(args.allowedRequestIds);
  if (!allowed.size || allowed.size !== args.allowedRequestIds.length || [...allowed].some((id) => !args.plannedRequestIds.includes(id))) throw new Error("Claims-3 requires an exact planned request allowlist");
  if (args.existingAttempts.some((attempt) => attempt.state !== "completed")) throw new Error("Failed or uncertain Claims-3 dispatch requires manual review; no automatic retry");
  if (new Set(args.existingAttempts.map((attempt) => attempt.requestId)).size !== args.existingAttempts.length ||
      args.existingAttempts.some((attempt) => !args.plannedRequestIds.includes(attempt.requestId))) throw new Error("Unknown or duplicate Claims-3 attempt");
  const pending = args.allowedRequestIds.filter((id) => !args.existingAttempts.some((attempt) => attempt.requestId === id));
  if (args.existingAttempts.length + pending.length > args.maxCalls) throw new Error("Claims-3 hard call budget exceeded");
  return pending;
}
