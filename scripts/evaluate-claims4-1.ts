import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { claims41Preflight, loadFrozenClaims41Benchmarks } from "../lib/ai/claims-4-1-benchmarks";
import { authorizeClaims41Live, CLAIMS41_AUTHORIZATION_VARIABLE, CLAIMS41_PROMPT_HASH, CLAIMS41_REQUEST_ID, CLAIMS41_SCHEMA_HASH } from "../lib/ai/claims-4-1-dispatch";
import { CLAIMS_4_1_PROMPT, claims41OutputSchema, reconcileClaims41, serializeClaims41Request, type Claims41Output } from "../lib/ai/claims-4-1-experiment";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics } from "../lib/ai/experiment-response";
import { modelCallUsage } from "../lib/ai/usage";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function save(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, json(value));
  renameSync(temporary, path);
}
function createAttempt(path: string, value: unknown) {
  const file = openSync(path, "wx");
  try { writeSync(file, json(value)); fsyncSync(file); } finally { closeSync(file); }
}
const option = (prefix: string) => process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

async function main() {
  const live = process.argv.includes("--live-luna");
  if (!live && process.argv.length > 2) throw new Error("Live options require --live-luna");
  if (live && (process.argv.length !== 5 || !option("--allow-requests=") || !option("--max-calls=")))
    throw new Error("Claims-4.1 live run requires only --live-luna, --allow-requests, and --max-calls");
  const benchmarks = await loadFrozenClaims41Benchmarks();
  const plan = claims41Preflight(benchmarks);
  const request = benchmarks.flatMap((benchmark) => benchmark.requests).find((item) => item.requestId === CLAIMS41_REQUEST_ID);
  const target = plan.requests[0];
  if (plan.modelId !== "gpt-6-luna" || plan.promptHash !== CLAIMS41_PROMPT_HASH || plan.schemaHash !== CLAIMS41_SCHEMA_HASH ||
      plan.plannedCalls !== 1 || plan.hardCallBudget !== 1 || target?.requestId !== CLAIMS41_REQUEST_ID ||
      target.baselineRequestId !== "test9-claims2-2" || JSON.stringify(target.pages) !== "[13,14]" ||
      target.evidenceUnits !== 66 || target.maxOutputTokens !== 16000 || !request ||
      target.sourceHash !== "1f9c556e5e4150c9424560e79fa7154826516a13ffedf7da7213185d3134828c" ||
      target.fixtureHash !== "d7733ff9705391572d25f0b3c2c6188ee57c37f69d5a3b65507ccd8b4990ade7")
    throw new Error("Claims-4.1 authorized preflight differs from frozen request");
  const directory = join(process.cwd(), "fixtures", "private", "claims4-1-v1");
  mkdirSync(directory, { recursive: true });
  const preflightPath = join(directory, "preflight.v1.json");
  const progressPath = join(directory, "progress.v1.json");
  const resultPath = join(directory, `${CLAIMS41_REQUEST_ID}.result.v1.json`);
  const previousAttemptExists = existsSync(progressPath) || existsSync(resultPath);
  if (live) authorizeClaims41Live({ live, authorization: process.env[CLAIMS41_AUTHORIZATION_VARIABLE],
    allowedRequestIds: (option("--allow-requests=") ?? "").split(","), maxCalls: Number(option("--max-calls=")),
    plannedRequestIds: plan.requests.map((item) => item.requestId), previousAttemptExists, execArgv: process.execArgv });
  save(preflightPath, plan);
  if (!live) {
    console.log(JSON.stringify({ preflightPath, previousAttemptExists, plannedCalls: plan.plannedCalls, liveCallsMade: plan.liveCallsMade,
      modelId: plan.modelId, promptHash: plan.promptHash, schemaHash: plan.schemaHash, requests: plan.requests.map((item) => ({
        requestId: item.requestId, pages: item.pages, evidenceUnits: item.evidenceUnits,
        sourceHash: item.sourceHash, fixtureHash: item.fixtureHash,
        estimatedInputTokens: item.estimatedInputTokens, reservedInputTokens: item.reservedInputTokens,
        maxOutputTokens: item.maxOutputTokens, estimatedCostUsd: item.estimatedCostUsd,
      })) }, null, 2));
    return;
  }
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const [{ default: OpenAI }, { zodTextFormat }, { getOpenAIEnv }] = await Promise.all([import("openai"), import("openai/helpers/zod"), import("../lib/env")]);
  const client = new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: 0 });
  const attempt = { requestId: CLAIMS41_REQUEST_ID, identity: target.identity, state: "dispatching" as "dispatching" | "completed" | "failed",
    diagnostics: unknownExperimentDiagnostics(target.maxOutputTokens, 0), rawResponseOutput: undefined as unknown,
    originalParsedOutput: undefined as Claims41Output | undefined, responseOutputText: undefined as string | undefined,
    error: undefined as string | undefined };
  createAttempt(progressPath, { attempts: [attempt] });
  try {
    const response = await client.responses.create({ model: plan.modelId, input: [
      { role: "system", content: CLAIMS_4_1_PROMPT }, { role: "user", content: serializeClaims41Request(request).payload },
    ], text: { format: zodTextFormat(claims41OutputSchema, "claims41_wotbs_v1_output") }, max_output_tokens: target.maxOutputTokens });
    const usage = modelCallUsage(response.model, response.id, response.usage);
    attempt.diagnostics = captureExperimentResponseDiagnostics(response, usage, target.maxOutputTokens, 0);
    attempt.rawResponseOutput = response.output;
    attempt.responseOutputText = response.output_text;
    save(progressPath, { attempts: [attempt] });
    if (response.status !== "completed" || response.incomplete_details) throw new Error("Incomplete Claims-4.1 response");
    attempt.originalParsedOutput = claims41OutputSchema.parse(JSON.parse(response.output_text));
    save(progressPath, { attempts: [attempt] }); // Original and raw outputs precede reconciliation.
    if (usage.inputTokens === null || usage.outputTokens === null) throw new Error("Unknown usage requires manual review");
    const reconciled = reconcileClaims41(attempt.originalParsedOutput, request);
    save(resultPath, { identity: target.identity, requestId: CLAIMS41_REQUEST_ID, diagnostics: attempt.diagnostics,
      originalParsedOutput: attempt.originalParsedOutput, rawResponseOutput: attempt.rawResponseOutput, reconciled });
    attempt.state = "completed";
    save(progressPath, { attempts: [attempt] });
    console.log(JSON.stringify({ resultPath, progressPath, responseId: attempt.diagnostics.responseId,
      usage, proposed: reconciled.diagnostics.proposed, retained: reconciled.diagnostics.retained,
      byState: reconciled.diagnostics.byState }, null, 2));
  } catch (error) {
    attempt.state = "failed";
    attempt.error = error instanceof Error ? error.message : String(error);
    save(progressPath, { attempts: [attempt] });
    throw error;
  }
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
