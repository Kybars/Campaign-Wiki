import { createHash } from "node:crypto";
import { loadFrozenClaims3Benchmarks, type FrozenClaims3Benchmark } from "./claims-3-benchmarks";
import { claims4CheckpointIdentity, claims4PromptHash, claims4SchemaHash, claims4TokenDiagnostics, planClaims4Request, type Claims4Request } from "./claims-4-experiment";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export interface FrozenClaims4Benchmark extends Omit<FrozenClaims3Benchmark, "requests"> { requests: Claims4Request[] }
export async function loadFrozenClaims4Benchmarks(): Promise<FrozenClaims4Benchmark[]> {
  const benchmarks = (await loadFrozenClaims3Benchmarks()).map((benchmark) => ({ ...benchmark,
    inputDifferences: [...benchmark.inputDifferences, "Claims-4 uses a new coverage-first prompt/schema, non-exhaustive inventory instructions, and a larger proposed output budget."],
    requests: benchmark.requests.map(planClaims4Request) }));
  const frozenHashes = [
    ["1f9c556e5e4150c9424560e79fa7154826516a13ffedf7da7213185d3134828c", "d7733ff9705391572d25f0b3c2c6188ee57c37f69d5a3b65507ccd8b4990ade7", "7169dd94a13ccadbf2e00a17318dc4afea317393952279ae1212c9cd4eee9ac0", "e62fb9c5fd9a692a04c9931776dc15e3468fb0001dd45722cc60fdf5700e0e66", "68870a3d04705cf7d42b13c0353859abec96107bdb4dfc782e63d04faa00f67c"],
    ["87f0d5f8099d1881ecad6a6bba03d2807df6bd07138975dead3d1fea373e42cc", "61452bd607529afae3cf944114f9e56e57da18c3112e4a1f274b62c6f58ab03b", "cb1830f904f217004022b85b7ea0e0d2d6961e390a797d65d021e4ad6e7400d4", "86c639143593147d61f50ba1945c1918f6103e494289673ce250d0e0cd00b3a9", "add2e5e71741231fa2c23329b507ef65db4b499d87e3b93bcc96c85c457aa3ee"],
    ["07f3bda14d7375f3da6f008aa499bc0fe2ee90e7183e11f2a64eeeb96fdf3377", "8854dc07e62527eb07c14d6f2f8c0551e4dafa415075d86988c270d04be3787d", "5744751f7733638fbc66e66fd56cfb3d0079ae5bc24da9834ce016ab7755150d", "8f5f81aa094494e3373be6f8ec5206e02f0feb71da239e9e24b315733e508fa5", "2505b20b04193a528f41dfca5fd46d8969406c76d75057f1966146a98639e1a1"],
  ];
  benchmarks.forEach((benchmark, index) => {
    if (JSON.stringify([benchmark.sourceHash, benchmark.fixtureHash, benchmark.inventoryHash, benchmark.manifestHash, benchmark.baselineResultHash]) !== JSON.stringify(frozenHashes[index]))
      throw new Error(`Frozen Claims-2 artifact hash changed: ${benchmark.name}`);
  });
  const requests = benchmarks.flatMap((benchmark) => benchmark.requests);
  if (requests.length !== 4 || JSON.stringify(requests.map((request) => request.baselineRequestId)) !== JSON.stringify([
    "test9-claims2-1", "test9-claims2-2", "test10-sweetwater-claims2-v3-1", "test11-tales-claims2-v1-1"])) throw new Error("Claims-4 frozen request set changed");
  for (const benchmark of benchmarks) for (let index = 0; index < benchmark.requests.length; index++) {
    const request = benchmark.requests[index];
    if (JSON.stringify([...new Set(request.evidenceUnits.map((unit) => unit.page))]) !== JSON.stringify(benchmark.baselinePages[index]) ||
        request.evidenceUnits.length !== benchmark.baselineUnits[index]) throw new Error(`Claims-4 source boundary changed: ${request.requestId}`);
  }
  return benchmarks;
}

export function claims4Preflight(benchmarks: FrozenClaims4Benchmark[], modelId = "gpt-6-luna") {
  // Claims-3's live completions consumed 5,160/5,669/6,808/8,436 output
  // tokens while losing supported material. These caps leave room for greater
  // coverage without treating a cap as a target or claiming recall in advance.
  const outputLimits: Record<string, number> = { "test9-claims4-1": 12000, "test9-claims4-2": 12000,
    "test10-sweetwater-claims4-v3-1": 16000, "test11-tales-claims4-v1-1": 18000 };
  const rate = { inputUsdPerMillion: 0.275, outputUsdPerMillion: 0.825,
    basis: "saved Claims-2 Tales planning rates; estimate only, not a current price quote" };
  const requests = benchmarks.flatMap((benchmark) => benchmark.requests.map((request) => {
    const diagnostics = claims4TokenDiagnostics(request);
    const estimatedInputTokens = diagnostics.estimatedTokens.totalInput;
    const reservedInputTokens = Math.ceil(estimatedInputTokens * 1.2);
    const maxOutputTokens = outputLimits[request.requestId];
    if (!maxOutputTokens) throw new Error(`Unplanned Claims-4 request: ${request.requestId}`);
    return { benchmark: benchmark.name, requestId: request.requestId, baselineRequestId: request.baselineRequestId,
      pages: [...new Set(request.evidenceUnits.map((unit) => unit.page))], evidenceUnits: request.evidenceUnits.length,
      evidenceUnitIdsHash: sha(JSON.stringify(request.evidenceUnits.map((unit) => unit.unitId))),
      sourceHash: benchmark.sourceHash, fixtureHash: benchmark.fixtureHash, inventoryHash: benchmark.inventoryHash,
      manifestHash: benchmark.manifestHash, baselineResultHash: benchmark.baselineResultHash,
      inputDifferences: [...benchmark.inputDifferences, ...request.inputDifferences],
      diagnostics, estimatedInputTokens, reservedInputTokens, maxOutputTokens,
      estimatedCostUsd: (reservedInputTokens * rate.inputUsdPerMillion + maxOutputTokens * rate.outputUsdPerMillion) / 1_000_000,
      identity: claims4CheckpointIdentity({ request, fixtureHash: benchmark.fixtureHash, sourceHash: benchmark.sourceHash,
        inventoryHash: benchmark.inventoryHash, manifestHash: benchmark.manifestHash, modelId }) };
  }));
  return { mode: "offline", plannedCalls: 4, liveCallsMade: 0, modelId, promptHash: claims4PromptHash(), schemaHash: claims4SchemaHash(),
    sdkMaxRetries: 0, hardCallBudget: 4, rate, requests,
    totals: { estimatedInputTokens: requests.reduce((sum, item) => sum + item.estimatedInputTokens, 0),
      reservedInputTokens: requests.reduce((sum, item) => sum + item.reservedInputTokens, 0),
      maxOutputTokens: requests.reduce((sum, item) => sum + item.maxOutputTokens, 0),
      estimatedCostUsd: requests.reduce((sum, item) => sum + item.estimatedCostUsd, 0) } };
}
