import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { zodTextFormat } from "openai/helpers/zod";
import { CLAIMS_2_BEHAVIOR_VERSION, CLAIMS_2_PROMPT, CLAIMS_2_SCHEMA_VERSION, claims2CheckpointIdentity, claims2OutputSchema,
  claims2TokenDiagnostics, serializeClaims2Request, validateAndUnionClaims2, type Claims2Output } from "../lib/ai/claims-2-experiment";
import { extractionContextFingerprint } from "../lib/ai/extraction-context";
import { assertKnownUsage, parseExperimentBudgetConfig, pendingExperimentRequests, reserveExperimentRequest } from "../lib/ai/experiment-budget";
import { captureExperimentResponseDiagnostics, unknownExperimentDiagnostics, type ExperimentResponseDiagnostics } from "../lib/ai/experiment-response";
import { planTalesClaims2, TALES_PAGES } from "../lib/ai/test11-tales-claims2";
import { modelCallUsage, type ModelCallUsage } from "../lib/ai/usage";
import { extractPdfPages } from "../lib/pdf/extract-text";

loadEnvConfig(process.cwd());
const modelId = "gpt-6-luna";
const sourcePath = join(process.cwd(), "fixtures/private/narrative-dev/Tales_of_the_Demon_Lord_no_bkgd_v6-5-16 (1).pdf");
const developmentPath = join(process.cwd(), "fixtures/private/narrative-dev");
const directory = join(process.cwd(), "fixtures/private/test11-tales-claims2-v1");
const inventoryPath = join(directory, "inventory.v1.json");
const manifestPath = join(directory, "evidence-units.v1.json");
const preflightPath = join(directory, "preflight.v1.json");
// The original progress.v1.json records a connection failure with unknown usage.
// A matching probe reproduced a TLS certificate failure; preserve that checkpoint
// verbatim and use a separate single-dispatch checkpoint with the system CA.
const progressPath = join(directory, "progress.system-ca.v1.json");
const resultPath = join(directory, "result.v1.json");
const budgetPath = join(process.cwd(), "config/test11-tales-claims2-budget.json");
const live = process.argv.includes("--live-luna");
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

function writeNewOrSame(path: string, value: unknown) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== bytes) throw new Error(`Frozen private artifact changed: ${path}`);
    return;
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, path);
}
function save(path: string, value: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

type SourcePage = { physicalPdfPage: number; rawText: string };
type ScoreEntity = { id: string; sample: string; name: string; type: string; physicalPdfPage: number };
type InventoryEntry = { id: string; name: string; type: string; aliases: string[]; sourceReference: { physicalPdfPage: number; start: number; end: number; exactText: string } };

async function main() {
  mkdirSync(directory, { recursive: true });
  const pdfBytes = readFileSync(sourcePath);
  const sourceHash = sha256(pdfBytes);
  if (sourceHash !== "07f3bda14d7375f3da6f008aa499bc0fe2ee90e7183e11f2a64eeeb96fdf3377") throw new Error("Tales source PDF hash changed");
  const pages = (await extractPdfPages(pdfBytes)).filter((page) => TALES_PAGES.includes(page.pageNumber as typeof TALES_PAGES[number]));
  if (pages.length !== 4 || pages.some((page, index) => page.pageNumber !== TALES_PAGES[index])) throw new Error("Missing Tales physical PDF page");
  const sourceFixture = JSON.parse(readFileSync(join(developmentPath, "cleaned-source-inputs-v1.json"), "utf8")) as { samples: Array<{ sample: string; pages: SourcePage[] }> };
  const prior = sourceFixture.samples.find((sample) => sample.sample === "TALES");
  if (!prior || prior.pages.length !== 4 || prior.pages.some((page, index) => page.physicalPdfPage !== pages[index].pageNumber || page.rawText !== pages[index].text)) {
    throw new Error("Current PDF.js extraction differs from the existing development source checkpoint");
  }
  const scoring = JSON.parse(readFileSync(join(developmentPath, "campaign_wiki_DEV_scoring.json"), "utf8")) as { entities: ScoreEntity[] };
  const canonical = scoring.entities.filter((entity) => entity.sample === "TALES");
  if (canonical.length !== 27) throw new Error("Existing Tales development entity inventory changed");
  const extras = [
    { id: "TALES-C2-E28", name: "Party", type: "other", physicalPdfPage: 27, anchor: "The player characters complete", aliases: ["player characters"] },
    { id: "TALES-C2-E29", name: "Old Faith", type: "faction", physicalPdfPage: 27, anchor: "Old Faith", aliases: [] },
    { id: "TALES-C2-E30", name: "Cult of the New God", type: "faction", physicalPdfPage: 28, anchor: "Cult of the New God", aliases: [] },
    { id: "TALES-C2-E31", name: "Crusaders", type: "faction", physicalPdfPage: 28, anchor: "crusaders", aliases: [] },
  ];
  const proposed = [...canonical.map((entity) => ({ ...entity, anchor: entity.name, aliases: [] as string[] })), ...extras];
  const inventory: { version: number; status: string; sourceHash: string; entities: InventoryEntry[] } = {
    version: 1, status: "frozen", sourceHash,
    entities: proposed.map((entity) => {
      const page = pages.find((item) => item.pageNumber === entity.physicalPdfPage);
      if (!page) throw new Error(`Missing source page for ${entity.name}`);
      const needle = entity.name === "Stop the Black Thorn sacrifice" ? "The player characters complete" : entity.anchor;
      const start = page.text.toLocaleLowerCase("en-US").indexOf(needle.toLocaleLowerCase("en-US"));
      if (start < 0) throw new Error(`No literal source grounding for ${entity.name}`);
      const end = start + needle.length;
      return { id: entity.id, name: entity.name, type: entity.type, aliases: entity.aliases,
        sourceReference: { physicalPdfPage: page.pageNumber, start, end, exactText: page.text.slice(start, end) } };
    }),
  };
  if (new Set(inventory.entities.map((entity) => entity.id)).size !== inventory.entities.length ||
      new Set(inventory.entities.map((entity) => entity.name.toLocaleLowerCase("en-US"))).size !== inventory.entities.length) throw new Error("Duplicate Tales inventory identity");
  writeNewOrSame(inventoryPath, inventory);
  const inventoryHash = sha256(readFileSync(inventoryPath));
  const entities = inventory.entities.map((entity) => ({ canonicalId: entity.id, name: entity.name, type: entity.type, aliases: entity.aliases }));
  const request = planTalesClaims2(pages, entities);
  const manifest = { version: 1, sourceHash, pages: pages.map((page) => page.pageNumber), requestId: request.requestId,
    units: request.evidenceUnits.map((unit) => ({ unitId: unit.unitId, page: unit.page, kind: unit.kind, order: unit.order,
      context: unit.context, start: unit.rawSource.start, end: unit.rawSource.end, exactText: unit.rawSource.text, modelText: unit.text })) };
  writeNewOrSame(manifestPath, manifest);
  const manifestHash = sha256(readFileSync(manifestPath));
  const fixtureHash = sha256(JSON.stringify({ version: 1, pages }));
  const contextFingerprint = extractionContextFingerprint({ entities, sourceSegments: pages.map((page) => ({
    segmentId: `p${page.pageNumber}`, page: page.pageNumber, semanticText: page.text,
    rawSource: { page: page.pageNumber, start: 0, end: page.text.length, text: page.text },
  })) });
  const baseIdentity = claims2CheckpointIdentity({ request, fixtureHash, contextFingerprint, modelId });
  const identity = { ...baseIdentity, campaignId: "test11-tales-claims2-v1-fixture", operationType: "test11_claims_2_experiment_v1",
    upstreamFingerprint: sha256(JSON.stringify({ base: baseIdentity.upstreamFingerprint, sourceHash, inventoryHash, manifestHash })) };
  const budget = parseExperimentBudgetConfig(JSON.parse(readFileSync(budgetPath, "utf8")), [request.requestId]);
  if (budget.sdkMaxRetries !== 0) throw new Error("Tales Claims-2 requires zero SDK retries");
  const diagnostics = claims2TokenDiagnostics(request);
  const reservation = reserveExperimentRequest(budget, request.requestId, diagnostics.estimatedTokens.totalInput, 0);
  const moneyCapUsd = 0.03;
  const conservativeUsd = (reservation.reservedInputTokens * 0.275 + reservation.maxOutputTokens * 0.825) / 1_000_000;
  const preflight = { sourceHash, fixtureHash, inventoryHash, manifestHash, modelId, behaviorVersion: CLAIMS_2_BEHAVIOR_VERSION,
    schemaVersion: CLAIMS_2_SCHEMA_VERSION, sdkMaxRetries: budget.sdkMaxRetries,
    request: { requestId: request.requestId, pages: [...TALES_PAGES], evidenceUnits: request.evidenceUnits.length,
      inventorySize: entities.length, diagnostics, maxOutputTokens: reservation.maxOutputTokens, reservation, checkpointIdentity: identity },
    monetary: { capUsd: moneyCapUsd, conservativeRateInputUsdPerMillion: 0.275, conservativeRateOutputUsdPerMillion: 0.825,
      preDispatchReservationUsd: conservativeUsd },
    sharedPriorExperiment: "Narrative tournament authorization and unresolved checkpoint are separate; neither authorizes Claims-2.",
    knownInputDifferences: ["Four-page single request; historical WotBS used two requests over five pages.",
      "The Tales planner removes repeated running headers, footer and trailing PDF.js artifact fragments while retaining raw-page citation offsets.",
      "Section contexts follow printed headings; page 29 relationship diagram is image-only and is not model input.",
      "Existing 27 development canonical names are supplemented by four source-grounded participants, including Party."],
    runnable: reservation.fits && conservativeUsd <= moneyCapUsd };
  writeNewOrSame(preflightPath, preflight);
  if (!live) { console.log(JSON.stringify({ preflightPath, inventoryPath, manifestPath, preflight }, null, 2)); return; }
  if (process.env.ALLOW_PAID_TEST11_TALES_CLAIMS2_LUNA !== "1") throw new Error("Explicit Tales Claims-2 paid-run authorization required");
  if (!preflight.runnable) throw new Error("Tales Claims-2 token or monetary reservation does not fit");
  type Attempt = { requestId: string; identity: typeof identity; state: "dispatching" | "completed" | "failed";
    diagnostics: ExperimentResponseDiagnostics; output?: Claims2Output; error?: string };
  const progress: { sourceHash: string; fixtureHash: string; inventoryHash: string; manifestHash: string; attempts: Attempt[] } = existsSync(progressPath)
    ? JSON.parse(readFileSync(progressPath, "utf8")) : { sourceHash, fixtureHash, inventoryHash, manifestHash, attempts: [] };
  if (progress.sourceHash !== sourceHash || progress.fixtureHash !== fixtureHash || progress.inventoryHash !== inventoryHash || progress.manifestHash !== manifestHash) throw new Error("Tales checkpoint input changed");
  for (const attempt of progress.attempts) {
    if (JSON.stringify(attempt.identity) !== JSON.stringify(identity)) throw new Error("Tales checkpoint identity changed");
    if (attempt.state === "completed") { claims2OutputSchema.parse(attempt.output); assertKnownUsage(attempt.diagnostics.usage as ModelCallUsage); }
  }
  if (!pendingExperimentRequests([request.requestId], progress.attempts).length) {
    const completed = progress.attempts[0];
    const validated = validateAndUnionClaims2([{ requestId: request.requestId, output: completed.output! }], [request]);
    writeNewOrSame(resultPath, { sourceHash, fixtureHash, inventoryHash, manifestHash, identity, complete: true,
      usage: completed.diagnostics.usage, validated });
    console.log(JSON.stringify({ stopped: "already_complete", progressPath, resultPath })); return;
  }
  const [{ default: OpenAI }, { getOpenAIEnv }] = await Promise.all([import("openai"), import("../lib/env")]);
  const client = new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY, maxRetries: 0 });
  const attempt: Attempt = { requestId: request.requestId, identity, state: "dispatching", diagnostics: unknownExperimentDiagnostics(reservation.maxOutputTokens, 0) };
  progress.attempts.push(attempt); save(progressPath, progress);
  try {
    const response = await client.responses.parse({ model: modelId, input: [
      { role: "system", content: CLAIMS_2_PROMPT }, { role: "user", content: serializeClaims2Request(request).payload },
    ], text: { format: zodTextFormat(claims2OutputSchema, "test11_tales_claims2_output") }, max_output_tokens: reservation.maxOutputTokens });
    const usage = modelCallUsage(response.model, response.id, response.usage);
    attempt.diagnostics = captureExperimentResponseDiagnostics(response, usage, reservation.maxOutputTokens, 0);
    if (response.status !== "completed" || response.incomplete_details || !response.output_parsed) throw new Error("Incomplete or unparsed Claims-2 response");
    attempt.output = claims2OutputSchema.parse(response.output_parsed);
    if (assertKnownUsage(usage) > budget.totalTokenBudget ||
        ((usage.inputTokens! * 0.275 + usage.outputTokens! * 0.825) / 1_000_000) > moneyCapUsd) throw new Error("Actual usage exceeded Tales cap; checkpoint preserved");
    attempt.state = "completed"; save(progressPath, progress);
    const validated = validateAndUnionClaims2([{ requestId: request.requestId, output: attempt.output }], [request]);
    writeNewOrSame(resultPath, { sourceHash, fixtureHash, inventoryHash, manifestHash, identity, complete: true, usage, validated });
    console.log(JSON.stringify({ resultPath, progressPath, proposed: validated.proposed, valid: validated.claims.length }));
  } catch (error) {
    attempt.state = "failed"; attempt.error = error instanceof Error ? error.message : String(error); save(progressPath, progress); throw error;
  }
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
