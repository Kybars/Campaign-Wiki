import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadFrozenClaims41Benchmarks } from "../lib/ai/claims-4-1-benchmarks";
import { validateAndUnionClaims3 } from "../lib/ai/claims-3-experiment";

const root = join(process.cwd(), "fixtures/private");
const run = join(root, "claims4-1-sweetwater-v1");
const bundle = join(run, "review-bundle-v1");
const id = "test10-sweetwater-claims4-1-v3-1";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const words = (value: string) => value.trim().split(/\s+/u).filter(Boolean).length;
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const counts = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
function copy(src: string, dest: string) { mkdirSync(dirname(join(bundle, dest)), { recursive: true }); copyFileSync(join(root, src), join(bundle, dest)); }
function files(path: string): string[] { return readdirSync(path).flatMap((name) => {
  const full = join(path, name);
  return statSync(full).isDirectory() ? files(full) : [full];
}); }
function metrics(proposals: Array<{ statement: string; participants?: string[]; entities?: string[]; evidence_unit_ids?: string[]; evidence_units?: string[]; evidence?: Array<{ unit_id: string }> }>, retained: number) {
  const participants = proposals.map((item) => (item.participants ?? item.entities ?? []).length);
  return { proposals: proposals.length, retained, averageStatementWords: average(proposals.map((item) => words(item.statement))),
    averageParticipants: average(participants), claimsWith4PlusParticipants: participants.filter((count) => count >= 4).length,
    distinctEvidenceUnits: new Set(proposals.flatMap((item) => item.evidence_unit_ids ?? item.evidence_units ?? item.evidence?.map((e) => e.unit_id) ?? [])).size };
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Bundle builder is offline only");
  const benchmark = (await loadFrozenClaims41Benchmarks()).find((item) => item.name === "Test 10 — Sweetwater");
  if (!benchmark) throw new Error("Frozen Sweetwater benchmark missing");
  const request = benchmark.requests[0];
  const preflight = read(join(run, "preflight.v1.json"));
  if (preflight.requestId !== id || preflight.sourceHash !== benchmark.sourceHash ||
      preflight.fixtureHash !== benchmark.fixtureHash || preflight.inventoryHash !== benchmark.inventoryHash ||
      preflight.manifestHash !== benchmark.manifestHash) throw new Error("Preflight no longer matches frozen Sweetwater input");
  const progress = read(join(run, `${id}.progress.v1.json`));
  const attempt = progress.attempts?.[0];
  if (progress.attempts?.length !== 1 || attempt.state !== "completed" || !attempt.originalParsedOutput)
    throw new Error("Exactly one completed saved attempt is required");
  const result = read(join(run, `${id}.result.v1.json`));
  const v2 = read(join(run, `${id}.reconciliation-v2.v1.json`));
  if (JSON.stringify(result.originalParsedOutput) !== JSON.stringify(attempt.originalParsedOutput) ||
      v2.claims.length !== result.originalParsedOutput.claims.length) throw new Error("Saved original proposals changed");
  const c2Result = read(join(root, "test10-sweetwater-v1/result.v3.json"));
  const c2Attempt = read(join(root, "test10-sweetwater-v1/progress.v3.json")).attempts[0];
  const c3Attempt = read(join(root, "claims3-recovery-v1/progress.v1.json")).attempts.find((item: { requestId: string }) => item.requestId === "test10-sweetwater-claims3-v3-1");
  if (!c3Attempt || c3Attempt.state !== "completed") throw new Error("Sweetwater Claims-3 baseline missing");
  const c3Request = (await import("../lib/ai/claims-3-benchmarks")).loadFrozenClaims3Benchmarks;
  const c3Benchmark = (await c3Request()).find((item) => item.name === "Test 10 — Sweetwater");
  if (!c3Benchmark) throw new Error("Frozen Claims-3 Sweetwater request missing");
  const c3Validated = validateAndUnionClaims3([{ requestId: c3Attempt.requestId, output: c3Attempt.output }], c3Benchmark.requests);
  const c4 = read(join(root, "claims4-v1/result.v1.json")).requests.find((item: { requestId: string }) => item.requestId === "test10-sweetwater-claims4-v3-1");
  if (!c4) throw new Error("Sweetwater Claims-4 baseline missing");
  const byUnit = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
  const excerpt = (claim: typeof v2.claims[number]) => claim.original.evidence_unit_ids.map((unitId: string) => {
    const unit = byUnit.get(unitId);
    return { unitId, page: unit?.page, sourceContext: unit?.context, text: unit?.rawSource.text };
  });
  const party = v2.claims.filter((claim: typeof v2.claims[number]) => claim.participants.some((item: { canonicalId: string | null }) => item.canonicalId === "system:heroes-party"));
  const form = /\b(?:the characters|characters|the party|party|the heroes|heroes|the adventurers|adventurers|player characters|PCs)\b/giu;
  const heroes = party.map((claim: typeof v2.claims[number]) => ({ proposalIndex: claim.proposalIndex, statement: claim.original.statement,
    participants: claim.participants.filter((item: { canonicalId: string | null }) => item.canonicalId === "system:heroes-party"),
    sourceForms: [...new Set(excerpt(claim).flatMap((source: { text?: string }) => [...(source.text ?? "").matchAll(form)].map((match) => match[0])))], source: excerpt(claim) }));
  const identity = v2.claims.filter((claim: typeof v2.claims[number]) => /\b(?:Galell|merath)\b/iu.test(claim.original.statement) ||
    claim.original.participants.some((item: string) => /\b(?:Galell|merath)\b/iu.test(item))).map((claim: typeof v2.claims[number]) => ({
      proposalIndex: claim.proposalIndex, statement: claim.original.statement,
      oldParticipants: result.reconciled.proposals[claim.proposalIndex].participants,
      v2Participants: claim.participants, source: excerpt(claim) }));
  const pantry = v2.claims.filter((claim: typeof v2.claims[number]) => claim.original.evidence_unit_ids.some((unitId: string) => {
    const unit = byUnit.get(unitId);
    return unit?.page === 11 && /S1|Rotted Pantry/iu.test(unit.context);
  })).map((claim: typeof v2.claims[number]) => ({ proposalIndex: claim.proposalIndex, statement: claim.original.statement, source: excerpt(claim) }));
  const reward = v2.claims.filter((claim: typeof v2.claims[number]) => /\breward|promis|\bgives?\b/iu.test(claim.original.statement) &&
    /\bif\b|\bwhen\b|\bpromis/iu.test(claim.original.statement + " " + excerpt(claim).map((s: { text?: string }) => s.text).join(" ")))
    .map((claim: typeof v2.claims[number]) => ({ proposalIndex: claim.proposalIndex, statement: claim.original.statement, source: excerpt(claim) }));
  const hook = v2.claims.filter((claim: typeof v2.claims[number]) =>
    /\byou can also have\b|\boptional\b/iu.test(excerpt(claim).map((s: { text?: string }) => s.text).join(" ")))
    .map((claim: typeof v2.claims[number]) => ({ proposalIndex: claim.proposalIndex, statement: claim.original.statement, source: excerpt(claim) }));
  const discrepancy = result.reconciled.proposals.filter((claim: { reasons: string[] }) => claim.reasons.includes("possible_source_discrepancy"))
    .map((claim: typeof result.reconciled.proposals[number]) => ({ proposalIndex: claim.proposalIndex, statement: claim.original.statement, source: excerpt(claim) }));
  const sourceWordingContradictions = discrepancy.filter((item: typeof discrepancy[number]) =>
    /bound\s+the\s+merath/iu.test(item.statement) &&
    /bound\s+Ullae/iu.test(item.source.map((source: { text?: string }) => source.text).join(" ")));
  const merathWith = (pattern: RegExp) => identity.filter((item: typeof identity[number]) =>
    item.source.some((source: { text?: string }) => pattern.test((source.text ?? "").replace(/\s+/gu, " "))));
  const indefiniteMerath = merathWith(/\b(?:a|an) merath\b/iu);
  const definiteMerath = merathWith(/\bthe merath\b/iu);
  const participantKinds = counts(v2.claims.flatMap((claim: typeof v2.claims[number]) => claim.participants.map((item: { kind: string }) => item.kind)));
  const unresolved = v2.claims.flatMap((claim: typeof v2.claims[number]) => claim.participants.filter((item: { kind: string }) => item.kind === "unresolved")
    .map((item: { mention: string; reason: string }) => ({ proposalIndex: claim.proposalIndex, mention: item.mention, reason: item.reason, statement: claim.original.statement, source: excerpt(claim) })));
  const comparison = {
    claims2: metrics(c2Attempt.output.claims, c2Result.validated.claims.length),
    claims3: metrics(c3Attempt.output.claims, c3Validated.claims.length),
    claims4: metrics(c4.originalParsedOutput.claims, c4.reconciled.claims.length),
    claims41: metrics(result.originalParsedOutput.claims, result.reconciled.claims.length),
  };
  const mechanical = { extraction: { responseId: attempt.diagnostics.responseId, status: attempt.diagnostics.status,
    usage: attempt.diagnostics.usage, ...comparison.claims41,
    participantCountDistribution: counts(result.originalParsedOutput.claims.map((claim: { participants: string[] }) => String(claim.participants.length))) },
    old: result.reconciled.diagnostics,
    v2: { ...v2.diagnostics, participantKinds, entityAssociated: v2.claims.filter((claim: typeof v2.claims[number]) => claim.entityAssociations.length).length,
      noUsefulHome: v2.claims.filter((claim: typeof v2.claims[number]) => !claim.entityAssociations.length && !claim.timelineAssociation).length,
      gmReview: v2.gmReview.length, unresolvedMeaningfulMentions: unresolved },
    sweetwater: { heroesClaims: heroes.length, sourceForms: counts(heroes.flatMap((item: typeof heroes[number]) => item.sourceForms)), heroes,
      galellClaims: identity.filter((item: typeof identity[number]) => /\bGalell\b/iu.test(item.statement) || item.v2Participants.some((p: { mention: string }) => /\bGalell\b/iu.test(p.mention))).length,
      merathClaims: identity.filter((item: typeof identity[number]) => /\bmerath\b/iu.test(item.statement) || item.v2Participants.some((p: { mention: string }) => /\bmerath\b/iu.test(p.mention))).length,
      definiteMerathResolvedToGalell: identity.filter((item: typeof identity[number]) => item.v2Participants.some((p: { mention: string; canonicalName: string | null }) => /^the merath$/iu.test(p.mention) && p.canonicalName === "Galell")).length,
      indefiniteMerathSourceReferencesNotGalell: indefiniteMerath.filter((item: typeof identity[number]) =>
        !item.v2Participants.some((p: { mention: string; canonicalName: string | null }) => /merath/iu.test(p.mention) && p.canonicalName === "Galell")).length,
      definiteMerathSourceReferences: definiteMerath.length,
      identity, pantryContinuationClaims: pantry.length, pantry, conditionalRewardClaims: reward.length, rewards: reward,
      optionalHookClaims: hook.length, hooks: hook, sourceDiscrepancyFlags: discrepancy.length, discrepancies: discrepancy,
      sourceWordingContradictions: sourceWordingContradictions.length, contradictoryClaims: sourceWordingContradictions },
    historicalComparison: comparison };
  mkdirSync(bundle, { recursive: true });
  copy("claims4-1-sweetwater-v1/preflight.v1.json", "claims41/preflight.v1.json");
  copy(`claims4-1-sweetwater-v1/${id}.progress.v1.json`, "claims41/live-call-report-and-checkpoint.v1.json");
  copy(`claims4-1-sweetwater-v1/${id}.result.v1.json`, "claims41/full-result.v1.json");
  copy(`claims4-1-sweetwater-v1/${id}.reconciliation-v2.v1.json`, "claims41/reconciliation-v2.v1.json");
  copy("test10-sweetwater-v1/result.v3.json", "claims2/result.v3.json");
  copy("test10-sweetwater-v1/progress.v3.json", "claims2/progress.v3.json");
  write(join(bundle, "claims41/raw-response-output.v1.json"), attempt.rawResponseOutput);
  write(join(bundle, "claims41/original-parsed-proposals.v1.json"), attempt.originalParsedOutput);
  write(join(bundle, "claims41/old-reconciliation.v1.json"), result.reconciled);
  write(join(bundle, "claims3/sweetwater-original-proposals.v1.json"), c3Attempt.output);
  write(join(bundle, "claims3/sweetwater-validated.v1.json"), c3Validated);
  write(join(bundle, "claims4/sweetwater-original-proposals.v1.json"), c4.originalParsedOutput);
  write(join(bundle, "claims4/sweetwater-reconciliation.v1.json"), c4.reconciled);
  write(join(bundle, "evidence/sweetwater-manifest.v1.json"), request.evidenceUnits.map((unit) => ({
    unitId: unit.unitId, page: unit.page, rawStart: unit.rawSource.start, rawEnd: unit.rawSource.end,
    rawText: unit.rawSource.text, sourceContext: unit.context, sourceOrder: unit.order, kind: unit.kind })));
  write(join(bundle, "hashes.v1.json"), { sourceHash: benchmark.sourceHash, fixtureHash: benchmark.fixtureHash,
    inventoryHash: benchmark.inventoryHash, manifestHash: benchmark.manifestHash, baselineResultHash: benchmark.baselineResultHash,
    promptHash: preflight.promptHash, schemaHash: preflight.schemaHash, oldReconciliationCodeHash: preflight.oldReconciliationCodeHash,
    reconciliationV2CodeHash: preflight.reconciliationV2CodeHash });
  write(join(bundle, "mechanical-report.v1.json"), mechanical);
  const manifest = files(bundle).filter((path) => relative(bundle, path) !== "MANIFEST.json").map((path) => ({ path: relative(bundle, path).replaceAll("\\", "/"), bytes: statSync(path).size,
    sha256: sha(readFileSync(path)) })).sort((a, b) => a.path.localeCompare(b.path));
  write(join(bundle, "MANIFEST.json"), { version: 1, privateLocalOnly: true, payloads: manifest });
  console.log(JSON.stringify({ bundle, payloads: manifest.length, report: join(bundle, "mechanical-report.v1.json"),
    extraction: mechanical.extraction, old: mechanical.old, v2: { ...mechanical.v2, unresolvedMeaningfulMentions: mechanical.v2.unresolvedMeaningfulMentions.length },
    sweetwater: { heroesClaims: heroes.length, galellClaims: mechanical.sweetwater.galellClaims, merathClaims: mechanical.sweetwater.merathClaims,
      definiteMerathResolvedToGalell: mechanical.sweetwater.definiteMerathResolvedToGalell,
      indefiniteMerathSourceReferencesNotGalell: mechanical.sweetwater.indefiniteMerathSourceReferencesNotGalell,
      definiteMerathSourceReferences: mechanical.sweetwater.definiteMerathSourceReferences,
      pantryContinuationClaims: pantry.length, conditionalRewardClaims: reward.length, optionalHookClaims: hook.length,
      sourceDiscrepancyFlags: discrepancy.length, sourceWordingContradictions: sourceWordingContradictions.length }, historicalComparison: comparison }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
