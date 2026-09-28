import { describe, expect, it } from "vitest";
import { ADJUDICATION_PROMPT, type DevGold } from "../lib/ai/narrative-tournament-evaluation";
import { promptVariants, sha256 } from "../lib/ai/narrative-tournament";
import { RUNNER_VERSION, revisionDirectives, type TournamentState } from "../lib/ai/narrative-tournament-runner";
import { buildPromptComparison, readablePromptDiff } from "../lib/ai/narrative-tournament-report";

const plan = {
  planHash: "synthetic-frozen-plan", model: "gpt-6-luna", version: RUNNER_VERSION,
  baselinePromptHashes: Object.fromEntries(Object.entries(promptVariants).map(([name, prompt]) => [name, sha256(prompt)])),
  judgePromptHash: sha256(ADJUDICATION_PROMPT),
  sampleInputHashes: ["SW", "WOTBS", "TALES"].map(sample => ({ sample })),
};
const gold: DevGold = {
  claims: [{ id: "SW-G", sample: "SW", importance: 3, subjects: ["Mira"], modality: "established", physicalPdfPage: 1, expectedProposition: "Mira left.", sourceAnchor: "Mira left." }],
  entities: [], negativeChecks: [],
};

describe("private prompt comparison export", () => {
  it("prints complete frozen prompts and judge without inventing preflight results or tokens", () => {
    const report = buildPromptComparison(plan, gold, null);
    for (const [name, prompt] of Object.entries(promptVariants)) {
      expect(report.markdown).toContain(`## ${name}`);
      expect(report.markdown).toContain(`\n${prompt}\n`);
      expect(report.markdown).toContain(sha256(prompt));
    }
    expect(report.markdown).toContain(`\n${ADJUDICATION_PROMPT}\n`);
    expect(report.markdown).toContain("No observed quality or token comparison is possible");
    expect(report.markdown).toContain("**not available**");
    expect(report.markdown).not.toContain("0 input + 0 output = 0 total tokens");
    expect(report.details.status).toBe("offline_preflight");
  });

  it("exports saved adaptive text, exact changes, provisional findings and actual tokens", () => {
    const revisionPrompt = `${promptVariants.baseline}\n${revisionDirectives.omission}`;
    const output = { propositions: [{ id: "p1", statement: "Mira left.", modality: "established", subjects: ["Mira"], evidence: [{ page: 1, quote: "Mira left." }] }], entities: [], relationships: [], sourceDiscrepancies: [] };
    const judge = { propositions: [{ goldId: "SW-G", outputIds: ["p1"], verdict: "correct", modalityCorrect: true, evidence: { page: 1, quote: "Mira left." }, uncertainty: "low", failurePattern: "none", reason: "Supported by source." }], entities: [], negativeChecks: [], unsupportedOutputs: [], unsupportedEntities: [] };
    const state: TournamentState = {
      planHash: plan.planHash, status: "plateau", revisions: [{ id: "revision_1", parentId: "baseline", pattern: "omission", prompt: revisionPrompt, promptHash: sha256(revisionPrompt) }],
      checkpoints: [
        { key: "extract:revision_1:SW", kind: "extraction", identityHash: "synthetic-extract", state: "completed", usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 }, outputAllowance: 1000, output },
        { key: "judge:revision_1:SW", kind: "judge", identityHash: "synthetic-judge", state: "completed", usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 }, outputAllowance: 1000, output: judge },
      ],
      comparison: { status: "plateau", selectedId: "revision_1", candidates: [{ id: "revision_1", promptHash: sha256(revisionPrompt), scores: [{ sample: "SW", quality: 1, propositionPoints: 3, weightedTotal: 3, identityPoints: 1, relationshipPoints: 1, presentationPoints: 1, negativePassed: 0, unsupportedCount: 0, uncertainCount: 0, exactDraftMatches: 1, patterns: {}, status: "provisional_blinded_adjudication" }], quality: 1, actualTokens: 300, estimatedCostUsd: 0.01, complete: false, failures: [], patternTotals: {} }], actualDispatches: 2, actualTokens: 300, chargedTokensIncludingReservation:300, reservedUnknownTokens:0, estimatedCostUsd: 0.01, provisional: true, recommendedAuditSample: [], caveat: "Synthetic provisional record" },
    };
    const report = buildPromptComparison(plan, gold, state);
    expect(report.markdown).toContain(`\n${revisionPrompt}\n`);
    expect(report.markdown).toContain(`+ ${revisionDirectives.omission}`);
    expect(report.markdown).toContain("210 input + 90 output = 300 total tokens");
    expect(report.markdown).toContain("SW-G");
    expect(report.markdown).toContain("physical PDF p. 1");
    expect(report.markdown).not.toContain("actual cost");
    expect(report.details.versions).toHaveLength(5);
    const tampered = structuredClone(state);
    tampered.revisions[0].promptHash = "wrong";
    expect(() => buildPromptComparison(plan, gold, tampered)).toThrow(/Revision prompt integrity/);
  });

  it("rejects a changed frozen initial prompt or judge hash", () => {
    expect(() => buildPromptComparison({ ...plan, judgePromptHash: "wrong" }, gold, null)).toThrow(/judge prompt hash/);
    expect(() => buildPromptComparison({ ...plan, baselinePromptHashes: { ...plan.baselinePromptHashes, baseline: "wrong" } }, gold, null)).toThrow(/initial prompt hash/);
    expect(readablePromptDiff("One. Two.", "One. Three.")).toContain("- Two.");
  });
});
