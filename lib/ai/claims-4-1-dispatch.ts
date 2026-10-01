export const CLAIMS41_AUTHORIZATION_VARIABLE = "ALLOW_PAID_CLAIMS41_WOTBS_LUNA";
export const CLAIMS41_REQUEST_ID = "test9-claims4-1-2";
export const CLAIMS41_PROMPT_HASH = "d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58";
export const CLAIMS41_SCHEMA_HASH = "16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb";

export function authorizeClaims41Live(args: {
  live: boolean; authorization: string | undefined; allowedRequestIds: string[]; maxCalls: number;
  plannedRequestIds: string[]; previousAttemptExists: boolean; execArgv: string[];
}) {
  if (!args.live || args.authorization !== "1") throw new Error("Fresh Claims-4.1 authorization and --live-luna are required");
  if (args.allowedRequestIds.length !== 1 || args.allowedRequestIds[0] !== CLAIMS41_REQUEST_ID ||
      args.plannedRequestIds.length !== 1 || args.plannedRequestIds[0] !== CLAIMS41_REQUEST_ID)
    throw new Error("Claims-4.1 requires the exact single-request allowlist");
  if (args.maxCalls !== 1) throw new Error("Claims-4.1 requires a hard one-dispatch cap");
  if (args.previousAttemptExists) throw new Error("A Claims-4.1 attempt already exists; automatic redispatch is forbidden");
  if (!args.execArgv.includes("--use-system-ca")) throw new Error("Claims-4.1 requires Node --use-system-ca");
}
