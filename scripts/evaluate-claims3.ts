import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claims3Preflight, loadFrozenClaims3Benchmarks } from "../lib/ai/claims-3-benchmarks";
import { authorizeClaims3Live } from "../lib/ai/claims-3-dispatch";
import { CLAIMS_3_PROMPT, claims3OutputSchema, serializeClaims3Request, validateAndUnionClaims3, type Claims3Output } from "../lib/ai/claims-3-experiment";
import { pendingExperimentRequests } from "../lib/ai/experiment-budget";
import { modelCallUsage, type ModelCallUsage } from "../lib/ai/usage";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics, type ExperimentResponseDiagnostics } from "../lib/ai/experiment-response";
import { claims3AuthorizationVariable, claims3RecoveryLineage, readClaims3RecoveryProgress, requireClaims3RecoveryFirst, requireClaims3SystemCA, saveClaims3RecoveryAttempt,
  type Claims3RecoveryLineage, type Claims3RecoveryProgress } from "../lib/ai/claims-3-recovery";

const recovery = process.argv.includes("--recovery-v1");
const directory = join(process.cwd(), "fixtures", "private", recovery ? "claims3-recovery-v1" : "claims3-v1");
const progressPath = join(directory, "progress.v1.json");
const preflightPath = join(directory, "preflight.v1.json");
const resultPath = join(directory, "result.v1.json");
const originalFailedPath = join(process.cwd(), "fixtures", "private", "claims3-v1", "progress.v1.json");
function save(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}
function option(prefix: string) { return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length); }
type Attempt = { requestId: string; identity: unknown; state: "dispatching" | "completed" | "failed";
  diagnostics: ExperimentResponseDiagnostics; output?: Claims3Output; error?: string };

async function main() {
  const benchmarks = await loadFrozenClaims3Benchmarks();
  const preflight = claims3Preflight(benchmarks);
  const lineage = recovery ? claims3RecoveryLineage(readFileSync(originalFailedPath), preflight.requests[0].identity) : undefined;
  const recoveryProgress = lineage ? readClaims3RecoveryProgress(progressPath, lineage) : undefined;
  mkdirSync(directory, { recursive: true });
  save(preflightPath, preflight);
  const requests = benchmarks.flatMap((benchmark) => benchmark.requests);
  const plannedIds = requests.map((request) => request.requestId);
  const live = process.argv.includes("--live-luna");
  if (!live) {
    if (option("--allow-requests=") || option("--max-calls=")) throw new Error("Live options require --live-luna");
    console.log(JSON.stringify({ preflightPath, ...(lineage ? { recoveryOf: lineage, recoveryAttempts: recoveryProgress!.attempts.map((attempt) => ({ requestId: attempt.requestId, state: attempt.state })) } : {}), plannedCalls: preflight.plannedCalls, requests: preflight.requests.map((request) => ({ requestId: request.requestId, baselineRequestId: request.baselineRequestId, pages: request.pages, evidenceUnits: request.evidenceUnits, estimatedInputTokens: request.estimatedInputTokens, maxOutputTokens: request.maxOutputTokens, estimatedCostUsd: request.estimatedCostUsd })), totals: preflight.totals }, null, 2));
    return;
  }
  const allowedRequestIds = (option("--allow-requests=") ?? "").split(",").filter(Boolean);
  const maxCalls = Number(option("--max-calls="));
  const prior: { attempts: Attempt[]; recoveryOf?: Claims3RecoveryLineage } = lineage
    ? recoveryProgress as { attempts: Attempt[]; recoveryOf: Claims3RecoveryLineage }
    : existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { attempts: [] };
  for (const attempt of prior.attempts) {
    const expected = preflight.requests.find((request) => request.requestId === attempt.requestId)?.identity;
    if (!expected || JSON.stringify(expected) !== JSON.stringify(attempt.identity)) throw new Error("Claims-3 checkpoint identity changed");
    if (attempt.state === "completed") claims3OutputSchema.parse(attempt.output);
  }
  const pending = authorizeClaims3Live({ live, authorization: process.env[claims3AuthorizationVariable(recovery)],
    allowedRequestIds, maxCalls, plannedRequestIds: plannedIds, existingAttempts: prior.attempts });
  pendingExperimentRequests(plannedIds, prior.attempts);
  if (recovery) requireClaims3RecoveryFirst(prior.attempts, pending);
  if (!pending.length) { console.log(JSON.stringify({ stopped: "already_complete", progressPath })); return; }
  requireClaims3SystemCA();
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const [{ default: OpenAI }, { zodTextFormat }, { getOpenAIEnv }] = await Promise.all([import("openai"), import("openai/helpers/zod"), import("../lib/env")]);
  const client = new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: 0 });
  for (const requestId of pending) {
    const request = requests.find((item) => item.requestId === requestId)!;
    const plan = preflight.requests.find((item) => item.requestId === requestId)!;
    const attempt: Attempt = { requestId, identity: plan.identity, state: "dispatching", diagnostics: unknownExperimentDiagnostics(plan.maxOutputTokens, 0) };
    if (lineage) {
      saveClaims3RecoveryAttempt(progressPath, prior as Claims3RecoveryProgress, attempt);
      prior.attempts.push(attempt);
    } else {
      prior.attempts.push(attempt);
      save(progressPath, prior);
    } // Durable before dispatch; any uncertain attempt blocks automatic retry.
    try {
      const response = await client.responses.parse({ model: preflight.modelId, input: [
        { role: "system", content: CLAIMS_3_PROMPT }, { role: "user", content: serializeClaims3Request(request).payload },
      ], text: { format: zodTextFormat(claims3OutputSchema, "claims3_v1_output") }, max_output_tokens: plan.maxOutputTokens });
      const usage = modelCallUsage(response.model, response.id, response.usage);
      attempt.diagnostics = captureExperimentResponseDiagnostics(response, usage, plan.maxOutputTokens, 0);
      if (response.status !== "completed" || response.incomplete_details || !response.output_parsed) throw new Error("Incomplete Claims-3 response");
      attempt.output = claims3OutputSchema.parse(response.output_parsed);
      if ((usage as ModelCallUsage).inputTokens === null || (usage as ModelCallUsage).outputTokens === null) throw new Error("Unknown usage requires manual review");
      validateAndUnionClaims3([{ requestId, output: attempt.output }], [request]);
      attempt.state = "completed";
      save(progressPath, prior);
    } catch (error) {
      attempt.state = "failed";
      attempt.error = error instanceof Error ? error.message : String(error);
      save(progressPath, prior);
      throw error;
    }
  }
  const completed = prior.attempts.filter((attempt) => attempt.state === "completed");
  const validated = validateAndUnionClaims3(completed.map((attempt) => ({ requestId: attempt.requestId, output: attempt.output! })), requests.filter((request) => completed.some((attempt) => attempt.requestId === request.requestId)));
  save(resultPath, { preflightPath, ...(lineage ? { recoveryOf: lineage } : {}), completedRequestIds: completed.map((attempt) => attempt.requestId), validated });
  console.log(JSON.stringify({ resultPath, completedRequestIds: completed.map((attempt) => attempt.requestId), structurallyRetained: validated.claims.length }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
