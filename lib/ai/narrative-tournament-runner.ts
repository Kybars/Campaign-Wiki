import { z } from "zod";
import { ADJUDICATION_PROMPT, adjudicationSchema, blindedJudgeInput, scoreAdjudicated, validateAdjudication, type Adjudication, type DevGold, type DevPage } from "./narrative-tournament-evaluation";
import { MAX_ACTUAL_TOKENS, MAX_DISPATCHES, MODEL_ID, narrativeOutputSchema, partitionGrounding, promptVariants, sha256, validateGrounding, type GroundingIssue, type NarrativeOutput } from "./narrative-tournament";

export const RUNNER_VERSION = "narrative-adaptive-5";
export const MAX_REVISIONS = 2;
export const MAX_PLANNED_EXTRACTIONS = 18;
export const MAX_PLANNED_JUDGES = 18;
export const MIN_IMPROVEMENT = 0.02;
export const HISTORICAL_UNRESOLVED_INPUT_RESERVE = 1_050_000;
export const HISTORICAL_UNRESOLVED_OUTPUT_RESERVE = 128_000;

export const revisionDirectives = {
  omission: "Revision focus: recover source-backed motives, history, clues, relationships and consequences that make the narrative coherent; retain clearly named minor entities.",
  modality: "Revision focus: preserve the governing heading and distinguish completed history from rumor, intention, conditional future, and counterfactual outcome in every affected statement.",
  identity: "Revision focus: resolve named identities conservatively; keep existence evidence distinct from facts and avoid unsupported aliases or merges.",
  presentation: "Revision focus: separate entity identity, physical parent and page presentation; attach routine rooms and props while still extracting revelations found inside them.",
  unsupported: "Revision focus: require every asserted clause, participant and relationship to have direct page evidence; omit unsupported elaboration.",
  reading_order: "Revision focus: follow source headings, columns and page continuations before attributing a fact or modality to a section.",
  other: "Revision focus: preserve the exact source-supported meaning and avoid redundant or mechanically focused assertions.",
} as const;
export type FailurePattern = keyof typeof revisionDirectives;

export interface SampleInput { code: string; pages: DevPage[]; sourcePayload: string }
export interface Usage { inputTokens: number; outputTokens: number; totalTokens: number }
export interface ApprovalCaps { maxUsd: number; inputUsdPerMillion: number; outputUsdPerMillion: number; modelMaxOutputTokens: number }
export interface Operation { key: string; kind: "extraction" | "judge"; candidateId: string; sample: string; prompt: string; payload: string; schemaHash: string; schemaJson: string; identityHash: string }
export interface DispatchResult { status: "completed" | "failed_known"; usage: Usage; responseId?: string; output?: unknown; error?: string }
export interface Checkpoint { key: string; kind: Operation["kind"]; identityHash: string; state: "dispatching" | "completed" | "failed_known" | "failed_unknown"; usage?: Usage; historicalReservation?: Usage; responseId?: string; output?: unknown; receivedOutput?: unknown; validationSourcePages?: DevPage[]; validationIssues?: string[]; candidateResponse?: {output:NarrativeOutput;sourcePages:DevPage[];issues:GroundingIssue[];rejectedItemCount:number}; error?: string; outputAllowance: number }
export interface Revision { id: "revision_1" | "revision_2"; parentId: string; pattern: FailurePattern; prompt: string; promptHash: string }
export interface HistoricalLedger { planHash:string; ledgerHash:string; checkpoints:Checkpoint[] }
export interface TournamentState { planHash: string; history?:HistoricalLedger|null; checkpoints: Checkpoint[]; revisions: Revision[]; status: "running" | "complete" | "plateau" | "budget_stop" | "no_complete_candidate"; comparison?: TournamentComparison }
export interface CandidateResult { id: string; promptHash: string; scores: Array<ReturnType<typeof scoreAdjudicated>>; quality: number | null; actualTokens: number; estimatedCostUsd: number; complete: boolean; failures: string[]; patternTotals: Record<string,number> }
export interface TournamentComparison { status: TournamentState["status"]; selectedId: string | null; candidates: CandidateResult[]; actualDispatches: number; actualTokens: number; chargedTokensIncludingReservation:number; reservedUnknownTokens:number; estimatedCostUsd: number; provisional: true; recommendedAuditSample: Array<{candidateId:string;sample:string;rowId:string;reason:string;sourcePage:number|null;sourceQuote:string}>; caveat: string }
export interface AcceptanceComparison { phase:"acceptance_only"; planHash:string; newDispatches:number; historicalDispatches:number; chargedTokensIncludingReservation:number; sources:Array<{sample:string;extractionState:string;judgeState:string;accepted:{propositions:string[];entities:string[];relationships:string[];sourceDiscrepancies:string[]};rejected:Array<{kind:string;outputId:string;categories:string[];reasons:string[]}>;groundingErrorCategories:Record<string,number>;provisionalQuality:number|null;inputTokens:number;outputTokens:number;totalTokens:number}>; allSourcesGroundedAndScored:boolean; provisional:true }

export function operationIdentity(kind: Operation["kind"], candidateId: string, sample: string, prompt: string, payload: string, schemaHash: string, upstreamHash: string) {
  return sha256(JSON.stringify({ version: RUNNER_VERSION, provider: "openai", model: MODEL_ID, kind, candidateId, sample, prompt, payload, schemaHash, upstreamHash }));
}
export function budgetUsage(checkpoints: Checkpoint[]) {
  const charged = checkpoints.map(c=>c.usage??c.historicalReservation).filter((u):u is Usage=>!!u);
  return { dispatches: checkpoints.length, inputTokens: charged.reduce((n,u)=>n+u.inputTokens,0), outputTokens: charged.reduce((n,u)=>n+u.outputTokens,0), totalTokens: charged.reduce((n,u)=>n+u.totalTokens,0) };
}
export function reserveNext(checkpoints: Checkpoint[], caps: ApprovalCaps, requestText: string) {
  if (checkpoints.some(c=>(c.state==="dispatching" || c.state==="failed_unknown" || !c.usage) && !c.historicalReservation)) throw new Error("Ambiguous or uncharged dispatch blocks continuation");
  for(const c of checkpoints) if(c.historicalReservation){const r=c.historicalReservation;if(c.usage || !["extract:relevance_gated:SW","history:a34d058ad7957501b3440db1824f74077fcedbe7434bf16c36d1dde1595d5d56:extract:relevance_gated:SW"].includes(c.key) || c.identityHash!=="6ea4c1eb9aec189821c42f4322232d283ffc6b3b485e53935c78895bccf6f8f5" || c.state!=="dispatching" || c.outputAllowance!==HISTORICAL_UNRESOLVED_OUTPUT_RESERVE || r.inputTokens!==HISTORICAL_UNRESOLVED_INPUT_RESERVE || r.outputTokens!==HISTORICAL_UNRESOLVED_OUTPUT_RESERVE || r.totalTokens!==HISTORICAL_UNRESOLVED_INPUT_RESERVE+HISTORICAL_UNRESOLVED_OUTPUT_RESERVE)throw new Error("Invalid historical reservation");validateUsage(r);}
  if (checkpoints.length >= MAX_DISPATCHES) return null;
  if (![caps.maxUsd,caps.inputUsdPerMillion,caps.outputUsdPerMillion].every(n=>Number.isFinite(n)&&n>0) || !Number.isSafeInteger(caps.modelMaxOutputTokens) || caps.modelMaxOutputTokens<1) throw new Error("Approved cap, rates and model output limit required");
  const used = budgetUsage(checkpoints);
  const inputReserve = Buffer.byteLength(requestText,"utf8")+8192;
  const moneyUsed = (used.inputTokens*caps.inputUsdPerMillion+used.outputTokens*caps.outputUsdPerMillion)/1_000_000;
  const outputByTokens = MAX_ACTUAL_TOKENS-used.totalTokens-inputReserve;
  const outputByMoney = Math.floor(((caps.maxUsd-moneyUsed)*1_000_000-inputReserve*caps.inputUsdPerMillion)/caps.outputUsdPerMillion);
  const outputAllowance = Math.min(caps.modelMaxOutputTokens,outputByTokens,outputByMoney);
  if (outputAllowance<1) return null;
  return { inputReserve, outputAllowance, reservedTokens: inputReserve+outputAllowance, reservedUsd: (inputReserve*caps.inputUsdPerMillion+outputAllowance*caps.outputUsdPerMillion)/1_000_000 };
}
export function validateUsage(usage: Usage) {
  if (![usage.inputTokens,usage.outputTokens,usage.totalTokens].every(n=>Number.isSafeInteger(n)&&n>=0) || usage.totalTokens<usage.inputTokens+usage.outputTokens) throw new Error("Unknown or inconsistent actual usage");
}
const failures = ["modality","omission","identity","presentation","unsupported","reading_order","other"] as const;
export function selectFailurePattern(patternTotals: Record<string,number>, used: FailurePattern[]): FailurePattern | null {
  const eligible = failures.filter(p=>!used.includes(p) && (patternTotals[p]??0)>0);
  return eligible.sort((a,b)=>(patternTotals[b]??0)-(patternTotals[a]??0) || failures.indexOf(a)-failures.indexOf(b))[0] ?? null;
}
export function candidateQuality(scores: Array<ReturnType<typeof scoreAdjudicated>>) {
  if (scores.length!==3) return null;
  const values=scores.map(s=>s.quality);
  return 0.8*(values.reduce((a,b)=>a+b,0)/3)+0.2*Math.min(...values);
}
export function selectBest(candidates: CandidateResult[]) {
  const viable=candidates.filter(c=>c.complete&&c.quality!==null);
  const maximum=Math.max(...viable.map(c=>c.quality!));
  return viable.filter(c=>maximum-c.quality!<MIN_IMPROVEMENT).sort((a,b)=>a.actualTokens-b.actualTokens || b.quality!-a.quality! || a.id.localeCompare(b.id))[0] ?? null;
}

export interface RunnerDeps {
  planHash: string; samples: SampleInput[]; gold: DevGold; caps: ApprovalCaps;
  history?: HistoricalLedger | null;
  load(): TournamentState | null; save(state: TournamentState): void;
  dispatch(operation: Operation, outputAllowance: number): Promise<DispatchResult>;
}

export function runTournament(deps: RunnerDeps): Promise<TournamentComparison>;
export function runTournament(deps: RunnerDeps, phase:"acceptance"): Promise<AcceptanceComparison>;
export async function runTournament(deps: RunnerDeps, phase:"full"|"acceptance"="full"): Promise<TournamentComparison|AcceptanceComparison> {
  const state = deps.load() ?? { planHash: deps.planHash, history: deps.history??null, checkpoints: [], revisions: [], status: "running" as const };
  if (state.planHash!==deps.planHash) throw new Error("Checkpoint plan hash mismatch");
  if (JSON.stringify(state.history??null)!==JSON.stringify(deps.history??null)) throw new Error("Historical paid ledger mismatch");
  const historical = state.history?.checkpoints??[];
  if (deps.samples.length!==3 || new Set(deps.samples.map(s=>s.code)).size!==3) throw new Error("Exactly three distinct development samples required");
  if (state.checkpoints.length+historical.length>MAX_DISPATCHES || state.revisions.length>MAX_REVISIONS || new Set(state.checkpoints.map(c=>c.key)).size!==state.checkpoints.length) throw new Error("Checkpoint ledger integrity failure");
  if(state.checkpoints.some(c=>c.historicalReservation))throw new Error("Only pinned historical dispatch may carry an unknown-usage reservation");
  for(const c of [...historical,...state.checkpoints]){if(c.usage)validateUsage(c.usage);if(c.historicalReservation)validateUsage(c.historicalReservation);if((c.state==="dispatching"||c.state==="failed_unknown"||!c.usage)&&!c.historicalReservation)throw new Error("Ambiguous prior dispatch; stop for reconciliation");}
  if(phase==="acceptance" && state.checkpoints.some(c=>!deps.samples.some(s=>c.key===`extract:narrative_first:${s.code}`||c.key===`judge:narrative_first:${s.code}`)))throw new Error("Acceptance phase contains non-acceptance work");
  if(state.status!=="running" && state.comparison) return state.comparison;
  const prompts: Record<string,string> = { ...promptVariants };
  for(const revision of state.revisions){
    const expected = `${prompts[revision.parentId]}\n${revisionDirectives[revision.pattern]}`;
    if(!prompts[revision.parentId] || revision.prompt!==expected || revision.promptHash!==sha256(expected)) throw new Error("Revision checkpoint integrity failure");
    prompts[revision.id]=revision.prompt;
  }
  let budgetStopped=false;
  async function step(op:Operation, outputKind:"extraction"|"judge", sample:SampleInput, extraction?:NarrativeOutput):Promise<unknown|null>{
    const prior=state.checkpoints.find(c=>c.key===op.key);
    if(prior){
      if(prior.identityHash!==op.identityHash || prior.kind!==op.kind) throw new Error("Checkpoint identity mismatch");
      if(prior.state==="failed_known") return null;
      if(prior.state!=="completed" || !prior.output) throw new Error("Invalid completed checkpoint");
      if(outputKind==="extraction") { const parsed=narrativeOutputSchema.parse(prior.output); if(validateGrounding(parsed,sample.pages).length) throw new Error("Stored extraction grounding failure"); return parsed; }
      return validateAdjudication(prior.output,deps.gold,sample.code,extraction!,sample.pages);
    }
    const requestText=JSON.stringify({prompt:op.prompt,payload:op.payload,schema:op.schemaJson});
    const reservation=reserveNext([...historical,...state.checkpoints],deps.caps,requestText);
    if(!reservation){budgetStopped=true;return null;}
    const checkpoint:Checkpoint={key:op.key,kind:op.kind,identityHash:op.identityHash,state:"dispatching",outputAllowance:reservation.outputAllowance};
    state.checkpoints.push(checkpoint);deps.save(state);
    let result:DispatchResult;
    try{result=await deps.dispatch(op,reservation.outputAllowance);}catch(error){checkpoint.state="failed_unknown";checkpoint.error=error instanceof Error?error.message:String(error);deps.save(state);throw new Error("Ambiguous dispatch or unknown usage; stop for reconciliation");}
    try{validateUsage(result.usage);}catch(error){checkpoint.state="failed_unknown";checkpoint.error=error instanceof Error?error.message:String(error);deps.save(state);throw error;}
    checkpoint.usage=result.usage;checkpoint.responseId=result.responseId;deps.save(state);
    const used=budgetUsage([...historical,...state.checkpoints]);
    const dollars=(used.inputTokens*deps.caps.inputUsdPerMillion+used.outputTokens*deps.caps.outputUsdPerMillion)/1_000_000;
    if(result.usage.inputTokens>reservation.inputReserve || result.usage.outputTokens>reservation.outputAllowance || result.usage.totalTokens>reservation.reservedTokens || used.totalTokens>MAX_ACTUAL_TOKENS || dollars>deps.caps.maxUsd){checkpoint.state="failed_unknown";checkpoint.error="Budget reservation discrepancy";deps.save(state);throw new Error("Budget discrepancy; stop");}
    if(result.status==="failed_known" || !result.output){checkpoint.state="failed_known";checkpoint.error=result.error??"Known-use failed response";deps.save(state);return null;}
    const parsed=outputKind==="extraction"?narrativeOutputSchema.safeParse(result.output):adjudicationSchema.safeParse(result.output);
    if(!parsed.success){checkpoint.state="failed_known";checkpoint.error="Structured output failed schema validation";deps.save(state);return null;}
    const output=parsed.data;
    checkpoint.receivedOutput=output;checkpoint.validationSourcePages=sample.pages;checkpoint.validationIssues=[];deps.save(state);
    if(outputKind==="extraction"){
      // Durable private evidence precedes any grounding decision, including a crash in validation.
      checkpoint.candidateResponse={output:output as NarrativeOutput,sourcePages:sample.pages,issues:[],rejectedItemCount:0};deps.save(state);
      const partition=partitionGrounding(output as NarrativeOutput,sample.pages);
      checkpoint.candidateResponse.issues=partition.issues;
      checkpoint.candidateResponse.rejectedItemCount=partition.rejectedItemCount;
      checkpoint.validationIssues=partition.issues.map(i=>`${i.kind}[${i.index}] ${i.outputId}: ${i.reason}`);
      deps.save(state);
      if(!partition.usable){checkpoint.state="failed_known";checkpoint.error=`Entire candidate unusable: ${partition.rejectedItemCount} rejected items, ${partition.issues.length} grounding issues; ${partition.issues.map(i=>`${i.kind}[${i.index}] ${i.reason}`).join("; ")||"no narrative items returned"}`;deps.save(state);return null;}
      checkpoint.output=partition.accepted;checkpoint.state="completed";deps.save(state);return partition.accepted;
    }else{
      try{validateAdjudication(output,deps.gold,sample.code,extraction!,sample.pages);}
      catch(error){checkpoint.state="failed_unknown";checkpoint.error=error instanceof Error?error.message:String(error);checkpoint.validationIssues=[checkpoint.error];deps.save(state);throw new Error(`Judge integrity failure; stop: ${checkpoint.error}`);}
    }
    checkpoint.output=output;checkpoint.state="completed";deps.save(state);return output;
  }
  function extractionOp(candidateId:string,sample:SampleInput):Operation{
    const prompt=prompts[candidateId],payload=sample.sourcePayload,schemaJson=JSON.stringify(z.toJSONSchema(narrativeOutputSchema)),schemaHash=sha256(schemaJson);
    return {key:`extract:${candidateId}:${sample.code}`,kind:"extraction",candidateId,sample:sample.code,prompt,payload,schemaHash,schemaJson,
      identityHash:operationIdentity("extraction",candidateId,sample.code,prompt,payload,schemaHash,deps.planHash)};
  }
  function judgeOp(candidateId:string,sample:SampleInput,output:NarrativeOutput):Operation{
    const prompt=ADJUDICATION_PROMPT,payload=JSON.stringify(blindedJudgeInput(deps.gold,sample.code,output,sample.pages)),schemaJson=JSON.stringify(z.toJSONSchema(adjudicationSchema)),schemaHash=sha256(schemaJson);
    return {key:`judge:${candidateId}:${sample.code}`,kind:"judge",candidateId,sample:sample.code,prompt,payload,schemaHash,schemaJson,
      identityHash:operationIdentity("judge",candidateId,sample.code,prompt,payload,schemaHash,sha256(JSON.stringify(output)))};
  }
  async function evaluateCandidate(candidateId:string):Promise<CandidateResult>{
    const outputs=new Map<string,NarrativeOutput>();
    // All three source extractions are independent, so a known-use failure does not cancel peers.
    for(const sample of deps.samples){if(budgetStopped)break;const output=await step(extractionOp(candidateId,sample),"extraction",sample) as NarrativeOutput|null;if(output)outputs.set(sample.code,output);}
    const scores:CandidateResult["scores"]=[];
    for(const sample of deps.samples){if(budgetStopped)break;const output=outputs.get(sample.code);if(!output)continue;const adjudication=await step(judgeOp(candidateId,sample,output),"judge",sample,output) as Adjudication|null;if(adjudication){const extraction=state.checkpoints.find(c=>c.key===`extract:${candidateId}:${sample.code}`);scores.push(scoreAdjudicated(deps.gold,sample.code,output,sample.pages,adjudication,extraction?.candidateResponse?.rejectedItemCount??0));}}
    const own=state.checkpoints.filter(c=>c.key.includes(`:${candidateId}:`));
    const usage=budgetUsage(own);
    const patternTotals=scores.reduce<Record<string,number>>((acc,s)=>{for(const [p,n] of Object.entries(s.patterns))acc[p]=(acc[p]??0)+n;return acc;},{});
    return {id:candidateId,promptHash:sha256(prompts[candidateId]),scores,quality:candidateQuality(scores),complete:scores.length===3,
      actualTokens:usage.totalTokens,estimatedCostUsd:(usage.inputTokens*deps.caps.inputUsdPerMillion+usage.outputTokens*deps.caps.outputUsdPerMillion)/1_000_000,
      failures:own.filter(c=>c.state==="failed_known").map(c=>c.key),patternTotals};
  }
  if(phase==="acceptance"){
    await evaluateCandidate("narrative_first");
    if(state.checkpoints.length>6)throw new Error("Acceptance request ceiling exceeded");
    const sources=deps.samples.map(sample=>{
      const extraction=state.checkpoints.find(c=>c.key===`extract:narrative_first:${sample.code}`);
      const judge=state.checkpoints.find(c=>c.key===`judge:narrative_first:${sample.code}`);
      const accepted=extraction?.state==="completed"?extraction.output as NarrativeOutput|null:null;
      const issues=extraction?.candidateResponse?.issues??[];
      const groundingErrorCategories:Record<string,number>={};
      for(const issue of issues){const category=issue.reason.split(":",1)[0];groundingErrorCategories[category]=(groundingErrorCategories[category]??0)+1;}
      const score=accepted&&judge?.state==="completed"?scoreAdjudicated(deps.gold,sample.code,accepted,sample.pages,judge.output as Adjudication,extraction?.candidateResponse?.rejectedItemCount??0):null;
      const usage=budgetUsage([extraction,judge].filter((c):c is Checkpoint=>!!c));
      const rejected=new Map<string,{kind:string;outputId:string;categories:string[];reasons:string[]}>();
      for(const issue of issues){const key=`${issue.kind}:${issue.index}`;const row=rejected.get(key)??{kind:issue.kind,outputId:issue.outputId,categories:[],reasons:[]};row.categories.push(issue.reason.split(":",1)[0]);row.reasons.push(issue.reason);rejected.set(key,row);}
      return {sample:sample.code,extractionState:extraction?.state??"not_dispatched",judgeState:judge?.state??"not_dispatched",accepted:{propositions:accepted?.propositions.map(p=>p.id)??[],entities:accepted?.entities.map(e=>e.name)??[],relationships:accepted?.relationships.map(r=>`${r.source} | ${r.label} | ${r.target}`)??[],sourceDiscrepancies:accepted?.sourceDiscrepancies.map(d=>`page:${d.page}`)??[]},rejected:[...rejected.values()],groundingErrorCategories,provisionalQuality:score?.quality??null,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,totalTokens:usage.totalTokens};
    });
    deps.save(state);
    return {phase:"acceptance_only",planHash:deps.planHash,newDispatches:state.checkpoints.length,historicalDispatches:historical.length,chargedTokensIncludingReservation:budgetUsage([...historical,...state.checkpoints]).totalTokens,sources,allSourcesGroundedAndScored:sources.every(s=>s.accepted.propositions.length+s.accepted.entities.length+s.accepted.relationships.length>0 && s.provisionalQuality!==null && s.provisionalQuality>0),provisional:true};
  }
  const candidates:CandidateResult[]=[];
  // Freeze and dispatch the twelve independent first-round extractions before
  // any judge output can influence selection or revisions.
  for(const id of Object.keys(promptVariants))for(const sample of deps.samples){
    if(budgetStopped)break;
    await step(extractionOp(id,sample),"extraction",sample);
  }
  for(const id of Object.keys(promptVariants)){if(budgetStopped)break;candidates.push(await evaluateCandidate(id));}
  let best=selectBest(candidates);
  for(let round=1;round<=MAX_REVISIONS && !budgetStopped && best;round++){
    const used=state.revisions.map(r=>r.pattern);
    const pattern=selectFailurePattern(best.patternTotals,used);
    if(!pattern)break;
    const id=`revision_${round}` as Revision["id"];
    const prompt=`${prompts[best.id]}\n${revisionDirectives[pattern]}`;
    const existing=state.revisions.find(r=>r.id===id);
    if(existing && (existing.parentId!==best.id || existing.pattern!==pattern || existing.prompt!==prompt)) throw new Error("Revision selection changed across resume");
    if(!existing){state.revisions.push({id,parentId:best.id,pattern,prompt,promptHash:sha256(prompt)});deps.save(state);}
    prompts[id]=prompt;
    const revised=await evaluateCandidate(id);candidates.push(revised);
    if(!revised.complete || revised.quality===null || revised.quality-best.quality!<MIN_IMPROVEMENT){state.status="plateau";break;}
    best=revised;
  }
  if(budgetStopped)state.status="budget_stop";
  else if(!best)state.status="no_complete_candidate";
  else if(state.status==="running")state.status="complete";
  const all=budgetUsage([...historical,...state.checkpoints]);
  const auditFindings=state.checkpoints.filter(c=>c.kind==="judge"&&c.state==="completed"&&c.output).flatMap(c=>{
    const result=c.output as Adjudication;
    const [,candidateId,sample]=c.key.split(":");
    return [
      ...result.propositions.filter(x=>x.verdict==="uncertain"||x.uncertainty==="high").map(x=>({candidateId,sample,rowId:x.goldId,reason:`proposition: ${x.reason}`,sourcePage:x.evidence.page,sourceQuote:x.evidence.quote})),
      ...result.entities.filter(x=>x.verdict==="uncertain"||x.uncertainty==="high").map(x=>({candidateId,sample,rowId:x.goldId,reason:`entity: ${x.reason}`,sourcePage:x.evidence.page,sourceQuote:x.evidence.quote})),
      ...result.negativeChecks.filter(x=>x.verdict!=="pass").map(x=>({candidateId,sample,rowId:x.goldId,reason:`negative check ${x.verdict}: ${x.reason}`,sourcePage:x.evidence.page,sourceQuote:x.evidence.quote})),
      ...result.unsupportedOutputs.map(x=>({candidateId,sample,rowId:x.outputId,reason:`output ${x.verdict}: ${x.reason}`,sourcePage:x.evidence.page,sourceQuote:x.evidence.quote})),
      ...result.unsupportedEntities.map(x=>({candidateId,sample,rowId:x.outputName,reason:`unsupported entity: ${x.reason}`,sourcePage:x.evidence.page,sourceQuote:x.evidence.quote})),
    ];
  });
  const recommendedAuditSample=auditFindings.sort((a,b)=>Number(b.candidateId===best?.id)-Number(a.candidateId===best?.id)||a.sample.localeCompare(b.sample)||a.rowId.localeCompare(b.rowId)).slice(0,12);
  const reservedUnknownTokens=historical.reduce((n,c)=>n+(c.historicalReservation?.totalTokens??0),0);
  const comparison:TournamentComparison={status:state.status,selectedId:best?.id??null,candidates,actualDispatches:all.dispatches,actualTokens:all.totalTokens-reservedUnknownTokens,chargedTokensIncludingReservation:all.totalTokens,reservedUnknownTokens,
    estimatedCostUsd:(all.inputTokens*deps.caps.inputUsdPerMillion+all.outputTokens*deps.caps.outputUsdPerMillion)/1_000_000,provisional:true,recommendedAuditSample,
    caveat:"Development-set automated adjudication is provisional. Uncertainty and disputed gold require focused human audit before product or holdout claims."};
  state.comparison=comparison;deps.save(state);return comparison;
}
