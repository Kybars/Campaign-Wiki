/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/extraction-context";
import { planTest9Claims2Requests } from "../lib/ai/claims-2-experiment";
import { COMPLETENESS_BEHAVIOR_VERSION, COMPLETENESS_PROMPT, completenessCheckpointIdentity, completenessOutputSchema, completenessTokenDiagnostics, planCompletenessRequests, reviewCompletenessCandidates, serializeCompletenessRequest, type CompletenessOutput } from "../lib/ai/claims-2-completeness";
import { assertKnownUsage, parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics, type ExperimentResponseDiagnostics } from "../lib/ai/experiment-response";
import { modelCallUsage, type ModelCallUsage } from "../lib/ai/usage";
import { getOpenAIEnv } from "../lib/env";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";

loadEnvConfig(process.cwd());
const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const context = buildExtractionContext(cleanDocumentPagesForModel(fixture.pages).pages, inventory);
const baselineBytes = readFileSync(join(directory, "claims2-v067-result.json"));
const baseline = JSON.parse(baselineBytes.toString("utf8")) as any;
if (baseline.preflight?.fixtureHash !== fixture.fixture_hash || baseline.valid !== 147 || baseline.totalTokens !== 17_168 || !Array.isArray(baseline.claims) || baseline.claims.length !== 147) throw new Error("Saved Claims-2 baseline is missing or changed");
const baselineFingerprint = createHash("sha256").update(baselineBytes).digest("hex");
const requests = planCompletenessRequests(planTest9Claims2Requests(context), baseline.claims);
if (requests.length !== 2 || requests.reduce((sum, request) => sum + request.existingClaims.length, 0) !== 147) throw new Error("Expected exactly two complete Test 9 coverage chunks");
const args = process.argv.slice(2);
const budgetArg = args.indexOf("--budget-config");
if (budgetArg < 0 || !args[budgetArg + 1]) throw new Error("Pass --budget-config with an explicit JSON budget file");
const configPath = resolve(args[budgetArg + 1]);
const config = parseExperimentBudgetConfig(JSON.parse(readFileSync(configPath, "utf8")), requests.map((request) => request.requestId));
const live = args.includes("--live-luna");
const reviewSaved = args.includes("--review-saved");
if (live && reviewSaved) throw new Error("Choose live or saved review mode");
const modelId = "gpt-6-luna";
const contextFingerprint = extractionContextFingerprint(context);
const identities = requests.map((request) => completenessCheckpointIdentity({ request, fixtureHash: fixture.fixture_hash, contextFingerprint,
  baselineFingerprint, modelId, maxOutputTokens: config.requests[request.requestId].maxOutputTokens, sdkMaxRetries: config.sdkMaxRetries }));
const chunks = requests.map((request, index) => {
  const tokens = completenessTokenDiagnostics(request);
  return { requestId: request.requestId, pages: [...new Set(request.base.evidenceUnits.map((unit) => unit.page))], evidenceUnits: request.base.evidenceUnits.length,
    entities: request.base.entities.length, existingClaims: request.existingClaims.length, tokens,
    maxOutputTokens: config.requests[request.requestId].maxOutputTokens,
    reservationAtZeroUsage: reserveExperimentRequest(config, request.requestId, tokens.estimatedTokens.totalInput, 0), checkpointIdentity: identities[index] };
});
const preflight = { fixtureHash: fixture.fixture_hash, baselineFingerprint, behaviorVersion: COMPLETENESS_BEHAVIOR_VERSION, modelId,
  proposedCalls: requests.length, budgetConfig: config, chunks, totals: {
    estimatedInputByComponent: Object.fromEntries((["source", "entities", "coverage", "prompt", "schema"] as const).map((key) => [key, chunks.reduce((sum, chunk) => sum + chunk.tokens.estimatedTokens[key], 0)])),
    estimatedInput: chunks.reduce((sum, chunk) => sum + chunk.tokens.estimatedTokens.totalInput, 0),
    configuredOutputLimits: chunks.reduce((sum, chunk) => sum + chunk.maxOutputTokens, 0),
    totalReservedTokens: chunks.reduce((sum, chunk) => sum + chunk.reservationAtZeroUsage.reservedTokens, 0),
    configuredRunBudget: config.totalTokenBudget,
  } };
const preflightPath = join(directory, "claims2-completeness-v067-preflight.json");
const progressPath = join(directory, "claims2-completeness-v067-progress.json");
const reviewPath = join(directory, "claims2-completeness-v067-review.json");
type Attempt = { requestId: string; identity: typeof identities[number]; state: "dispatching" | "completed" | "failed"; diagnostics: ExperimentResponseDiagnostics;
  output?: CompletenessOutput; error?: string };
type Progress = { fixtureHash: string; baselineFingerprint: string; attempts: Attempt[] };
function saveJson(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}
function saveReview(progress: Progress) {
  const review = { fixtureHash: fixture.fixture_hash, baselineFingerprint, behaviorVersion: COMPLETENESS_BEHAVIOR_VERSION,
    candidates: progress.attempts.filter((attempt) => attempt.state === "completed" && attempt.output).flatMap((attempt) => {
      const request = requests.find((item) => item.requestId === attempt.requestId)!;
      return reviewCompletenessCandidates(request, attempt.output!).map((candidate) => ({ requestId: attempt.requestId, ...candidate }));
    }) };
  saveJson(reviewPath, review);
}

async function main() {
  saveJson(preflightPath, preflight);
  if (!live && !reviewSaved) { console.log(JSON.stringify({ preflightPath, preflight }, null, 2)); return; }
  if (live && process.env.ALLOW_PAID_TEST9_CLAIMS2_COMPLETENESS_LUNA !== "1") throw new Error("Explicit Claims-2 completeness paid-call authorization required");
  const progress: Progress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { fixtureHash: fixture.fixture_hash, baselineFingerprint, attempts: [] };
  if (progress.fixtureHash !== fixture.fixture_hash || progress.baselineFingerprint !== baselineFingerprint || progress.attempts.length > requests.length) throw new Error("Completeness progress baseline mismatch");
  for (const attempt of progress.attempts) {
    const identity = identities.find((item) => item.operationKey === attempt.requestId);
    if (!identity || JSON.stringify(identity) !== JSON.stringify(attempt.identity)) throw new Error("Completeness checkpoint identity mismatch");
    if (attempt.state === "completed") {
      completenessOutputSchema.parse(attempt.output);
      assertKnownUsage(attempt.diagnostics.usage as ModelCallUsage);
    }
  }
  if (reviewSaved) { saveReview(progress); console.log(JSON.stringify({ reviewPath, completed: progress.attempts.length }, null, 2)); return; }
  const pending = pendingExperimentRequests(requests.map((request) => request.requestId), progress.attempts);
  const client = new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: config.sdkMaxRetries });
  for (const request of requests) {
    if (!pending.includes(request.requestId)) continue;
    const used = progress.attempts.reduce((sum, attempt) => sum + assertKnownUsage((attempt.diagnostics.usage as ModelCallUsage)), 0);
    const stage = config.requests[request.requestId].stage;
    const stageUsed = stage ? progress.attempts.filter((attempt) => config.requests[attempt.requestId].stage === stage)
      .reduce((sum, attempt) => sum + assertKnownUsage((attempt.diagnostics.usage as ModelCallUsage)), 0) : 0;
    const reservation = reserveExperimentRequest(config, request.requestId, completenessTokenDiagnostics(request).estimatedTokens.totalInput, used, stageUsed);
    if (!reservation.fits) { console.log(JSON.stringify({ stopped: "budget_exhausted", reservation, progressPath, reviewPath }, null, 2)); break; }
    const attempt: Attempt = { requestId: request.requestId, identity: identities.find((item) => item.operationKey === request.requestId)!, state: "dispatching",
      diagnostics: unknownExperimentDiagnostics(config.requests[request.requestId].maxOutputTokens, config.sdkMaxRetries) };
    progress.attempts.push(attempt);
    saveJson(progressPath, progress);
    try {
      const response = await client.responses.parse({ model: modelId, input: [{ role: "system", content: COMPLETENESS_PROMPT },
        { role: "user", content: serializeCompletenessRequest(request).payload }], text: { format: zodTextFormat(completenessOutputSchema, "test9_claims2_completeness_output") },
        max_output_tokens: config.requests[request.requestId].maxOutputTokens });
      const usage = modelCallUsage(response.model, response.id, response.usage);
      attempt.diagnostics = captureExperimentResponseDiagnostics(response, usage, config.requests[request.requestId].maxOutputTokens, config.sdkMaxRetries);
      if (response.status !== "completed" || response.incomplete_details || !response.output_parsed) throw new Error("Response was not completed with parsed output");
      attempt.output = completenessOutputSchema.parse(response.output_parsed);
      assertKnownUsage(usage);
      attempt.state = "completed";
      saveJson(progressPath, progress);
      saveReview(progress);
    } catch (error) {
      attempt.state = "failed";
      attempt.error = error instanceof Error ? error.message : String(error);
      saveJson(progressPath, progress);
      saveReview(progress);
      throw error;
    }
  }
  saveReview(progress);
  console.log(JSON.stringify({ progressPath, reviewPath, completed: progress.attempts.filter((attempt) => attempt.state === "completed").length }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
