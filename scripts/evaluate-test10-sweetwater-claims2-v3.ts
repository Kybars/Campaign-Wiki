import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { zodTextFormat } from "openai/helpers/zod";
import { CLAIMS_2_BEHAVIOR_VERSION, CLAIMS_2_PROMPT, CLAIMS_2_SCHEMA_VERSION, claims2OutputSchema, claims2TokenDiagnostics,
  serializeClaims2Request, validateAndUnionClaims2, type Claims2Output } from "../lib/ai/claims-2-experiment";
import { assertKnownUsage, parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics, type ExperimentResponseDiagnostics } from "../lib/ai/experiment-response";
import { modelCallUsage, type ModelCallUsage } from "../lib/ai/usage";
import { fixtureHash, sha256 } from "../lib/ai/test10-claims2";
import { planTest10Claims2V3, TEST10_V3_BENCHMARK_VERSION, test10V3DispatchStatus, test10V3Identity } from "../lib/ai/test10-claims2-v3";
import type { Test10InventoryEntry } from "../lib/ai/test10-claims2-v2";
import { extractPdfPages } from "../lib/pdf/extract-text";

const directory = join(process.cwd(), "fixtures", "private", "test10-sweetwater-v1");
const sourcePath = "C:/Users/rynde/Documents/RPG/Demonplague/The Demonplague Sweetwater Village.pdf";
const inventoryPath = join(directory, "inventory.v3.frozen.json");
const worksheetPath = join(directory, "annotation-worksheet.v3.json");
const manifestPath = join(directory, "evidence-units.v3.json");
const preflightPath = join(directory, "preflight.v3.json");
const progressPath = join(directory, "progress.v3.json");
const resultPath = join(directory, "result.v3.json");
const budgetPath = join(process.cwd(), "config", "test10-sweetwater-claims2-budget.v3.json");
const modelId = "gpt-6-luna";
const live = process.argv.includes("--live-luna");
loadEnvConfig(process.cwd());

function writeNewOrSame(path: string, value: unknown) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) { if (readFileSync(path, "utf8") !== bytes) throw new Error(`Versioned artifact changed: ${path}`); return; }
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}
function saveCheckpoint(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}
type Reference = { physicalPdfPage: number; start: number; end: number; exactText: string };
type WorksheetRow = { id: string; expectedProposition: string; source: Reference; originalSelection: Reference; evidenceSpans: Reference[]; sourceScopedEntityEvidence?: Reference[]; judgment: string };

async function main() {
  const prior = JSON.parse(readFileSync(join(directory, "fixture.v1.json"), "utf8"));
  const bytes = readFileSync(sourcePath);
  const sourceHash = sha256(bytes);
  if (sourceHash !== prior.sourceHash) throw new Error("Original PDF hash changed");
  const pages = (await extractPdfPages(bytes)).filter((page) => page.pageNumber >= 6 && page.pageNumber <= 13);
  const hash = fixtureHash(pages);
  if (hash !== prior.fixtureHash || JSON.stringify(pages) !== JSON.stringify(prior.pages)) throw new Error("Original PDF fixture changed");

  const v2InventoryBytes = readFileSync(join(directory, "inventory.v2.json"));
  const inventoryBytes = readFileSync(inventoryPath);
  const inventory = JSON.parse(inventoryBytes.toString("utf8")) as { version: number; status: string; benchmarkVersion: number; frozenFrom: { sha256: string }; entities: Test10InventoryEntry[] };
  const proposedInventory = JSON.parse(v2InventoryBytes.toString("utf8")) as { entities: Test10InventoryEntry[] };
  if (inventory.version !== 2 || inventory.benchmarkVersion !== TEST10_V3_BENCHMARK_VERSION || inventory.status !== "frozen" ||
      inventory.frozenFrom.sha256 !== sha256(v2InventoryBytes) || JSON.stringify(inventory.entities) !== JSON.stringify(proposedInventory.entities)) throw new Error("Frozen inventory is not the reviewed v2 inventory");
  const names = new Set(inventory.entities.map((entity) => entity.name));
  if (names.size !== inventory.entities.length || new Set(inventory.entities.map((entity) => entity.id)).size !== names.size) throw new Error("Duplicate inventory name or ID");

  const v2WorksheetBytes = readFileSync(join(directory, "annotation-worksheet.v2.json"));
  const worksheetBytes = readFileSync(worksheetPath);
  const worksheet = JSON.parse(worksheetBytes.toString("utf8")) as { version: number; status: string; frozenFromSha256: string; rows: WorksheetRow[] };
  const priorWorksheet = JSON.parse(v2WorksheetBytes.toString("utf8")) as { rows: WorksheetRow[] };
  if (worksheet.version !== 3 || worksheet.status !== "frozen" || worksheet.frozenFromSha256 !== sha256(v2WorksheetBytes) || worksheet.rows.length !== priorWorksheet.rows.length) throw new Error("Worksheet v3 baseline mismatch");
  for (let index = 0; index < worksheet.rows.length; index++) {
    const row = worksheet.rows[index];
    const before = priorWorksheet.rows[index];
    if (row.id !== before.id || row.judgment !== "" || JSON.stringify(row.source) !== JSON.stringify(before.source) || JSON.stringify(row.originalSelection) !== JSON.stringify(before.originalSelection)) throw new Error(`Worksheet selection changed: ${row.id}`);
    const expected = row.id === "SW10-23" ? "Callia does not attack the characters or her mother unless she is attacked first."
      : row.id === "SW10-31" ? "A successful DC 13 Wisdom (Perception) check finds a lifesaver ring among the skeleton’s robes in the Room of Sorrow."
      : before.expectedProposition;
    if (row.expectedProposition !== expected || JSON.stringify({ ...row, expectedProposition: before.expectedProposition }) !== JSON.stringify(before)) throw new Error(`Unexpected worksheet reference change: ${row.id}`);
    for (const reference of [row.source, ...row.evidenceSpans, ...(row.sourceScopedEntityEvidence ?? [])]) {
      const page = pages.find((candidate) => candidate.pageNumber === reference.physicalPdfPage);
      if (!page || page.text.slice(reference.start, reference.end) !== reference.exactText) throw new Error(`Worksheet evidence mismatch: ${row.id}`);
    }
  }

  const inventoryHash = sha256(inventoryBytes);
  const worksheetHash = sha256(worksheetBytes);
  const { contextFingerprint, request } = planTest10Claims2V3(pages, inventory.entities);
  const v2Manifest = JSON.parse(readFileSync(join(directory, "evidence-units.v2.json"), "utf8")) as { units: Array<{ id: string; page: number; start: number; end: number; exactText: string }> };
  if (request.evidenceUnits.length !== 163 || v2Manifest.units.length !== 163) throw new Error("Expected all 163 original Test 10 evidence units");
  for (let index = 0; index < 163; index++) {
    const unit = request.evidenceUnits[index], priorUnit = v2Manifest.units[index];
    if (unit.unitId !== priorUnit.id || unit.page !== priorUnit.page || unit.rawSource.start !== priorUnit.start || unit.rawSource.end !== priorUnit.end || unit.rawSource.text !== priorUnit.exactText) throw new Error(`Evidence unit changed: ${unit.unitId}`);
  }
  const manifest = { benchmarkVersion: TEST10_V3_BENCHMARK_VERSION, sourceHash, fixtureHash: hash, inventoryHash, requestId: request.requestId,
    pages: pages.map((page) => page.pageNumber), units: request.evidenceUnits.map((unit) => ({ id: unit.unitId, page: unit.page, start: unit.rawSource.start, end: unit.rawSource.end,
      exactText: unit.rawSource.text, text: unit.text, kind: unit.kind, inheritedContext: unit.context, order: unit.order })) };
  writeNewOrSame(manifestPath, manifest);
  const manifestHash = sha256(readFileSync(manifestPath));
  const config = parseExperimentBudgetConfig(JSON.parse(readFileSync(budgetPath, "utf8")), [request.requestId]);
  if (config.sdkMaxRetries !== 0) throw new Error("Test 10 v3 requires zero SDK retries");
  const diagnostics = claims2TokenDiagnostics(request);
  const reservation = reserveExperimentRequest(config, request.requestId, diagnostics.estimatedTokens.totalInput, 0);
  const identity = test10V3Identity({ request, fixtureHash: hash, inventoryHash, worksheetHash, manifestHash, contextFingerprint, modelId });
  const knownEvaluationLimitations = [
    "The page 6 sidebar interrupts the sentence continued on page 7; Claims-2 permits only adjacent two-unit citations. Invalid nonadjacent citations remain rejected and the resulting miss is measured.",
    "The original section inheritance and sentence segmentation are retained, including the page 10–11 feature-sidebar boundary and page 11–12 S3 continuation.",
    "Source-scoped identification of Galell as the merath is present in the one source chunk but is not added as a global alias or special extraction rule.",
  ];
  const { fatalDispatchBlockers, runnable } = test10V3DispatchStatus(reservation, knownEvaluationLimitations);
  const preflight = { benchmarkVersion: TEST10_V3_BENCHMARK_VERSION, sourcePath, sourceHash, fixtureHash: hash, inventoryHash, worksheetHash, manifestHash,
    modelId, behaviorVersion: CLAIMS_2_BEHAVIOR_VERSION, schemaVersion: CLAIMS_2_SCHEMA_VERSION, sdkMaxRetries: 0,
    chunk: { requestId: request.requestId, pages: manifest.pages, evidenceUnits: request.evidenceUnits.length, inventorySize: request.entities.length,
      diagnostics, maxOutputTokens: config.requests[request.requestId].maxOutputTokens, reservation, checkpointIdentity: identity },
    totals: { estimatedInputTokens: diagnostics.estimatedTokens.totalInput, configuredOutputTokens: config.requests[request.requestId].maxOutputTokens,
      reservedTokens: reservation.reservedTokens, configuredRunBudget: config.totalTokenBudget },
    fatalDispatchBlockers, knownEvaluationLimitations, runnable };
  writeNewOrSame(preflightPath, preflight);
  if (!live) { console.log(JSON.stringify({ inventoryPath, worksheetPath, manifestPath, preflightPath, preflight }, null, 2)); return; }
  if (process.env.ALLOW_PAID_TEST10_SWEETWATER_CLAIMS2_V3_LUNA !== "1") throw new Error("Explicit Test 10 v3 paid-run authorization required");
  if (fatalDispatchBlockers.length) throw new Error(fatalDispatchBlockers.join("; "));

  type Attempt = { requestId: string; identity: typeof identity; state: "dispatching" | "completed" | "failed"; diagnostics: ExperimentResponseDiagnostics; output?: Claims2Output; error?: string };
  const progress: { sourceHash: string; fixtureHash: string; inventoryHash: string; worksheetHash: string; manifestHash: string; attempts: Attempt[] } = existsSync(progressPath)
    ? JSON.parse(readFileSync(progressPath, "utf8")) : { sourceHash, fixtureHash: hash, inventoryHash, worksheetHash, manifestHash, attempts: [] };
  if (progress.sourceHash !== sourceHash || progress.fixtureHash !== hash || progress.inventoryHash !== inventoryHash || progress.worksheetHash !== worksheetHash || progress.manifestHash !== manifestHash) throw new Error("Test 10 v3 checkpoint identity mismatch");
  for (const attempt of progress.attempts) {
    if (JSON.stringify(attempt.identity) !== JSON.stringify(identity)) throw new Error("Test 10 v3 operation identity mismatch");
    if (attempt.state === "completed") {
      claims2OutputSchema.parse(attempt.output);
      assertKnownUsage(attempt.diagnostics.usage as ModelCallUsage);
      validateAndUnionClaims2([{ requestId: request.requestId, output: attempt.output! }], [request]);
    }
  }
  const pending = pendingExperimentRequests([request.requestId], progress.attempts);
  if (!pending.length) {
    const completed = progress.attempts[0];
    const validated = validateAndUnionClaims2([{ requestId: request.requestId, output: completed.output! }], [request]);
    writeNewOrSame(resultPath, { sourceHash, fixtureHash: hash, inventoryHash, worksheetHash, manifestHash, identity, complete: true,
      usage: completed.diagnostics.usage, validated });
    console.log(JSON.stringify({ stopped: "already_complete", progressPath, resultPath }));
    return;
  }
  const used = progress.attempts.reduce((sum, attempt) => sum + assertKnownUsage(attempt.diagnostics.usage as ModelCallUsage), 0);
  const stageUsed = used;
  const next = reserveExperimentRequest(config, request.requestId, diagnostics.estimatedTokens.totalInput, used, stageUsed);
  if (!next.fits) { console.log(JSON.stringify({ stopped: "budget_exhausted", progressPath, reservation: next })); return; }
  const [{ default: OpenAI }, { getOpenAIEnv }] = await Promise.all([import("openai"), import("../lib/env")]);
  const client = new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: 0 });
  const attempt: Attempt = { requestId: request.requestId, identity, state: "dispatching", diagnostics: unknownExperimentDiagnostics(config.requests[request.requestId].maxOutputTokens, 0) };
  progress.attempts.push(attempt);
  saveCheckpoint(progressPath, progress);
  try {
    const response = await client.responses.parse({ model: modelId, input: [{ role: "system", content: CLAIMS_2_PROMPT }, { role: "user", content: serializeClaims2Request(request).payload }],
      text: { format: zodTextFormat(claims2OutputSchema, "test10_sweetwater_claims2_v3_output") }, max_output_tokens: config.requests[request.requestId].maxOutputTokens });
    const usage = modelCallUsage(response.model, response.id, response.usage);
    attempt.diagnostics = captureExperimentResponseDiagnostics(response, usage, config.requests[request.requestId].maxOutputTokens, 0);
    if (response.status !== "completed" || response.incomplete_details || !response.output_parsed) throw new Error("Incomplete or unparsed Claims-2 response");
    attempt.output = claims2OutputSchema.parse(response.output_parsed);
    if (assertKnownUsage(usage) > config.totalTokenBudget) throw new Error("Actual usage exceeded Test 10 v3 budget; checkpoint requires review");
    const validated = validateAndUnionClaims2([{ requestId: request.requestId, output: attempt.output }], [request]);
    attempt.state = "completed";
    saveCheckpoint(progressPath, progress);
    writeNewOrSame(resultPath, { sourceHash, fixtureHash: hash, inventoryHash, worksheetHash, manifestHash, identity, complete: true, usage, validated });
    console.log(JSON.stringify({ resultPath, progressPath, valid: validated.claims.length }));
  } catch (error) {
    attempt.state = "failed";
    attempt.error = error instanceof Error ? error.message : String(error);
    saveCheckpoint(progressPath, progress);
    throw error;
  }
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
