import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claims2OutputSchema, claims2TokenDiagnostics } from "../lib/ai/claims-2-experiment";
import { assertKnownUsage, parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { fixtureHash, sha256 } from "../lib/ai/test10-claims2";
import { planTest10Claims2V2, TEST10_INVENTORY_VERSION_V2, TEST10_PLAN_VERSION, TEST10_WORKSHEET_VERSION_V2, test10V2Identity, type Test10InventoryEntry } from "../lib/ai/test10-claims2-v2";
import { extractPdfPages } from "../lib/pdf/extract-text";

const directory = join(process.cwd(), "fixtures", "private", "test10-sweetwater-v1");
const sourcePath = "C:/Users/rynde/Documents/RPG/Demonplague/The Demonplague Sweetwater Village.pdf";
const priorFixturePath = join(directory, "fixture.v1.json");
const inventoryPath = join(directory, "inventory.v2.json");
const worksheetPath = join(directory, "annotation-worksheet.v2.json");
const manifestPath = join(directory, "evidence-units.v2.json");
const preflightPath = join(directory, "preflight.v2.json");
const progressPath = join(directory, "progress.v2.json");
const budgetPath = join(process.cwd(), "config", "test10-sweetwater-claims2-budget.v2.json");
const modelId = "gpt-6-luna";
const writeNewOrSame = (path: string, value: unknown) => {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== bytes) throw new Error(`Versioned artifact already exists with different content: ${path}`);
    return;
  }
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
};

async function main() {
  if (process.argv.includes("--live-luna")) throw new Error("Test 10 v2 remains an offline proposal; source-scoped cross-chunk context requires review before paid dispatch");
  const prior = JSON.parse(readFileSync(priorFixturePath, "utf8"));
  const sourceBytes = readFileSync(sourcePath);
  const sourceHash = sha256(sourceBytes);
  if (sourceHash !== prior.sourceHash) throw new Error("Original Sweetwater PDF hash changed");
  const pages = (await extractPdfPages(sourceBytes)).filter((page) => page.pageNumber >= 6 && page.pageNumber <= 13);
  const hash = fixtureHash(pages);
  if (hash !== prior.fixtureHash || JSON.stringify(pages) !== JSON.stringify(prior.pages)) throw new Error("Original Test 10 extracted fixture changed");
  const inventoryBytes = readFileSync(inventoryPath);
  const inventory = JSON.parse(inventoryBytes.toString("utf8")) as { version: number; status: string; entities: Test10InventoryEntry[] };
  if (inventory.version !== TEST10_INVENTORY_VERSION_V2 || inventory.status !== "proposed") throw new Error("Expected proposed Test 10 inventory v2");
  const names = new Set(inventory.entities.map((entity) => entity.name));
  if (names.size !== inventory.entities.length || new Set(inventory.entities.map((entity) => entity.id)).size !== names.size) throw new Error("Duplicate inventory name or ID");
  for (const entity of inventory.entities) {
    if (entity.aliases.some((alias) => alias.toLowerCase() === "the merath" || alias.toLowerCase() === "the nymph")) throw new Error("Descriptive references cannot be global aliases");
    for (const reference of [entity.sourceReference, ...(entity.sourceScopedIdentification ?? []).flatMap((item) => item.evidence)] as Array<{ physicalPdfPage: number; start: number; end: number; exactText: string }>) {
      const page = pages.find((candidate) => candidate.pageNumber === reference.physicalPdfPage);
      if (!page || page.text.slice(reference.start, reference.end) !== reference.exactText) throw new Error(`Inventory evidence mismatch: ${entity.name}`);
    }
  }
  const worksheetBytes = readFileSync(worksheetPath);
  type Reference = { physicalPdfPage: number; start: number; end: number; exactText: string };
  const worksheet = JSON.parse(worksheetBytes.toString("utf8")) as { version: number; status: string; rows: Array<{ id: string; materialEntities: string[]; evidenceSpans: Reference[]; sourceScopedEntityEvidence?: Reference[]; scoringDisposition: string }> };
  const oldWorksheet = JSON.parse(readFileSync(join(directory, "annotation-worksheet.v1.json"), "utf8"));
  if (worksheet.version !== TEST10_WORKSHEET_VERSION_V2 || worksheet.status !== "proposed" || worksheet.rows.map((row) => row.id).join() !== oldWorksheet.rows.map((row: { id: string }) => row.id).join()) throw new Error("Worksheet row selection or order changed");
  for (const row of worksheet.rows) {
    if (row.materialEntities.some((name) => !names.has(name))) throw new Error(`Noncanonical worksheet entity: ${row.id}`);
    for (const reference of [...row.evidenceSpans, ...(row.sourceScopedEntityEvidence ?? [])]) {
      const page = pages.find((candidate) => candidate.pageNumber === reference.physicalPdfPage);
      if (!page || page.text.slice(reference.start, reference.end) !== reference.exactText) throw new Error(`Worksheet evidence mismatch: ${row.id}`);
    }
  }
  if (worksheet.rows.find((row) => row.id === "SW10-21")?.scoringDisposition !== "merged_not_independent" || worksheet.rows.find((row) => row.id === "SW10-36")?.scoringDisposition !== "merged_not_independent") throw new Error("Merged reference rows must not be independently scored");
  const inventoryHash = sha256(inventoryBytes);
  const worksheetHash = sha256(worksheetBytes);
  const plan = planTest10Claims2V2(pages, inventory.entities);
  const manifest = { version: TEST10_PLAN_VERSION, sourceHash, fixtureHash: hash, inventoryHash, chunks: plan.requests.map((request) => ({ requestId: request.requestId, pages: [...new Set(request.evidenceUnits.map((unit) => unit.page))] })),
    units: plan.units.map((unit) => ({ id: unit.unitId, chunkId: plan.requests.find((request) => request.evidenceUnits.some((item) => item.unitId === unit.unitId))!.requestId,
      page: unit.page, start: unit.rawSource.start, end: unit.rawSource.end, exactText: unit.rawSource.text, text: unit.text, kind: unit.kind, inheritedContext: unit.context })) };
  writeNewOrSame(manifestPath, manifest);
  const manifestHash = sha256(readFileSync(manifestPath));
  const config = parseExperimentBudgetConfig(JSON.parse(readFileSync(budgetPath, "utf8")), plan.requests.map((request) => request.requestId));
  if (config.sdkMaxRetries !== 0) throw new Error("Test 10 requires zero SDK retries");
  const chunks = plan.requests.map((request) => {
    const diagnostics = claims2TokenDiagnostics(request);
    const reservation = reserveExperimentRequest(config, request.requestId, diagnostics.estimatedTokens.totalInput, 0);
    return { requestId: request.requestId, pages: [...new Set(request.evidenceUnits.map((unit) => unit.page))], evidenceUnits: request.evidenceUnits.length,
      inventorySize: request.entities.length, diagnostics, maxOutputTokens: config.requests[request.requestId].maxOutputTokens, reservation,
      checkpointIdentity: test10V2Identity({ request, fixtureHash: hash, inventoryHash, manifestHash, contextFingerprint: plan.contextFingerprint, modelId }) };
  });
  const totalReserved = chunks.reduce((sum, chunk) => sum + chunk.reservation.reservedTokens, 0);
  const preflight = { version: TEST10_PLAN_VERSION, sourcePath, sourceHash, fixtureHash: hash, inventoryHash, worksheetHash, manifestHash,
    inventoryStatus: inventory.status, worksheetStatus: worksheet.status, modelId, sdkMaxRetries: 0, chunks, contextGaps: plan.contextGaps,
    runnable: plan.contextGaps.length === 0 && totalReserved <= config.totalTokenBudget,
    totals: { estimatedInputTokens: chunks.reduce((sum, chunk) => sum + chunk.diagnostics.estimatedTokens.totalInput, 0),
      configuredOutputTokens: chunks.reduce((sum, chunk) => sum + chunk.maxOutputTokens, 0), reservedTokens: totalReserved, configuredRunBudget: config.totalTokenBudget } };
  writeNewOrSame(preflightPath, preflight);
  if (existsSync(progressPath)) {
    const progress = JSON.parse(readFileSync(progressPath, "utf8")) as { sourceHash: string; fixtureHash: string; inventoryHash: string; manifestHash: string; attempts: Array<{ requestId: string; identity: unknown; state: "dispatching" | "completed" | "failed"; output?: unknown; usage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } }> };
    if (progress.sourceHash !== sourceHash || progress.fixtureHash !== hash || progress.inventoryHash !== inventoryHash || progress.manifestHash !== manifestHash) throw new Error("Saved Test 10 v2 checkpoint identity mismatch");
    for (const attempt of progress.attempts) {
      const expected = chunks.find((chunk) => chunk.requestId === attempt.requestId)?.checkpointIdentity;
      if (!expected || JSON.stringify(expected) !== JSON.stringify(attempt.identity)) throw new Error("Saved Test 10 v2 operation identity mismatch");
      if (attempt.state === "completed") { claims2OutputSchema.parse(attempt.output); assertKnownUsage(attempt.usage!); }
    }
    pendingExperimentRequests(chunks.map((chunk) => chunk.requestId), progress.attempts);
  }
  console.log(JSON.stringify({ manifestPath, preflightPath, preflight }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
