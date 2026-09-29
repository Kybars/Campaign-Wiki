import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GraphInventory } from "@/lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "@/lib/ai/extraction-context";
import { claims2CheckpointIdentity, claims2TokenDiagnostics, planTest9Claims2Requests, validateAndUnionClaims2, type Claims2Request } from "@/lib/ai/claims-2-experiment";
import { planTest10Claims2V3 } from "@/lib/ai/test10-claims2-v3";
import { planTalesClaims2 } from "@/lib/ai/test11-tales-claims2";
import { fixtureHash as sweetwaterFixtureHash } from "@/lib/ai/test10-claims2";
import { cleanDocumentPagesForModel } from "@/lib/pdf/model-text";
import { extractPdfPages } from "@/lib/pdf/extract-text";
import { planClaims3Request, claims3CheckpointIdentity, claims3PromptHash, claims3SchemaHash, claims3TokenDiagnostics, type Claims3Request } from "@/lib/ai/claims-3-experiment";

const privateRoot = join(process.cwd(), "fixtures", "private");
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function read(path: string) { if (!existsSync(path)) throw new Error(`Required private Claims-2 artifact missing: ${path}`); return JSON.parse(readFileSync(path, "utf8")); }
function same(a: unknown, b: unknown, message: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message); }
function pagesOf(request: Claims2Request) { return [...new Set(request.evidenceUnits.map((unit) => unit.page))]; }
function verifyRaw(request: Claims2Request, pages: Array<{ pageNumber: number; text: string }>) {
  for (const unit of request.evidenceUnits) {
    const page = pages.find((item) => item.pageNumber === unit.page);
    if (!page || page.text.slice(unit.rawSource.start, unit.rawSource.end) !== unit.rawSource.text || unit.rawSource.page !== unit.page) throw new Error(`Invalid physical-page mapping: ${unit.unitId}`);
  }
}
async function pdfPages(file: string, expected: number[]) {
  if (!existsSync(file)) throw new Error(`Required private source PDF missing: ${file}`);
  const bytes = readFileSync(file);
  const pages = (await extractPdfPages(bytes)).filter((page) => expected.includes(page.pageNumber));
  same(pages.map((page) => page.pageNumber), expected, `PDF page coverage changed: ${file}`);
  return { pages, sourceHash: sha(bytes), sourcePath: file };
}

export interface FrozenClaims3Benchmark {
  name: string; sourcePath: string; sourceHash: string; fixtureHash: string; inventoryVersion: string; inventoryHash: string;
  manifestHash: string; baselineResultPath: string; baselineResultHash: string; baselineProgressPath: string; baselineComplete: boolean;
  baselineRequestIds: string[]; baselinePages: number[][]; baselineUnits: number[]; baselineInputEstimates: number[];
  inputDifferences: string[]; requests: Claims3Request[];
}

export async function loadFrozenClaims3Benchmarks(): Promise<FrozenClaims3Benchmark[]> {
  const modelId = "gpt-6-luna";
  const wdir = join(privateRoot, "test9-focused-ab");
  const wfixture = read(join(wdir, "fixture.json"));
  const wpdf = await pdfPages(join(privateRoot, "narrative-dev", "WotBS - Campaign Guide (1).pdf"), [10, 11, 12, 13, 14]);
  same(wpdf.pages, wfixture.pages, "WotBS PDF differs from frozen Claims-2 fixture");
  const wfixtureContent = { pages: wfixture.pages, inventory: wfixture.inventory, reference: wfixture.reference, baseline_raw: wfixture.baseline_raw, baseline_usage: wfixture.baseline_usage };
  if (sha(JSON.stringify(wfixtureContent)) !== wfixture.fixture_hash) throw new Error("WotBS fixture hash changed");
  const winventory: GraphInventory = { entities: wfixture.inventory.map((entity: { temporary_id: string }) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
  const wcontext = buildExtractionContext(cleanDocumentPagesForModel(wfixture.pages).pages, winventory);
  const wrequests = planTest9Claims2Requests(wcontext);
  same(wrequests.map(pagesOf), [[10, 11, 12], [13, 14]], "WotBS request boundaries changed");
  wrequests.forEach((request) => verifyRaw(request, wfixture.pages));
  const wpreflight = read(join(wdir, "claims2-v067-preflight.json"));
  const wprogressPath = join(wdir, "claims2-v067-progress.json");
  const wprogress = read(wprogressPath);
  const wresultPath = join(wdir, "claims2-v067-result.json");
  const wresult = read(wresultPath);
  same(wpreflight.chunks.map((item: { requestId: string; pages: number[]; units: number }) => [item.requestId, item.pages, item.units]),
    wrequests.map((request) => [request.requestId, pagesOf(request), request.evidenceUnits.length]), "WotBS Claims-2 preflight changed");
  const widentities = wrequests.map((request) => claims2CheckpointIdentity({ request, fixtureHash: wfixture.fixture_hash, contextFingerprint: extractionContextFingerprint(wcontext), modelId }));
  same(wprogress.completed.map((item: { requestId: string; identity: unknown }) => [item.requestId, item.identity]), wrequests.map((request, i) => [request.requestId, widentities[i]]), "WotBS Claims-2 completed checkpoints changed");
  if (wresult.valid !== 147 || wresult.totalTokens !== 17168 || wresult.preflight.fixtureHash !== wfixture.fixture_hash) throw new Error("WotBS Claims-2 result incomplete");
  if (validateAndUnionClaims2(wprogress.completed, wrequests).claims.length !== wresult.valid) throw new Error("WotBS saved Claims-2 output no longer validates");

  const sdir = join(privateRoot, "test10-sweetwater-v1");
  const sfixture = read(join(sdir, "fixture.v1.json"));
  const spdf = await pdfPages(join(privateRoot, "narrative-dev", "The Demonplague Sweetwater Village(1).pdf"), [6, 7, 8, 9, 10, 11, 12, 13]);
  if (spdf.sourceHash !== sfixture.sourceHash) throw new Error("Sweetwater source hash changed");
  same(spdf.pages, sfixture.pages, "Sweetwater PDF differs from frozen Claims-2 fixture");
  if (sweetwaterFixtureHash(spdf.pages) !== sfixture.fixtureHash) throw new Error("Sweetwater extracted fixture hash changed");
  const sinventoryPath = join(sdir, "inventory.v3.frozen.json");
  const sinventory = read(sinventoryPath);
  if (sinventory.version !== 2 || sinventory.status !== "frozen" || sinventory.benchmarkVersion !== 3) throw new Error("Sweetwater v3 inventory is not frozen");
  const sinventoryHash = sha(readFileSync(sinventoryPath));
  const splan = planTest10Claims2V3(sfixture.pages, sinventory.entities);
  const srequest = splan.request;
  same(pagesOf(srequest), [6, 7, 8, 9, 10, 11, 12, 13], "Sweetwater request boundary changed");
  verifyRaw(srequest, sfixture.pages);
  const smanifestPath = join(sdir, "evidence-units.v3.json");
  const smanifest = read(smanifestPath);
  same(smanifest.units.map((item: { id: string; page: number; start: number; end: number; exactText: string }) => [item.id, item.page, item.start, item.end, item.exactText]),
    srequest.evidenceUnits.map((unit) => [unit.unitId, unit.page, unit.rawSource.start, unit.rawSource.end, unit.rawSource.text]), "Sweetwater evidence manifest changed");
  const smanifestHash = sha(readFileSync(smanifestPath));
  const spreflight = read(join(sdir, "preflight.v3.json"));
  const sprogressPath = join(sdir, "progress.v3.json");
  const sprogress = read(sprogressPath);
  const sresultPath = join(sdir, "result.v3.json");
  const sresult = read(sresultPath);
  if (spreflight.chunk.requestId !== srequest.requestId || spreflight.chunk.evidenceUnits !== srequest.evidenceUnits.length || spreflight.sourceHash !== spdf.sourceHash ||
      spreflight.inventoryHash !== sinventoryHash || spreflight.manifestHash !== smanifestHash || sresult.complete !== true ||
      sresult.sourceHash !== spdf.sourceHash || sresult.inventoryHash !== sinventoryHash || sresult.manifestHash !== smanifestHash ||
      sprogress.attempts.length !== 1 || sprogress.attempts[0].state !== "completed" || sprogress.attempts[0].requestId !== srequest.requestId ||
      JSON.stringify(sprogress.attempts[0].identity) !== JSON.stringify(sresult.identity) ||
      JSON.stringify(spreflight.chunk.checkpointIdentity) !== JSON.stringify(sresult.identity)) throw new Error("Sweetwater v3 Claims-2 baseline incomplete or changed");
  if (validateAndUnionClaims2([{ requestId: srequest.requestId, output: sprogress.attempts[0].output }], [srequest]).claims.length !== sresult.validated.claims.length) throw new Error("Sweetwater saved Claims-2 output no longer validates");
  const sv2 = read(join(sdir, "preflight.v2.json"));
  if (sv2.chunks?.length !== 2 || sv2.runnable !== false) throw new Error("Sweetwater v2 is no longer the blocked two-request proposal");

  const tdir = join(privateRoot, "test11-tales-claims2-v1");
  const tpdf = await pdfPages(join(privateRoot, "narrative-dev", "Tales_of_the_Demon_Lord_no_bkgd_v6-5-16 (1).pdf"), [27, 28, 29, 30]);
  const talesFixtureHash = sha(JSON.stringify({ version: 1, pages: tpdf.pages }));
  const tinventoryPath = join(tdir, "inventory.v1.json");
  const tinventory = read(tinventoryPath);
  if (tinventory.version !== 1 || tinventory.status !== "frozen" || tinventory.sourceHash !== tpdf.sourceHash) throw new Error("Tales inventory changed");
  const tinventoryHash = sha(readFileSync(tinventoryPath));
  const trequest = planTalesClaims2(tpdf.pages, tinventory.entities.map((entity: { id: string; name: string; type: string; aliases: string[] }) => ({ canonicalId: entity.id, name: entity.name, type: entity.type, aliases: entity.aliases })));
  same(pagesOf(trequest), [27, 28, 29, 30], "Tales request boundary changed");
  verifyRaw(trequest, tpdf.pages);
  const tmanifestPath = join(tdir, "evidence-units.v1.json");
  const tmanifest = read(tmanifestPath);
  same(tmanifest.units.map((item: { unitId: string; page: number; start: number; end: number; exactText: string }) => [item.unitId, item.page, item.start, item.end, item.exactText]),
    trequest.evidenceUnits.map((unit) => [unit.unitId, unit.page, unit.rawSource.start, unit.rawSource.end, unit.rawSource.text]), "Tales evidence manifest changed");
  const tmanifestHash = sha(readFileSync(tmanifestPath));
  const tpreflight = read(join(tdir, "preflight.v1.json"));
  const tprogressPath = join(tdir, "progress.system-ca.v1.json");
  const tprogress = read(tprogressPath);
  const tresultPath = join(tdir, "result.v1.json");
  const tresult = read(tresultPath);
  if (tpreflight.request.requestId !== trequest.requestId || tpreflight.request.evidenceUnits !== trequest.evidenceUnits.length || tpreflight.sourceHash !== tpdf.sourceHash ||
      tpreflight.inventoryHash !== tinventoryHash || tpreflight.manifestHash !== tmanifestHash || tresult.complete !== true ||
      tresult.sourceHash !== tpdf.sourceHash || tresult.inventoryHash !== tinventoryHash || tresult.manifestHash !== tmanifestHash ||
      tprogress.attempts.length !== 1 || tprogress.attempts[0].state !== "completed" || tprogress.attempts[0].requestId !== trequest.requestId ||
      JSON.stringify(tprogress.attempts[0].identity) !== JSON.stringify(tresult.identity) ||
      JSON.stringify(tpreflight.request.checkpointIdentity) !== JSON.stringify(tresult.identity) ||
      tpreflight.fixtureHash !== talesFixtureHash) throw new Error("Tales Claims-2 baseline incomplete or changed");
  if (validateAndUnionClaims2([{ requestId: trequest.requestId, output: tprogress.attempts[0].output }], [trequest]).claims.length !== tresult.validated.claims.length) throw new Error("Tales saved Claims-2 output no longer validates");
  const sourceFixture = read(join(privateRoot, "narrative-dev", "cleaned-source-inputs-v1.json"));
  const tales = sourceFixture.samples.find((item: { sample: string }) => item.sample === "TALES");
  same(tales.pages.map((page: { physicalPdfPage: number; rawText: string }) => ({ pageNumber: page.physicalPdfPage, text: page.rawText })), tpdf.pages, "Tales frozen source checkpoint changed");

  const benchmarks: FrozenClaims3Benchmark[] = [
    { name: "Test 9 — WotBS", sourcePath: wpdf.sourcePath, sourceHash: wpdf.sourceHash, fixtureHash: wfixture.fixture_hash,
      inventoryVersion: "Test 9 fixture inventory", inventoryHash: sha(JSON.stringify(wfixture.inventory)), manifestHash: sha(JSON.stringify(wrequests.map((request) => request.evidenceUnits))),
      baselineResultPath: wresultPath, baselineResultHash: sha(readFileSync(wresultPath)), baselineProgressPath: wprogressPath, baselineComplete: true,
      baselineRequestIds: wrequests.map((request) => request.requestId), baselinePages: wrequests.map(pagesOf), baselineUnits: wrequests.map((request) => request.evidenceUnits.length),
      baselineInputEstimates: wrequests.map((request) => claims2TokenDiagnostics(request).estimatedTokens.totalInput),
      inputDifferences: ["Claims-3 adds canonical IDs and the permanent Heroes identity to entity context; evidence units and request boundaries are unchanged."], requests: wrequests.map(planClaims3Request) },
    { name: "Test 10 — Sweetwater", sourcePath: spdf.sourcePath, sourceHash: spdf.sourceHash, fixtureHash: sfixture.fixtureHash,
      inventoryVersion: "v3 frozen from reviewed v2", inventoryHash: sinventoryHash, manifestHash: smanifestHash,
      baselineResultPath: sresultPath, baselineResultHash: sha(readFileSync(sresultPath)), baselineProgressPath: sprogressPath, baselineComplete: true,
      baselineRequestIds: [srequest.requestId], baselinePages: [pagesOf(srequest)], baselineUnits: [srequest.evidenceUnits.length],
      baselineInputEstimates: [claims2TokenDiagnostics(srequest).estimatedTokens.totalInput],
      inputDifferences: ["Claims-3 adds canonical IDs and the permanent Heroes identity to entity context.", "Deterministic section packaging assigns page-11 pre-S2 mold to S1, keeps S3 and S5 subheadings within their rooms, and strips confident S-number display prefixes; raw spans, unit IDs, offsets, and the single request boundary are unchanged."], requests: [planClaims3Request(srequest)] },
    { name: "Test 11 — Tales", sourcePath: tpdf.sourcePath, sourceHash: tpdf.sourceHash,
      fixtureHash: tpreflight.fixtureHash, inventoryVersion: "v1 frozen", inventoryHash: tinventoryHash, manifestHash: tmanifestHash,
      baselineResultPath: tresultPath, baselineResultHash: sha(readFileSync(tresultPath)), baselineProgressPath: tprogressPath, baselineComplete: true,
      baselineRequestIds: [trequest.requestId], baselinePages: [pagesOf(trequest)], baselineUnits: [trequest.evidenceUnits.length],
      baselineInputEstimates: [claims2TokenDiagnostics(trequest).estimatedTokens.totalInput],
      inputDifferences: ["Claims-3 replaces the source-discovered Party inventory entry with the permanent Heroes identity and adds canonical IDs to entity context; evidence units and request boundary are unchanged."], requests: [planClaims3Request(trequest)] },
  ];
  if (benchmarks.flatMap((benchmark) => benchmark.requests).length !== 4) throw new Error("Expected exactly four frozen requests");
  return benchmarks;
}

export function claims3Preflight(benchmarks: FrozenClaims3Benchmark[], modelId = "gpt-6-luna") {
  const outputLimits: Record<string, number> = { "test9-claims3-1": 9000, "test9-claims3-2": 9000,
    "test10-sweetwater-claims3-v3-1": 12000, "test11-tales-claims3-v1-1": 12000 };
  const rate = { inputUsdPerMillion: 0.275, outputUsdPerMillion: 0.825, basis: "conservative rate configured in saved Claims-2 Tales preflight; planning assumption, not a current price quote" };
  const requests = benchmarks.flatMap((benchmark) => benchmark.requests.map((request, index) => {
    const diagnostics = claims3TokenDiagnostics(request);
    const estimatedInputTokens = diagnostics.estimatedTokens.totalInput;
    const maxOutputTokens = outputLimits[request.requestId];
    if (!maxOutputTokens) throw new Error(`No Claims-3 output limit: ${request.requestId}`);
    const reservedInputTokens = Math.ceil(estimatedInputTokens * 1.2);
    return { benchmark: benchmark.name, requestId: request.requestId, baselineRequestId: request.baselineRequestId,
      pages: [...new Set(request.evidenceUnits.map((unit) => unit.page))], evidenceUnits: request.evidenceUnits.length,
      evidenceUnitIdsHash: sha(JSON.stringify(request.evidenceUnits.map((unit) => unit.unitId))),
      contexts: [...new Set(request.evidenceUnits.map((unit) => unit.context))], sourceHash: benchmark.sourceHash, fixtureHash: benchmark.fixtureHash,
      inventoryVersion: benchmark.inventoryVersion, inventoryHash: benchmark.inventoryHash, manifestHash: benchmark.manifestHash,
      baselineResultPath: benchmark.baselineResultPath, baselineResultHash: benchmark.baselineResultHash, baselineComplete: benchmark.baselineComplete,
      baselineEstimatedInputTokens: benchmark.baselineInputEstimates[index], inputDifferences: benchmark.inputDifferences,
      diagnostics, estimatedInputTokens, reservedInputTokens, maxOutputTokens, reservedTokens: reservedInputTokens + maxOutputTokens,
      estimatedCostUsd: (reservedInputTokens * rate.inputUsdPerMillion + maxOutputTokens * rate.outputUsdPerMillion) / 1_000_000,
      identity: claims3CheckpointIdentity({ request, fixtureHash: benchmark.fixtureHash, sourceHash: benchmark.sourceHash,
        inventoryHash: benchmark.inventoryHash, manifestHash: benchmark.manifestHash, modelId }) };
  }));
  return { mode: "offline", plannedCalls: requests.length, liveCallsMade: 0, modelId, promptHash: claims3PromptHash(), schemaHash: claims3SchemaHash(),
    sdkMaxRetries: 0, hardCallBudget: 4, rate, requests,
    totals: { estimatedInputTokens: requests.reduce((n, item) => n + item.estimatedInputTokens, 0), maxOutputTokens: requests.reduce((n, item) => n + item.maxOutputTokens, 0),
      reservedTokens: requests.reduce((n, item) => n + item.reservedTokens, 0), estimatedCostUsd: requests.reduce((n, item) => n + item.estimatedCostUsd, 0) } };
}
