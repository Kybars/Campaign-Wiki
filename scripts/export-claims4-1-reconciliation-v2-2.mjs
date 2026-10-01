import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

// Export adapter only. No reconciliation semantics or frozen inputs are edited.
globalThis.fetch = async () => { throw new Error("Network/API calls are disabled for this offline export"); };
const root = process.cwd();
const directory = join(root, "fixtures/private/claims4-1-v2-2-review-v1");
const bundle = join(directory, "review-bundle-v1");
const ledgerPath = join(directory, "execution-ledger.v1.json");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const same = (a, b, message) => { if (!isDeepStrictEqual(a, b)) throw new Error(message); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const relative = (path) => path.slice(root.length + 1).replaceAll("\\", "/");
const payloads = [];
const write = (name, value) => {
  const path = join(bundle, name);
  const bytes = jsonBytes(value);
  writeFileSync(path, bytes, { flag: "wx" });
  payloads.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
  return path;
};
const protectedPaths = [...new Set([
  ...execFileSync("git", ["status", "--porcelain", "-uall"], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3)),
  "lib/ai/claims-4-1-experiment.ts", "lib/ai/claims-4-1-benchmarks.ts",
  "lib/ai/claims-4-1-reconciliation-v2.ts", "lib/ai/claims-4-1-reconciliation-v2-1.ts", "lib/ai/claims-4-1-reconciliation-v2-2.ts",
  "tests/claims-4-1-reconciliation-v2.test.ts", "tests/claims-4-1-reconciliation-v2-1.test.ts", "tests/claims-4-1-reconciliation-v2-2.test.ts",
])];
const protection = protectedPaths.map((path) => ({ path, sha256: sha(readFileSync(join(root, path))) }));
const specs = [
  { key: "wotbs", requestId: "test9-claims4-1-2", count: 106, run: "claims4-1-v1",
    result: "test9-claims4-1-2.result.v1.json", progress: "progress.v1.json",
    priorResult: "claims41/test9-claims4-1-2.result.v1.json", priorProgress: "claims41/progress.v1.json" },
  { key: "sweetwater", requestId: "test10-sweetwater-claims4-1-v3-1", count: 148, run: "claims4-1-sweetwater-v1",
    result: "test10-sweetwater-claims4-1-v3-1.result.v1.json", progress: "test10-sweetwater-claims4-1-v3-1.progress.v1.json",
    priorResult: "claims41/full-result.v1.json", priorProgress: "claims41/live-call-report-and-checkpoint.v1.json",
    priorProposals: "claims41/original-parsed-proposals.v1.json" },
];

function verifyOriginal(original, other, label, count) {
  assert(original?.claims?.length === count && other?.claims?.length === count, `${label}: proposal count mismatch`);
  return original.claims.map((proposal, index) => {
    for (const field of ["statement", "participants", "evidence_unit_ids"])
      same(proposal[field], other.claims[index][field], `${label}: proposal ${index} ${field} changed`);
    same(proposal, other.claims[index], `${label}: proposal ${index} changed`);
    return { proposalIndex: index, statementHash: sha(JSON.stringify(proposal.statement)),
      participantsHash: sha(JSON.stringify(proposal.participants)), evidenceIdsHash: sha(JSON.stringify(proposal.evidence_unit_ids)) };
  });
}

const summaryFor = (result) => {
  const claims = result.claims;
  const indexes = (predicate) => claims.filter(predicate).map((claim) => claim.proposalIndex);
  const discrepancy = (claim) => claim.reviewReasons.some((reason) => ["source_discrepancy", "possible_source_error", "possible_source_discrepancy"].includes(reason));
  const candidateIds = new Set(result.candidateEntities.map((entity) => entity.canonicalId));
  const candidateInvolvement = (claim) => claim.entityAssociations.some((entity) => candidateIds.has(entity.canonicalId)) ||
    claim.participants.some((participant) => participant.canonicalId && candidateIds.has(participant.canonicalId));
  const participantTotals = Object.fromEntries(["canonical_entity", "candidate_entity", "descriptor", "generic_non_entity", "unresolved"].map((kind) =>
    [kind, claims.reduce((sum, claim) => sum + claim.participants.filter((participant) => participant.kind === kind).length, 0)]));
  const unresolved = new Map();
  for (const claim of claims) for (const participant of claim.participants) if (participant.kind === "unresolved")
    unresolved.set(participant.mention, (unresolved.get(participant.mention) ?? 0) + 1);
  const relations = claims.flatMap((claim) => claim.identityRelations);
  const aliasRelations = relations.filter((relation) => relation.kind === "same_identity_alias");
  const transitionRelations = relations.filter((relation) => relation.kind === "identity_transition");
  return { originalProposalCount: claims.length, presentCount: indexes((claim) => claim.wikiDisposition === "present").length,
    mechanicalOnlyCount: indexes((claim) => claim.wikiDisposition === "mechanical_only").length,
    resolvedCount: indexes((claim) => claim.resolutionState === "resolved").length,
    needsReviewCount: indexes((claim) => claim.resolutionState === "needs_review").length,
    gmReviewCount: result.gmReview.length, participantTotals, candidateEntityCount: result.candidateEntities.length,
    claimsWithEntityAssociations: indexes((claim) => claim.entityAssociations.length > 0).length,
    claimsWithCampaignStructureAssociations: indexes((claim) => claim.timelineAssociation !== null).length,
    claimsWithContextEvidence: indexes((claim) => claim.contextEvidence.length > 0).length,
    totalContextEvidenceUnits: claims.reduce((sum, claim) => sum + claim.contextEvidence.length, 0),
    identityAliasRelationCount: aliasRelations.length, identityTransitionRelationCount: transitionRelations.length,
    distinctIdentityAliasRelationCount: new Set(aliasRelations.map((relation) => JSON.stringify(relation))).size,
    distinctIdentityTransitionRelationCount: new Set(transitionRelations.map((relation) => JSON.stringify(relation))).size,
    sourceDiscrepancyReviewCount: indexes((claim) => claim.resolutionState === "needs_review" && discrepancy(claim)).length,
    noUsefulHomeCount: indexes((claim) => claim.reviewReasons.includes("no_useful_home")).length,
    indexes: { mechanicalOnly: indexes((claim) => claim.wikiDisposition === "mechanical_only"),
      needsReview: indexes((claim) => claim.resolutionState === "needs_review"),
      contextEvidence: indexes((claim) => claim.contextEvidence.length > 0), sourceDiscrepancy: indexes(discrepancy),
      candidateEntities: indexes(candidateInvolvement), identityTransitions: indexes((claim) => claim.identityRelations.some((relation) => relation.kind === "identity_transition")) },
    distinctUnresolvedParticipantMentions: [...unresolved.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([mention, count]) => ({ mention, count })) };
};

function comparison(previous, next) {
  return { previousVersion: previous.version, newVersion: next.version, proposalIndexBase: 0,
    changedProposals: next.claims.flatMap((claim, index) => {
      const before = previous.claims[index];
      assert(before.proposalIndex === claim.proposalIndex, "v2.1/v2.2 proposal ordering mismatch");
      same(before.original, claim.original, `v2.1/v2.2 original changed at ${index}`);
      const fields = ["wikiDisposition", "resolutionState", "participants", "entityAssociations", "reviewReasons", "contextEvidence", "directEvidence", "timelineAssociation", "sourceStatus"];
      const changedFields = fields.filter((field) => !isDeepStrictEqual(before[field], claim[field]));
      if (!isDeepStrictEqual(before.identityRelationships, claim.identityRelations)) changedFields.push("identityMetadata");
      if (!changedFields.length) return [];
      const candidateIds = new Set(next.candidateEntities.map((entity) => entity.canonicalId));
      return [{ proposalIndex: index, changedFields, previousWikiDisposition: before.wikiDisposition, newWikiDisposition: claim.wikiDisposition,
        previousResolutionState: before.resolutionState, newResolutionState: claim.resolutionState,
        previousParticipantResolutions: before.participants, newParticipantResolutions: claim.participants,
        previousEntityAssociations: before.entityAssociations, newEntityAssociations: claim.entityAssociations,
        previousReviewReasons: before.reviewReasons, newReviewReasons: claim.reviewReasons,
        newCandidateEntityInvolvement: { participantResolutions: claim.participants.filter((participant) => candidateIds.has(participant.canonicalId)),
          entityAssociations: claim.entityAssociations.filter((entity) => candidateIds.has(entity.canonicalId)) },
        previousContextEvidence: before.contextEvidence, newContextEvidence: claim.contextEvidence,
        previousCampaignStructureAssociation: before.timelineAssociation, newCampaignStructureAssociation: claim.timelineAssociation,
        previousIdentityMetadata: before.identityRelationships, newIdentityMetadata: claim.identityRelations }];
    }) };
}

async function main() {
  assert(process.argv.length === 2, "This exporter accepts no options or dispatch arguments");
  assert(!existsSync(ledgerPath) && !existsSync(bundle), "Versioned export or execution ledger already exists; replay will not be repeated");
  const { claims41OutputSchema, claims41CheckpointIdentity } = await import("../lib/ai/claims-4-1-experiment.ts");
  const { loadFrozenClaims41Benchmarks } = await import("../lib/ai/claims-4-1-benchmarks.ts");
  const { reconcileClaims41V21 } = await import("../lib/ai/claims-4-1-reconciliation-v2-1.ts");
  const { reconcileClaims41V22 } = await import("../lib/ai/claims-4-1-reconciliation-v2-2.ts");
  const sourceFileHashes = [];
  const checkedRead = (path) => {
    const bytes = readFileSync(path);
    sourceFileHashes.push({ path: relative(path), sha256: sha(bytes) });
    return JSON.parse(bytes.toString("utf8"));
  };
  // All proposal checks for BOTH inputs finish before any v2.2 invocation.
  const inputs = specs.map((spec) => {
    const run = join(root, "fixtures/private", spec.run);
    const saved = checkedRead(join(run, spec.result));
    const progress = checkedRead(join(run, spec.progress));
    const preflight = checkedRead(join(run, "preflight.v1.json"));
    assert(saved.requestId === spec.requestId, `${spec.key}: saved request ID mismatch`);
    const attempts = progress.attempts.filter((attempt) => attempt.requestId === spec.requestId);
    assert(attempts.length === 1 && attempts[0].state === "completed", `${spec.key}: expected one completed saved extraction`);
    const attempt = attempts[0];
    const original = structuredClone(saved.originalParsedOutput);
    claims41OutputSchema.parse(original);
    const proposalChecks = verifyOriginal(original, attempt.originalParsedOutput, `${spec.key} checkpoint`, spec.count);
    if (attempt.responseOutputText) verifyOriginal(original, claims41OutputSchema.parse(JSON.parse(attempt.responseOutputText)), `${spec.key} saved response`, spec.count);
    same(saved.identity, attempt.identity, `${spec.key}: extraction/checkpoint identity mismatch`);
    const priorBundle = join(run, "review-bundle-v1");
    const priorManifest = checkedRead(join(priorBundle, "MANIFEST.json"));
    const historicalPayloads = priorManifest.payloads ?? priorManifest.files;
    const verifyHistorical = (name) => {
      const payload = historicalPayloads.find((item) => item.path === name);
      assert(payload, `${spec.key}: frozen manifest entry missing for ${name}`);
      const bytes = readFileSync(join(priorBundle, name));
      assert(sha(bytes) === payload.sha256 && bytes.length === payload.bytes, `${spec.key}: frozen manifest hash mismatch for ${name}`);
      return checkedRead(join(priorBundle, name));
    };
    verifyOriginal(original, verifyHistorical(spec.priorResult).originalParsedOutput, `${spec.key} prior bundled result`, spec.count);
    const priorAttempt = verifyHistorical(spec.priorProgress).attempts.find((item) => item.requestId === spec.requestId);
    assert(priorAttempt, `${spec.key}: frozen bundled checkpoint missing`);
    verifyOriginal(original, priorAttempt.originalParsedOutput, `${spec.key} prior bundled checkpoint`, spec.count);
    if (spec.priorProposals) verifyOriginal(original, verifyHistorical(spec.priorProposals), `${spec.key} prior proposal export`, spec.count);
    return { spec, original, saved, preflight, proposalChecks };
  });
  // This loader reads and verifies local frozen source bytes; it dispatches no model or API.
  const benchmarks = await loadFrozenClaims41Benchmarks();
  for (const input of inputs) {
    const benchmark = benchmarks.find((item) => item.requests.some((request) => request.requestId === input.spec.requestId));
    assert(benchmark, `${input.spec.key}: frozen request missing`);
    const request = benchmark.requests.find((item) => item.requestId === input.spec.requestId);
    const preflight = input.preflight.requests?.find((item) => item.requestId === input.spec.requestId) ?? input.preflight;
    for (const key of ["sourceHash", "fixtureHash", "inventoryHash", "manifestHash", "baselineResultHash"])
      same(benchmark[key], preflight[key], `${input.spec.key}: frozen ${key} mismatch`);
    const identity = claims41CheckpointIdentity({ request, fixtureHash: benchmark.fixtureHash, sourceHash: benchmark.sourceHash,
      inventoryHash: benchmark.inventoryHash, manifestHash: benchmark.manifestHash, modelId: input.saved.identity.modelId });
    same(identity, input.saved.identity, `${input.spec.key}: reconstructed frozen extraction input changed`);
    same(identity, preflight.identity, `${input.spec.key}: frozen preflight identity changed`);
    input.request = request;
    input.requestHash = sha(JSON.stringify(request));
  }
  console.log(JSON.stringify({ phase: "input_invariants_verified", benchmarks: inputs.map((input) => ({
    benchmark: input.spec.key, proposals: input.original.claims.length, allStatementsVerified: true,
    allParticipantArraysVerified: true, allEvidenceIdListsVerified: true, frozenRequestIdentityVerified: true })) }));
  mkdirSync(bundle, { recursive: false });
  const ledger = { version: 1, modelCalls: 0, apiCalls: 0, invocations: [] };
  writeFileSync(ledgerPath, jsonBytes(ledger), { flag: "wx" });
  const summary = { version: 1, reconciliationVersion: "claims-4-1-reconciliation-2.2", proposalIndexBase: 0,
    definitions: { participantTotals: "All original proposals, including mechanical_only proposals",
      identityRelationCounts: "Emitted per-claim metadata occurrences; distinct counts are exported separately",
      contextEvidenceUnits: "Sum of per-claim contextEvidence lengths, with reuse counted per claim",
      candidateInvolvement: "Candidate IDs in participant resolutions or entity associations",
      missingSourceClaimIndex: "null preserves native metadata when no extracted claim index was emitted; no supporting claim is invented" }, benchmarks: {} };
  for (const input of inputs) {
    const { spec, original, request } = input;
    const beforeRequest = structuredClone(request);
    const beforeOriginal = structuredClone(original);
    const previous = reconcileClaims41V21(structuredClone(original), request);
    verifyOriginal(original, { claims: previous.claims.map((claim) => claim.original) }, `${spec.key} v2.1 originals`, spec.count);
    ledger.invocations.push({ benchmark: spec.key, version: "2.2", count: 1, status: "started" });
    writeFileSync(ledgerPath, jsonBytes(ledger));
    const next = reconcileClaims41V22(original, request); // Exactly one full v2.2 call per benchmark.
    ledger.invocations.at(-1).status = "completed";
    writeFileSync(ledgerPath, jsonBytes(ledger));
    verifyOriginal(original, next.rawProposals, `${spec.key} v2.2 raw proposals`, spec.count);
    verifyOriginal(original, { claims: next.claims.map((claim) => claim.original) }, `${spec.key} v2.2 complete originals`, spec.count);
    same(request, beforeRequest, `${spec.key}: reconciliation mutated supplied request/inventory`);
    same(original, beforeOriginal, `${spec.key}: reconciliation mutated frozen proposals`);
    assert(sha(JSON.stringify(request)) === input.requestHash, `${spec.key}: frozen request fingerprint changed`);
    const relationRecords = next.claims.flatMap((claim) => claim.identityRelations.map((relation) => ({ ...relation, reportedOnProposalIndex: claim.proposalIndex })));
    for (const relation of relationRecords) assert(relation.sourceClaimIndex === null ||
      Number.isInteger(relation.sourceClaimIndex) && next.claims[relation.sourceClaimIndex], `${spec.key}: invalid relationship source claim index`);
    const aliasMetadata = next.aliasMetadata.map((alias) => {
      const sourceClaimIndexes = [...new Set(relationRecords.filter((relation) => relation.kind === "same_identity_alias" &&
        relation.entityId === alias.entityId && relation.alternateName === alias.alias && relation.sourceUnitId === alias.evidence.unitId)
        .map((relation) => relation.sourceClaimIndex).filter((index) => index !== null))];
      return { ...alias, sourceClaimIndex: sourceClaimIndexes.length === 1 ? sourceClaimIndexes[0] : null, sourceClaimIndexes };
    });
    const candidates = next.candidateEntities.map((entity) => ({ ...entity, candidateId: entity.canonicalId, displayName: entity.name,
      typeSourceSupported: entity.type !== "other", establishingEvidence: entity.evidence, firstOccurrence: entity.firstSourceOccurrence,
      relationshipMetadata: relationRecords.filter((relation) => relation.kind === "identity_transition" ?
        [relation.fromEntityId, relation.toEntityId].includes(entity.canonicalId) : relation.entityId === entity.canonicalId),
      aliasMetadata: aliasMetadata.filter((alias) => alias.entityId === entity.canonicalId) }));
    const complete = { ...next, exportMetadata: { proposalIndexBase: 0, relationshipMetadata: relationRecords, aliasMetadata,
      candidateEntityRecords: candidates, candidateEntitiesPromoted: false, modelCalls: 0, apiCalls: 0 } };
    write(`${spec.key}.complete-v2.2.v1.json`, complete);
    write(`${spec.key}.gm-review.v1.json`, next.gmReview);
    write(`${spec.key}.mechanical-only.v1.json`, next.claims.filter((claim) => claim.wikiDisposition === "mechanical_only"));
    write(`${spec.key}.candidate-entities.v1.json`, candidates);
    write(`${spec.key}.comparison-v2.1-to-v2.2.v1.json`, comparison(previous, next));
    summary.benchmarks[spec.key] = summaryFor(next);
    summary.benchmarks[spec.key].changedProposalCount = comparison(previous, next).changedProposals.length;
  }
  for (const file of [...protection, ...sourceFileHashes]) assert(sha(readFileSync(join(root, file.path))) === file.sha256, `Protected input/code changed: ${file.path}`);
  write("machine-summary.v1.json", summary);
  write("input-invariants.v1.json", { version: 1, verified: true, frozenFiles: sourceFileHashes,
    protectedFiles: protection, benchmarks: inputs.map((input) => ({ benchmark: input.spec.key,
      proposalCount: input.spec.count, requestSha256: input.requestHash, proposalChecks: input.proposalChecks })) });
  write("execution-record.v1.json", { ...ledger, protectedCodeAndInputsUnchanged: true, extractionRerun: false,
    candidateEntitiesPromoted: false, pdfBytesIncluded: false });
  const manifest = { version: 1, privateLocalOnly: true, format: "json", payloads: payloads.sort((a, b) => a.path < b.path ? -1 : 1) };
  writeFileSync(join(bundle, "MANIFEST.json"), jsonBytes(manifest), { flag: "wx" });
  for (const payload of manifest.payloads) {
    const bytes = readFileSync(join(bundle, payload.path));
    assert(bytes.length === payload.bytes && sha(bytes) === payload.sha256, `Export manifest verification failed: ${payload.path}`);
  }
  console.log(JSON.stringify({ bundle: resolve(bundle), payloadHashesVerified: manifest.payloads.length,
    summaryPath: join(bundle, "machine-summary.v1.json"), benchmarks: summary.benchmarks }, null, 2));
}
main().catch((error) => { console.error(error?.stack ?? String(error)); process.exitCode = 1; });
