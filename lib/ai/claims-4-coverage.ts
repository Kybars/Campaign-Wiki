import type { Claims4Claim, Claims4Request } from "./claims-4-experiment";

export interface ComparisonProposition { statement: string; unitIds: string[]; origin: "claims2" | "claims3_proposed" | "claims3_retained" }
const words = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((word) =>
  !["that", "this", "with", "from", "which", "their", "they", "them", "would", "could", "there", "were", "have", "been"].includes(word)));
function similarity(a: string, b: string) {
  const left = words(a); const right = words(b);
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.min(left.size, right.size);
}
function coverage(statement: string, claims: Claims4Claim[]) {
  const baseline = words(statement);
  const represented = words(claims.map((claim) => claim.original.statement).join(" "));
  return baseline.size ? [...baseline].filter((word) => represented.has(word)).length / baseline.size : 0;
}
export function compareClaims4Coverage(request: Claims4Request, references: ComparisonProposition[], claims: Claims4Claim[]) {
  const propositions = references.map((reference) => {
    const candidates = claims.filter((claim) => reference.unitIds.some((id) => claim.evidence.some((item) => item.unitId === id)) &&
      similarity(reference.statement, claim.original.statement) >= 0.45);
    // Multiple smaller Claims-4 statements can jointly represent one earlier
    // proposition, but shared topic words alone cannot mark it covered.
    const enough = coverage(reference.statement, candidates) >= 0.72;
    const ready = enough && coverage(reference.statement, candidates.filter((claim) => claim.state === "ready" && claim.sourceStatus === "established")) >= 0.72;
    const lowerPriority = enough && coverage(reference.statement, candidates.filter((claim) => claim.state === "ready" && claim.sourceStatus !== "established")) >= 0.72;
    const pending = enough && candidates.some((claim) => claim.state !== "ready");
    return { ...reference, representation: ready ? "ready" : lowerPriority ? "scenario_or_gm" : pending ? "pending" : "missing",
      matchProposalIndexes: candidates.map((claim) => claim.proposalIndex),
      identityUnresolved: candidates.some((claim) => claim.reasons.includes("identity_unresolved")) };
  });
  const sourceUnits = request.evidenceUnits.filter((unit) => unit.kind === "sentence").map((unit) => {
    const linked = claims.filter((claim) => claim.evidence.some((item) => item.unitId === unit.unitId));
    return { unitId: unit.unitId, page: unit.page,
      representation: linked.some((claim) => claim.state === "ready" && claim.sourceStatus === "established") ? "ready"
        : linked.some((claim) => claim.state === "ready") ? "scenario_or_gm"
          : linked.length ? "pending" : "uncovered",
      claimIndexes: linked.map((claim) => claim.proposalIndex) };
  });
  const gaps = propositions.filter((item) => item.representation === "missing");
  const distinct: typeof propositions = [];
  for (const proposition of propositions) {
    if (!distinct.some((item) => item.unitIds.some((id) => proposition.unitIds.includes(id)) && similarity(item.statement, proposition.statement) >= 0.8))
      distinct.push(proposition);
  }
  return { requestId: request.requestId, propositions, sourceUnits, gaps,
    metrics: { rawProposals: claims.length, readyClaims: claims.filter((claim) => claim.state === "ready").length,
      pendingByReason: Object.fromEntries([...new Set(claims.flatMap((claim) => claim.reasons))].map((reason) => [reason, claims.filter((claim) => claim.reasons.includes(reason)).length])),
      distinctUsefulPropositions: distinct.filter((item) => item.representation !== "missing").length,
      sourceUnitCoverage: { represented: sourceUnits.filter((unit) => unit.representation !== "uncovered").length, total: sourceUnits.length },
      entityLinkAccuracy: null, evidencePrecision: null, scenarioStatusAccuracy: null, modelUsage: null } };
}

/** Offline plan only. A separate, explicit paid authorization is required to execute any rescue. */
export function planClaims4Rescue(request: Claims4Request, gaps: ReturnType<typeof compareClaims4Coverage>["gaps"]) {
  const byId = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
  const units = [...new Set(gaps.flatMap((gap) => gap.unitIds))].map((id) => byId.get(id)).filter((unit) => unit !== undefined);
  units.sort((a, b) => a.order - b.order);
  const batches: Array<{ unitIds: string[]; page: number; start: number; end: number; context: string; sourceText: string }> = [];
  for (const unit of units) {
    const prior = batches.at(-1);
    if (prior && prior.page === unit.page && prior.context === unit.context && unit.rawSource.start - prior.end < 400) {
      prior.unitIds.push(unit.unitId); prior.end = unit.rawSource.end; prior.sourceText += `\n${unit.rawSource.text}`;
    } else batches.push({ unitIds: [unit.unitId], page: unit.page, start: unit.rawSource.start,
      end: unit.rawSource.end, context: unit.context, sourceText: unit.rawSource.text });
  }
  return { requestId: request.requestId, executable: false, requiresSeparateModelCallAuthorization: true, batches };
}
