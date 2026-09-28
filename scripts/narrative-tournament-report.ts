import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPromptComparison, type FrozenReportPlan } from "../lib/ai/narrative-tournament-report";
import { sha256 } from "../lib/ai/narrative-tournament";
import type { DevGold } from "../lib/ai/narrative-tournament-evaluation";
import type { TournamentState } from "../lib/ai/narrative-tournament-runner";
import { RUNNER_VERSION } from "../lib/ai/narrative-tournament-runner";

// This exporter deliberately sits outside the plan-hashed runner and reads only
// development records. It never imports the holdout entry point or its bundle.
const root = join(process.cwd(), "fixtures", "private", "narrative-dev");
const dir = join(root, "tournament");
const mode = process.argv[2] ?? "--preflight";
if (mode !== "--preflight" && mode !== "--final") throw new Error("Use --preflight or --final");

const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")) as FrozenReportPlan & { scoringHash: string };
const scoringBytes = readFileSync(join(root, "campaign_wiki_DEV_scoring.json"));
if (sha256(scoringBytes) !== plan.scoringHash) throw new Error("Development scoring bytes differ from frozen plan");
const gold = JSON.parse(scoringBytes.toString("utf8")) as DevGold;

let state: TournamentState | null = null;
if (mode === "--final") {
  const progressPath = join(dir, `paid-progress-${RUNNER_VERSION}.json`);
  const comparisonPath = join(dir, "comparison.json");
  if (!existsSync(progressPath) || !existsSync(comparisonPath)) throw new Error("Saved paid development run and comparison required for final report");
  state = JSON.parse(readFileSync(progressPath, "utf8")) as TournamentState;
  if (state.status === "running" || !state.comparison) throw new Error("Development comparison is not terminal");
  if ([...(state.history?.checkpoints??[]),...state.checkpoints].some(c => !c.usage || c.state === "dispatching" || c.state === "failed_unknown")) throw new Error("Unknown or unresolved development usage; report refused");
  const saved = JSON.parse(readFileSync(comparisonPath, "utf8")) as { planHash: string } & TournamentState["comparison"];
  if (saved.planHash !== plan.planHash || JSON.stringify({ ...saved, planHash: undefined }) !== JSON.stringify({ ...state.comparison, planHash: undefined })) {
    throw new Error("Saved development comparison does not match checkpoint state");
  }
}

const report = buildPromptComparison(plan, gold, state);
function save(path: string, value: string) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, value, "utf8");
  renameSync(temp, path);
}
save(join(dir, "PROMPT_COMPARISON.md"), `${report.markdown}\n`);
save(join(dir, "PROMPT_COMPARISON_DETAILS.json"), `${JSON.stringify(report.details, null, 2)}\n`);
console.log(JSON.stringify({ mode, planHash: plan.planHash, paidDispatches: state?.comparison?.actualDispatches ?? 0, report: join(dir, "PROMPT_COMPARISON.md"), details: join(dir, "PROMPT_COMPARISON_DETAILS.json") }));
