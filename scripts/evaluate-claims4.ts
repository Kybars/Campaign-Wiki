import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claims4Preflight, loadFrozenClaims4Benchmarks } from "../lib/ai/claims-4-benchmarks";
import { authorizeClaims4Live, CLAIMS4_AUTHORIZATION_VARIABLE, requireClaims4SystemCA } from "../lib/ai/claims-4-dispatch";
import { CLAIMS_4_PROMPT, claims4OutputSchema, reconcileClaims4, serializeClaims4Request, type Claims4Output } from "../lib/ai/claims-4-experiment";
import { modelCallUsage } from "../lib/ai/usage";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics, type ExperimentResponseDiagnostics } from "../lib/ai/experiment-response";

const directory = join(process.cwd(), "fixtures", "private", "claims4-v1");
const progressPath = join(directory, "progress.v1.json");
const preflightPath = join(directory, "preflight.v1.json");
const resultPath = join(directory, "result.v1.json");
function save(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}
const option = (prefix: string) => process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
type Attempt = { requestId: string; identity: unknown; state: "dispatching" | "completed" | "failed";
  diagnostics: ExperimentResponseDiagnostics; originalParsedOutput?: Claims4Output; rawResponseOutput?: unknown; error?: string };

async function main() {
  const benchmarks = await loadFrozenClaims4Benchmarks();
  const preflight = claims4Preflight(benchmarks);
  const requests = benchmarks.flatMap((benchmark) => benchmark.requests);
  const plannedRequestIds = requests.map((request) => request.requestId);
  const live = process.argv.includes("--live-luna");
  if (!live && (option("--allow-requests=") || option("--max-calls="))) throw new Error("Live options require --live-luna");
  mkdirSync(directory, { recursive: true });
  save(preflightPath, preflight);
  const progress: { attempts: Attempt[] } = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { attempts: [] };
  if (!Array.isArray(progress.attempts)) throw new Error("Invalid Claims-4 progress file");
  for (const attempt of progress.attempts) {
    const plan = preflight.requests.find((item) => item.requestId === attempt.requestId);
    if (!plan || JSON.stringify(attempt.identity) !== JSON.stringify(plan.identity)) throw new Error("Claims-4 checkpoint identity changed");
    if (attempt.state === "completed") claims4OutputSchema.parse(attempt.originalParsedOutput);
  }
  if (!live) {
    console.log(JSON.stringify({ preflightPath, progressPath, plannedCalls: preflight.plannedCalls, completed: progress.attempts.filter((item) => item.state === "completed").length,
      requests: preflight.requests.map((item) => ({ requestId: item.requestId, baselineRequestId: item.baselineRequestId, pages: item.pages,
        evidenceUnits: item.evidenceUnits, estimatedInputTokens: item.estimatedInputTokens, reservedInputTokens: item.reservedInputTokens,
        maxOutputTokens: item.maxOutputTokens, estimatedCostUsd: item.estimatedCostUsd })), totals: preflight.totals }, null, 2));
    return;
  }
  const allowedRequestIds = (option("--allow-requests=") ?? "").split(",").filter(Boolean);
  const maxCalls = Number(option("--max-calls="));
  const pending = authorizeClaims4Live({ live, authorization: process.env[CLAIMS4_AUTHORIZATION_VARIABLE], allowedRequestIds,
    maxCalls, plannedRequestIds, existingAttempts: progress.attempts });
  if (!pending.length) { console.log(JSON.stringify({ stopped: "already_complete", progressPath })); return; }
  requireClaims4SystemCA();
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const [{ default: OpenAI }, { zodTextFormat }, { getOpenAIEnv }] = await Promise.all([import("openai"), import("openai/helpers/zod"), import("../lib/env")]);
  const client = new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: 0 });
  for (const requestId of pending) {
    const request = requests.find((item) => item.requestId === requestId)!;
    const plan = preflight.requests.find((item) => item.requestId === requestId)!;
    const attempt: Attempt = { requestId, identity: plan.identity, state: "dispatching", diagnostics: unknownExperimentDiagnostics(plan.maxOutputTokens, 0) };
    progress.attempts.push(attempt);
    save(progressPath, progress); // A recorded uncertain dispatch cannot be sent again automatically.
    try {
      const response = await client.responses.parse({ model: preflight.modelId, input: [
        { role: "system", content: CLAIMS_4_PROMPT }, { role: "user", content: serializeClaims4Request(request).payload },
      ], text: { format: zodTextFormat(claims4OutputSchema, "claims4_v1_output") }, max_output_tokens: plan.maxOutputTokens });
      const usage = modelCallUsage(response.model, response.id, response.usage);
      attempt.diagnostics = captureExperimentResponseDiagnostics(response, usage, plan.maxOutputTokens, 0);
      attempt.rawResponseOutput = response.output;
      // Save the original parsed proposals before schema validation or reconciliation.
      if (response.output_parsed) attempt.originalParsedOutput = response.output_parsed as Claims4Output;
      save(progressPath, progress);
      if (response.status !== "completed" || response.incomplete_details || !attempt.originalParsedOutput) throw new Error("Incomplete Claims-4 response");
      claims4OutputSchema.parse(attempt.originalParsedOutput);
      if (usage.inputTokens === null || usage.outputTokens === null) throw new Error("Unknown usage requires manual review");
      const reconciled = reconcileClaims4(attempt.originalParsedOutput, request);
      save(join(directory, `${requestId}.reconciliation.v1.json`), { identity: plan.identity, originalParsedOutput: attempt.originalParsedOutput, reconciled });
      attempt.state = "completed";
      save(progressPath, progress);
    } catch (error) {
      attempt.state = "failed";
      attempt.error = error instanceof Error ? error.message : String(error);
      save(progressPath, progress);
      throw error;
    }
  }
  const completed = progress.attempts.filter((attempt) => attempt.state === "completed");
  save(resultPath, { preflightPath, completedRequestIds: completed.map((attempt) => attempt.requestId),
    requests: completed.map((attempt) => ({ requestId: attempt.requestId, identity: attempt.identity, diagnostics: attempt.diagnostics,
      originalParsedOutput: attempt.originalParsedOutput,
      reconciled: reconcileClaims4(attempt.originalParsedOutput!, requests.find((request) => request.requestId === attempt.requestId)!) })) });
  console.log(JSON.stringify({ resultPath, completedRequestIds: completed.map((attempt) => attempt.requestId) }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
