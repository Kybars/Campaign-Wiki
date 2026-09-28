import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { CLAIMS_2_BEHAVIOR_VERSION, claims2OutputSchema, claims2TokenDiagnostics, serializeClaims2Request, validateAndUnionClaims2 } from "../lib/ai/claims-2-experiment";
import { assertKnownUsage, parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics } from "../lib/ai/experiment-response";
import { modelCallUsage } from "../lib/ai/usage";
import { extractPdfPages } from "../lib/pdf/extract-text";
import { fixtureHash, planTest10Claims2, sha256, TEST10_FIXTURE_VERSION, TEST10_INVENTORY_VERSION, test10Identity, extractionContextFingerprint } from "../lib/ai/test10-claims2";

const sourcePath = "C:/Users/rynde/Documents/RPG/Demonplague/The Demonplague Sweetwater Village.pdf";
const directory = join(process.cwd(), "fixtures", "private", "test10-sweetwater-v1");
const fixturePath = join(directory, "fixture.v1.json");
const inventoryPath = join(directory, "inventory.v1.json");
const budgetPath = join(process.cwd(), "config", "test10-sweetwater-claims2-budget.json");
const preflightPath = join(directory, "preflight.v1.json");
const progressPath = join(directory, "progress.v1.json");
const resultPath = join(directory, "result.v1.json");
const modelId = "gpt-6-luna";
const live = process.argv.includes("--live-luna");
const save = (path: string, value: unknown) => { const tmp = `${path}.tmp`; writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); renameSync(tmp, path); };

async function main() {
  if (!existsSync(sourcePath)) throw new Error(`Exact local source is required: ${sourcePath}`);
  mkdirSync(directory, { recursive: true });
  const bytes = readFileSync(sourcePath);
  const sourceHash = sha256(bytes);
  const allPages = await extractPdfPages(bytes);
  const pages = allPages.filter((page) => page.pageNumber >= 6 && page.pageNumber <= 13);
  const hash = fixtureHash(pages);
  const fixture = { version: TEST10_FIXTURE_VERSION, sourcePath, sourceHash, fixtureHash: hash, pageCount: allPages.length, pages,
    anomalies: ["PDF page 6 text says the priests bound Ullae; preserve for human review rather than changing it to merath.", "PDF page 6 sidebar interrupts a sentence continued on page 7.", "PDF page 8 ends mid-skill-check; PDF page 9 resumes after a running header.", "Several extracted headings contain internal spaces, including Intro d uction and Sweetwater Vil lage.", "PDF page 11 contains extracted map caption text; no map content is included."] };
  if (existsSync(fixturePath)) {
    const prior = JSON.parse(readFileSync(fixturePath, "utf8"));
    if (prior.sourceHash !== sourceHash || prior.fixtureHash !== hash || JSON.stringify(prior.pages) !== JSON.stringify(pages)) throw new Error("Frozen Test 10 fixture changed; create a new version");
  } else save(fixturePath, fixture);
  if (!existsSync(inventoryPath)) throw new Error(`Proposed source inventory required: ${inventoryPath}`);
  const inventoryBytes = readFileSync(inventoryPath);
  const proposed = JSON.parse(inventoryBytes.toString("utf8"));
  if (proposed.version !== TEST10_INVENTORY_VERSION || !["proposed", "frozen"].includes(proposed.status)) throw new Error("Expected proposed or frozen Test 10 inventory v1");
  if (!Array.isArray(proposed.entities) || new Set(proposed.entities.map((entity: { id: string }) => entity.id)).size !== proposed.entities.length) throw new Error("Invalid or duplicate Test 10 inventory IDs");
  for (const entity of proposed.entities as Array<{ name: string; sourceReference: { physicalPdfPage: number; start: number; end: number; exactText: string } }>) {
    const reference = entity.sourceReference;
    const page = pages.find((item) => item.pageNumber === reference?.physicalPdfPage);
    if (!page || page.text.slice(reference.start, reference.end) !== reference.exactText) throw new Error(`Inventory evidence mismatch: ${entity.name}`);
  }
  const inventoryHash = sha256(inventoryBytes);
  const inventory: GraphInventory = { entities: proposed.entities.map((entity: { id: string; name: string; type: string; aliases: string[] }) => ({ temporary_id: entity.id, name: entity.name, type: entity.type, aliases: entity.aliases, sources: [] })) };
  const { context, request } = planTest10Claims2(pages, inventory);
  const config = parseExperimentBudgetConfig(JSON.parse(readFileSync(budgetPath, "utf8")), [request.requestId]);
  if (config.sdkMaxRetries !== 0) throw new Error("Test 10 requires zero SDK retries");
  const diagnostics = claims2TokenDiagnostics(request);
  const reservation = reserveExperimentRequest(config, request.requestId, diagnostics.estimatedTokens.totalInput, 0);
  const identity = test10Identity({ request, fixtureHash: hash, inventoryHash, contextFingerprint: extractionContextFingerprint(context), modelId });
  const preflight = { sourcePath, sourceHash, fixtureHash: hash, inventoryHash, fixtureVersion: TEST10_FIXTURE_VERSION, inventoryVersion: TEST10_INVENTORY_VERSION,
    inventoryStatus: proposed.status, modelId, behaviorVersion: CLAIMS_2_BEHAVIOR_VERSION, pages: pages.map((page) => ({ page: page.pageNumber, characters: page.text.length })),
    chunks: [{ requestId: request.requestId, pages: pages.map((page) => page.pageNumber), sections: ["Introduction / Background", "Village Ruins", "Temple Catacombs", "Conclusion"], evidenceUnits: request.evidenceUnits.length, inventorySize: request.entities.length, diagnostics, maxOutputTokens: config.requests[request.requestId].maxOutputTokens, reservation, checkpointIdentity: identity }],
    totalEstimatedInputTokens: diagnostics.estimatedTokens.totalInput, totalConfiguredOutputTokens: config.requests[request.requestId].maxOutputTokens,
    configuredRunBudget: config.totalTokenBudget, sdkMaxRetries: config.sdkMaxRetries, anomalies: fixture.anomalies };
  save(preflightPath, preflight);
  if (!live) { console.log(JSON.stringify({ fixturePath, inventoryPath, preflightPath, preflight }, null, 2)); return; }
  if (process.env.ALLOW_PAID_TEST10_SWEETWATER_CLAIMS2_LUNA !== "1") throw new Error("Explicit Test 10 paid-run authorization required");
  // The proposed inventory must be reviewed and frozen before any paid dispatch.
  if (proposed.status !== "frozen") throw new Error("Inventory remains proposed; review and freeze a new version before paid dispatch");
  type Attempt = { requestId: string; identity: typeof identity; state: "dispatching" | "completed" | "failed"; diagnostics: ReturnType<typeof unknownExperimentDiagnostics>; output?: unknown; error?: string };
  const progress: { sourceHash: string; fixtureHash: string; inventoryHash: string; attempts: Attempt[] } = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { sourceHash, fixtureHash: hash, inventoryHash, attempts: [] };
  if (progress.sourceHash !== sourceHash || progress.fixtureHash !== hash || progress.inventoryHash !== inventoryHash) throw new Error("Test 10 checkpoint fixture/inventory mismatch");
  for (const attempt of progress.attempts) {
    if (JSON.stringify(attempt.identity) !== JSON.stringify(identity)) throw new Error("Test 10 checkpoint identity mismatch");
    if (attempt.state === "completed") { claims2OutputSchema.parse(attempt.output); assertKnownUsage(attempt.diagnostics.usage as Parameters<typeof assertKnownUsage>[0]); }
  }
  const pending = pendingExperimentRequests([request.requestId], progress.attempts);
  if (!pending.length) { console.log(JSON.stringify({ stopped: "already_complete", progressPath })); return; }
  const actualUsed = progress.attempts.reduce((sum, attempt) => sum + assertKnownUsage(attempt.diagnostics.usage as Parameters<typeof assertKnownUsage>[0]), 0);
  const next = reserveExperimentRequest(config, request.requestId, diagnostics.estimatedTokens.totalInput, actualUsed);
  if (!next.fits) { console.log(JSON.stringify({ stopped: "budget_exhausted", progressPath, reservation: next })); return; }
  const attempt: Attempt = { requestId: request.requestId, identity, state: "dispatching", diagnostics: unknownExperimentDiagnostics(config.requests[request.requestId].maxOutputTokens, 0) };
  progress.attempts.push(attempt); save(progressPath, progress);
  try {
    const client = new OpenAI({ maxRetries: 0 });
    const response = await client.responses.parse({ model: modelId, input: [{ role: "system", content: (await import("../lib/ai/claims-2-experiment")).CLAIMS_2_PROMPT }, { role: "user", content: serializeClaims2Request(request).payload }], text: { format: zodTextFormat(claims2OutputSchema, "test10_sweetwater_claims2_output") }, max_output_tokens: config.requests[request.requestId].maxOutputTokens });
    const usage = modelCallUsage(response.model, response.id, response.usage);
    attempt.diagnostics = captureExperimentResponseDiagnostics(response, usage, config.requests[request.requestId].maxOutputTokens, 0);
    if (response.status !== "completed" || response.incomplete_details || !response.output_parsed) throw new Error("Incomplete or unparsed response");
    attempt.output = claims2OutputSchema.parse(response.output_parsed);
    if (assertKnownUsage(usage) > config.totalTokenBudget) throw new Error("Actual usage exceeded Test 10 budget; preserve checkpoint for review");
    attempt.state = "completed"; save(progressPath, progress);
    const validated = validateAndUnionClaims2([{ requestId: request.requestId, output: attempt.output as ReturnType<typeof claims2OutputSchema.parse> }], [request]);
    save(resultPath, { sourceHash, fixtureHash: hash, inventoryHash, identity, complete: true, usage, validated });
    console.log(JSON.stringify({ resultPath, progressPath, valid: validated.claims.length }));
  } catch (error) {
    attempt.state = "failed"; attempt.error = error instanceof Error ? error.message : String(error); save(progressPath, progress); throw error;
  }
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
