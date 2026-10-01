import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFrozenClaims41Benchmarks } from "../lib/ai/claims-4-1-benchmarks";
import { claims41OutputSchema, reconcileClaims41 } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41V2 } from "../lib/ai/claims-4-1-reconciliation-v2";

async function main() {
  if (process.argv.length !== 2) throw new Error("This runner is offline only and takes no dispatch options");
  const inputPath = join(process.cwd(), "fixtures/private/claims4-1-v1/test9-claims4-1-2.result.v1.json");
  const saved = JSON.parse(readFileSync(inputPath, "utf8")) as { originalParsedOutput: unknown; reconciled: { diagnostics: unknown } };
  const original = claims41OutputSchema.parse(saved.originalParsedOutput);
  if (original.claims.length !== 106) throw new Error(`Expected exactly 106 original proposals; found ${original.claims.length}`);
  const request = (await loadFrozenClaims41Benchmarks()).flatMap((benchmark) => benchmark.requests)
    .find((item) => item.requestId === "test9-claims4-1-2");
  if (!request) throw new Error("Frozen WotBS Claims-4.1 request is missing");
  const old = reconcileClaims41(original, request);
  if (JSON.stringify(old.diagnostics) !== JSON.stringify(saved.reconciled.diagnostics) ||
      old.diagnostics.byState.ready !== 70 || old.diagnostics.byState.pending_identity !== 36)
    throw new Error("Old reconciliation no longer reproduces saved 70/36 result");
  const next = reconcileClaims41V2(original, request);
  if (next.claims.length !== 106 || next.claims.some((item, index) => item.original !== next.rawProposals.claims[index]))
    throw new Error("V2 did not preserve every original proposal in order");
  const transitionMatrix: Record<string, Record<string, number>> = {};
  for (const claim of next.claims) {
    const from = old.proposals[claim.proposalIndex].state;
    transitionMatrix[from] ??= { resolved: 0, needs_review: 0 };
    transitionMatrix[from][claim.resolutionState]++;
  }
  const participantCounts = { canonical_entity: 0, descriptor: 0, generic_non_entity: 0, unresolved: 0 };
  for (const claim of next.claims) for (const item of claim.participants) participantCounts[item.kind]++;
  const mainByMonth = Object.fromEntries(["November", "December", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October"]
    .map((month) => [month, next.claims.filter((claim) => claim.timelineAssociation?.branch === "main_assuming_heroes_succeed" && claim.timelineAssociation.timeLabel === month).length]));
  const changedEntityAssociations = next.claims.flatMap((claim) => {
    const previous = [...new Set(old.proposals[claim.proposalIndex].participants.map((item) => item.canonicalId).filter(Boolean))].sort();
    const current = claim.entityAssociations.map((item) => item.canonicalId).sort();
    return JSON.stringify(previous) === JSON.stringify(current) ? [] : [{ proposalIndex: claim.proposalIndex,
      statement: claim.original.statement, previous, current,
      previousNames: old.proposals[claim.proposalIndex].participants.filter((item) => item.canonicalId).map((item) => item.name),
      currentNames: claim.entityAssociations.map((item) => item.canonicalName) }];
  });
  const metrics = { originalProposals: 106, old: old.diagnostics.byState, new: next.diagnostics,
    transitionMatrix, participantCounts, timelineAssociated: next.claims.filter((claim) => claim.timelineAssociation).length,
    mainByMonth, heroesDoNothing: next.claims.filter((claim) => claim.timelineAssociation?.branch === "heroes_do_nothing").length,
    entityAssociated: next.claims.filter((claim) => claim.entityAssociations.length).length,
    resolvedSolelyThroughTimeline: next.claims.filter((claim) => claim.resolutionState === "resolved" && claim.timelineAssociation && !claim.entityAssociations.length).length,
    noUsefulHome: next.claims.filter((claim) => !claim.timelineAssociation && !claim.entityAssociations.length).length,
    unresolvedIdentityCases: next.claims.filter((claim) => claim.participants.some((item) => item.kind === "unresolved"))
      .map((claim) => ({ proposalIndex: claim.proposalIndex, mentions: claim.participants.filter((item) => item.kind === "unresolved").map((item) => item.mention) })),
    changedEntityAssociations };
  const directory = join(process.cwd(), "fixtures/private/claims4-1-v2");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "comparison.v2.json");
  writeFileSync(path, `${JSON.stringify({ metrics, claims: next.claims, gmReview: next.gmReview }, null, 2)}\n`);
  console.log(JSON.stringify({ path, ...metrics, changedEntityAssociations: changedEntityAssociations.map((item) => item.proposalIndex) }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
