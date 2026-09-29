import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFrozenClaims4Benchmarks } from "../lib/ai/claims-4-benchmarks";
import type { Claims3Output } from "../lib/ai/claims-3-experiment";
import { reconcileClaims4, type Claims4Output } from "../lib/ai/claims-4-experiment";
import { compareClaims4Coverage, planClaims4Rescue, type ComparisonProposition } from "../lib/ai/claims-4-coverage";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const root = join(process.cwd(), "fixtures", "private");
const outputPath = join(root, "claims4-v1", "coverage.v1.json");
function provenanceUnits(claim: { provenance: Array<{ unitIds: string[] }> }) {
  return [...new Set(claim.provenance.flatMap((item) => item.unitIds))];
}
async function main() {
  const benchmarks = await loadFrozenClaims4Benchmarks();
  const claims3Progress = read(join(root, "claims3-recovery-v1", "progress.v1.json")) as {
    attempts: Array<{ requestId: string; state: string; output: Claims3Output }> };
  const claims3Result = read(join(root, "claims3-recovery-v1", "result.v1.json")) as {
    validated: { claims: Array<{ statement: string; provenance: Array<{ unitIds: string[] }> }> } };
  const claims4Progress = read(join(root, "claims4-v1", "progress.v1.json")) as {
    attempts: Array<{ requestId: string; state: string; originalParsedOutput: Claims4Output }> };
  if (claims3Progress.attempts.length !== 4 || claims4Progress.attempts.length !== 4 ||
      [...claims3Progress.attempts, ...claims4Progress.attempts].some((item) => item.state !== "completed")) throw new Error("Four completed Claims-3 and Claims-4 attempts are required for comparison");
  const reports = [];
  for (const benchmark of benchmarks) {
    const baselineResult = read(benchmark.baselineResultPath) as {
      claims?: Array<{ statement: string; provenance: Array<{ unitIds: string[] }> }>;
      validated?: { claims: Array<{ statement: string; provenance: Array<{ unitIds: string[] }> }> } };
    const savedClaims2 = baselineResult.claims ?? baselineResult.validated?.claims;
    if (!savedClaims2) throw new Error(`Missing saved Claims-2 retained claims: ${benchmark.name}`);
    for (const request of benchmark.requests) {
      const c3Id = request.requestId.replace("claims4", "claims3");
      const c3Attempt = claims3Progress.attempts.find((item) => item.requestId === c3Id);
      const c4Attempt = claims4Progress.attempts.find((item) => item.requestId === request.requestId);
      if (!c3Attempt?.output || !c4Attempt?.originalParsedOutput) throw new Error(`Missing saved parsed proposals: ${request.requestId}`);
      const unitIds = new Set(request.evidenceUnits.map((unit) => unit.unitId));
      const c2 = savedClaims2.filter((claim) => provenanceUnits(claim).some((id) => unitIds.has(id)));
      const c3 = claims3Result.validated.claims.filter((claim) => provenanceUnits(claim).some((id) => unitIds.has(id)));
      const c4 = reconcileClaims4(c4Attempt.originalParsedOutput, request);
      const refs: ComparisonProposition[] = [
        ...c2.map((claim) => ({ origin: "claims2" as const, statement: claim.statement, unitIds: provenanceUnits(claim) })),
        ...c3Attempt.output.claims.map((claim) => ({ origin: "claims3_proposed" as const, statement: claim.statement,
          unitIds: claim.evidence.map((item) => item.unit_id) })),
        ...c3.map((claim) => ({ origin: "claims3_retained" as const, statement: claim.statement, unitIds: provenanceUnits(claim) })),
      ];
      const comparison = compareClaims4Coverage(request, refs, c4.claims);
      reports.push({ benchmark: benchmark.name, requestId: request.requestId, baseline: { claims2Retained: c2.length,
        claims3Proposed: c3Attempt.output.claims.length, claims3Retained: c3.length },
        claims4: c4.diagnostics, comparison,
        rescuePlan: planClaims4Rescue(request, comparison.gaps.filter((gap) => gap.origin === "claims2" || gap.origin === "claims3_retained")) });
    }
  }
  const result = { mode: "offline", modelsCalled: 0, comparisonMethod: "Source-unit overlap plus proposition token similarity; provisional, requires human semantic audit.",
    reports, metricsPlanned: ["raw proposals", "ready claims", "pending claims by reason", "distinct useful propositions", "source-unit coverage",
      "entity-link accuracy", "evidence precision", "scenario-status accuracy", "model usage"] };
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, requests: reports.length, modelsCalled: 0,
    gapsForReview: reports.reduce((sum, report) => sum + report.comparison.gaps.length, 0) }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
