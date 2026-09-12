import { summarizePaidCallPlan } from "@/lib/ai/openai-call-budget";

const openAIBlocked = summarizePaidCallPlan("openai", [{ status: "REUSE" }, { status: "RUN" }, { status: "INVALIDATED" }], 2, 3);
const localAllowed = summarizePaidCallPlan("local", [{ status: "REUSE" }, { status: "RUN" }], 0, 3);

console.log(JSON.stringify({
  mode: "deterministic failure/resume dry-run",
  failuresInjected: ["provider-unavailable", "corrupt-checkpoint", "budget-exceeded"],
  checkpointReuse: { reused: 1, rerun: 2, invalidated: 1 },
  openAI: openAIBlocked,
  local: localAllowed,
  actualModelCalls: 0,
  writesDuringDryRun: 0,
}, null, 2));
