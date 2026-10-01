import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { loadFrozenClaims41Benchmarks } from "../lib/ai/claims-4-1-benchmarks";
import { CLAIMS_4_1_PROMPT, claims41CheckpointIdentity, claims41OutputSchema, claims41PromptHash, claims41SchemaHash, claims41TokenDiagnostics, reconcileClaims41, serializeClaims41Request, type Claims41Output } from "../lib/ai/claims-4-1-experiment";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics } from "../lib/ai/experiment-response";
import { modelCallUsage } from "../lib/ai/usage";

const REQUEST_ID = "test10-sweetwater-claims4-1-v3-1";
const BASELINE_ID = "test10-sweetwater-claims2-v3-1";
const AUTH = "ALLOW_PAID_CLAIMS41_SWEETWATER_LUNA";
const PROMPT_HASH = "d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58";
const SCHEMA_HASH = "16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb";
const HASHES = {
  sourceHash: "87f0d5f8099d1881ecad6a6bba03d2807df6bd07138975dead3d1fea373e42cc",
  fixtureHash: "61452bd607529afae3cf944114f9e56e57da18c3112e4a1f274b62c6f58ab03b",
  inventoryHash: "cb1830f904f217004022b85b7ea0e0d2d6961e390a797d65d021e4ad6e7400d4",
  manifestHash: "86c639143593147d61f50ba1945c1918f6103e494289673ce250d0e0cd00b3a9",
  baselineResultHash: "add2e5e71741231fa2c23329b507ef65db4b499d87e3b93bcc96c85c457aa3ee",
};
const ROOT = join(process.cwd(), "fixtures", "private", "claims4-1-sweetwater-v1");
const preflightPath = join(ROOT, "preflight.v1.json");
const progressPath = join(ROOT, `${REQUEST_ID}.progress.v1.json`);
const resultPath = join(ROOT, `${REQUEST_ID}.result.v1.json`);
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function save(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, json(value));
  renameSync(temporary, path);
}
function createAttempt(value: unknown) {
  const file = openSync(progressPath, "wx");
  try { writeSync(file, json(value)); fsyncSync(file); } finally { closeSync(file); }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const live = process.argv.includes("--live-luna");
  const expectedArgs = ["--live-luna", `--allow-requests=${REQUEST_ID}`, "--max-calls=1"];
  assert(!live ? process.argv.length === 2 : process.argv.length === 5 && expectedArgs.every((arg) => process.argv.includes(arg)),
    "Only the exact Sweetwater live flags are accepted");
  assert(!existsSync(progressPath) && !existsSync(resultPath), "A Sweetwater Claims-4.1 dispatch exists in some state; stop without resending");
  const benchmarks = await loadFrozenClaims41Benchmarks();
  const benchmark = benchmarks.find((item) => item.name === "Test 10 — Sweetwater");
  assert(benchmark && Object.entries(HASHES).every(([key, value]) => benchmark[key as keyof typeof HASHES] === value),
    "Frozen Sweetwater source, fixture, inventory, manifest, or baseline hash changed");
  assert(benchmark.requests.length === 1, "Sweetwater request count changed");
  const request = benchmark.requests[0];
  const pages = [...new Set(request.evidenceUnits.map((unit) => unit.page))];
  assert(request.requestId === REQUEST_ID && request.baselineRequestId === BASELINE_ID &&
    JSON.stringify(pages) === JSON.stringify([6, 7, 8, 9, 10, 11, 12, 13]) && request.evidenceUnits.length === 163,
    "Frozen Sweetwater request boundary changed");
  assert(claims41PromptHash() === PROMPT_HASH && claims41SchemaHash() === SCHEMA_HASH,
    "Frozen Claims-4.1 prompt or schema changed");
  const unitIds = request.evidenceUnits.map((unit) => unit.unitId);
  assert(new Set(unitIds).size === 163, "Frozen evidence unit IDs are not unique");
  const diagnostics = claims41TokenDiagnostics(request);
  const estimatedInputTokens = diagnostics.estimatedTokens.totalInput;
  const reservedInputTokens = Math.ceil(estimatedInputTokens * 1.2);
  const maxOutputTokens = 20000;
  const rate = { inputUsdPerMillion: 0.275, outputUsdPerMillion: 0.825,
    basis: "historical Claims-2 planning assumption; ceiling estimate, not an invoice or current price quote" };
  const plan = { version: 1, mode: "offline", requestId: REQUEST_ID, baselineRequestId: BASELINE_ID,
    modelId: "gpt-6-luna", pages, evidenceUnits: 163, evidenceUnitIdsHash: sha(JSON.stringify(unitIds)),
    ...HASHES, promptHash: PROMPT_HASH, schemaHash: SCHEMA_HASH,
    reconciliationV2CodeHash: sha(readFileSync(join(process.cwd(), "lib/ai/claims-4-1-reconciliation-v2.ts"))),
    oldReconciliationCodeHash: sha(readFileSync(join(process.cwd(), "lib/ai/claims-4-1-experiment.ts"))),
    identity: claims41CheckpointIdentity({ request, ...HASHES, modelId: "gpt-6-luna" }),
    diagnostics, estimatedInputTokens, reservedInputTokens, maxOutputTokens,
    sdkMaxRetries: 0, hardCallBudget: 1, plannedCalls: 1, liveCallsMade: 0, rate,
    planningCostCeilingUsd: (reservedInputTokens * rate.inputUsdPerMillion + maxOutputTokens * rate.outputUsdPerMillion) / 1_000_000 };
  mkdirSync(ROOT, { recursive: true });
  save(preflightPath, plan);
  if (!live) { console.log(json({ preflightPath, ...plan })); return; }
  assert(process.env[AUTH] === "1", `Fresh ${AUTH}=1 authorization required`);
  assert(process.execArgv.includes("--use-system-ca"), "Node --use-system-ca required");
  assert(!existsSync(progressPath) && !existsSync(resultPath), "Sweetwater attempt appeared during preflight");
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const [{ default: OpenAI }, { zodTextFormat }, { getOpenAIEnv }] = await Promise.all([
    import("openai"), import("openai/helpers/zod"), import("../lib/env")]);
  const client = new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: 0 });
  const attempt = { requestId: REQUEST_ID, identity: plan.identity, state: "dispatching" as "dispatching" | "completed" | "failed",
    diagnostics: unknownExperimentDiagnostics(maxOutputTokens, 0), rawResponseOutput: undefined as unknown,
    responseOutputText: undefined as string | undefined, originalParsedOutput: undefined as Claims41Output | undefined,
    error: undefined as string | undefined };
  createAttempt({ attempts: [attempt] });
  try {
    const response = await client.responses.create({ model: "gpt-6-luna", input: [
      { role: "system", content: CLAIMS_4_1_PROMPT }, { role: "user", content: serializeClaims41Request(request).payload },
    ], text: { format: zodTextFormat(claims41OutputSchema, "claims41_sweetwater_v1_output") }, max_output_tokens: maxOutputTokens });
    const usage = modelCallUsage(response.model, response.id, response.usage);
    attempt.diagnostics = captureExperimentResponseDiagnostics(response, usage, maxOutputTokens, 0);
    attempt.rawResponseOutput = response.output;
    attempt.responseOutputText = response.output_text;
    save(progressPath, { attempts: [attempt] });
    assert(response.status === "completed" && !response.incomplete_details, "Incomplete Claims-4.1 response");
    attempt.originalParsedOutput = claims41OutputSchema.parse(JSON.parse(response.output_text));
    save(progressPath, { attempts: [attempt] });
    assert(usage.inputTokens !== null && usage.outputTokens !== null, "Unknown usage requires manual review");
    const reconciled = reconcileClaims41(attempt.originalParsedOutput, request);
    save(resultPath, { identity: plan.identity, requestId: REQUEST_ID, diagnostics: attempt.diagnostics,
      originalParsedOutput: attempt.originalParsedOutput, rawResponseOutput: attempt.rawResponseOutput, reconciled });
    attempt.state = "completed";
    save(progressPath, { attempts: [attempt] });
    console.log(json({ progressPath, resultPath, responseId: attempt.diagnostics.responseId, usage,
      proposed: reconciled.diagnostics.proposed, retained: reconciled.diagnostics.retained, byState: reconciled.diagnostics.byState }));
  } catch (error) {
    attempt.state = "failed";
    attempt.error = error instanceof Error ? error.message : String(error);
    save(progressPath, { attempts: [attempt] });
    throw error;
  }
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
