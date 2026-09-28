import { z } from "zod";
import { ADJUDICATION_PROMPT, adjudicationSchema, blindedJudgeInput, scoreAdjudicated, validateAdjudication, type DevGold } from "./narrative-tournament-evaluation";
import { MAX_ACTUAL_TOKENS, MAX_DISPATCHES, narrativeOutputSchema, partitionGrounding, promptVariants, sha256, validateGrounding, type NarrativeOutput } from "./narrative-tournament";
import { budgetUsage, operationIdentity, reserveNext, revisionDirectives, selectBest, validateUsage, type ApprovalCaps, type CandidateResult, type Checkpoint, type DispatchResult, type Operation, type SampleInput, type TournamentState } from "./narrative-tournament-runner";

export const HOLDOUT_VERSION = "isolated-finalist-holdout-3";
export const HOLDOUT_FINALISTS = 2;
export const HOLDOUT_PLANNED_EXTRACTIONS = 2;
export const HOLDOUT_PLANNED_JUDGES = 2;

export interface HoldoutHandoff {
  version: typeof HOLDOUT_VERSION;
  developmentPlanHash: string;
  authorizationHash: string;
  finalistPrompts: Array<{ id: string; prompt: string; promptHash: string }>;
  developmentLedger: Array<Pick<Checkpoint,"key"|"kind"|"identityHash"|"state"|"usage"|"historicalReservation"|"outputAllowance">>;
  developmentLedgerHash: string;
  developmentDispatches: number;
  developmentTokens: number;
  frozenEvaluationHash: string;
  handoffHash: string;
}

export function freezeHoldoutHandoff(state: TournamentState, evaluationHash: string, authorizationHash: string): HoldoutHandoff {
  if(!/^[a-f0-9]{64}$/.test(authorizationHash))throw new Error("Approved authorization hash required");
  if (!state.comparison || !["complete","plateau"].includes(state.status) || state.comparison.status!==state.status || state.comparison.provisional!==true) throw new Error("Completed development comparison required before holdout freeze");
  const allCheckpoints=[...(state.history?.checkpoints??[]),...state.checkpoints];
  if (allCheckpoints.some(c=>(!c.usage || c.state==="dispatching" || c.state==="failed_unknown")&&!c.historicalReservation)) throw new Error("Unreserved development usage blocks holdout freeze");
  allCheckpoints.forEach(c=>validateUsage((c.usage??c.historicalReservation)!));
  if(state.checkpoints.filter(c=>c.kind==="extraction").length<12 || state.checkpoints.length>36 || Object.keys(promptVariants).some(id=>!state.comparison!.candidates.some(c=>c.id===id)))throw new Error("Initial development tournament incomplete");
  const totals=budgetUsage(allCheckpoints);
  if (totals.dispatches!==state.comparison.actualDispatches || totals.totalTokens!==state.comparison.chargedTokensIncludingReservation || totals.totalTokens-state.comparison.reservedUnknownTokens!==state.comparison.actualTokens) throw new Error("Development ledger/comparison discrepancy");
  const prompts:Record<string,string>={...promptVariants};
  for(const revision of state.revisions){
    const parent=prompts[revision.parentId];
    const expected=parent&&`${parent}\n${revisionDirectives[revision.pattern]}`;
    if(!expected || expected!==revision.prompt || sha256(expected)!==revision.promptHash)throw new Error("Revision prompt integrity failure");
    prompts[revision.id]=expected;
  }
  const candidates=state.comparison.candidates.filter(c=>c.complete && c.quality!==null);
  if(candidates.length<HOLDOUT_FINALISTS)throw new Error("Two complete finalist candidates required");
  const ranked=[...candidates].sort((a,b)=>b.quality!-a.quality! || a.actualTokens-b.actualTokens || a.id.localeCompare(b.id));
  const selected=selectBest(candidates);
  if(!selected || selected.id!==state.comparison.selectedId)throw new Error("Development selection discrepancy");
  const second=ranked.find(c=>c.id!==selected.id) as CandidateResult|undefined;
  if(!second)throw new Error("Second finalist unavailable");
  const finalistPrompts=[selected,second].map(c=>{
    const prompt=prompts[c.id];
    if(!prompt || sha256(prompt)!==c.promptHash)throw new Error("Finalist prompt integrity failure");
    return {id:c.id,prompt,promptHash:c.promptHash};
  });
  const developmentLedger=[...(state.history?.checkpoints??[]).map(c=>({...c,key:`history:${state.history!.planHash}:${c.key}`})),...state.checkpoints]
    .map(({key,kind,identityHash,state:status,usage,historicalReservation,outputAllowance})=>({key,kind,identityHash,state:status,usage,historicalReservation,outputAllowance}));
  const base={version:HOLDOUT_VERSION as typeof HOLDOUT_VERSION,developmentPlanHash:state.planHash,authorizationHash,finalistPrompts,developmentLedger,
    developmentLedgerHash:sha256(JSON.stringify(developmentLedger)),developmentDispatches:totals.dispatches,developmentTokens:totals.totalTokens,frozenEvaluationHash:evaluationHash};
  return {...base,handoffHash:sha256(JSON.stringify(base))};
}

export function validateHoldoutHandoff(value: HoldoutHandoff, planHash: string, evaluationHash: string) {
  const {handoffHash,...base}=value;
  if(base.version!==HOLDOUT_VERSION || base.developmentPlanHash!==planHash || base.frozenEvaluationHash!==evaluationHash || handoffHash!==sha256(JSON.stringify(base)))throw new Error("Holdout freeze identity mismatch");
  if(base.finalistPrompts.length!==HOLDOUT_FINALISTS || new Set(base.finalistPrompts.map(f=>f.id)).size!==HOLDOUT_FINALISTS || base.finalistPrompts.some(f=>sha256(f.prompt)!==f.promptHash))throw new Error("Frozen finalist integrity failure");
  if(base.developmentLedgerHash!==sha256(JSON.stringify(base.developmentLedger)) || new Set(base.developmentLedger.map(c=>c.key)).size!==base.developmentLedger.length)throw new Error("Development ledger integrity failure");
  if(base.developmentLedger.some(c=>(!c.usage || c.state==="dispatching" || c.state==="failed_unknown")&&!c.historicalReservation))throw new Error("Unreserved development usage blocks holdout");
  base.developmentLedger.forEach(c=>validateUsage((c.usage??c.historicalReservation)!));
  const usage=budgetUsage(base.developmentLedger as Checkpoint[]);
  if(usage.dispatches!==base.developmentDispatches || usage.totalTokens!==base.developmentTokens || usage.dispatches+HOLDOUT_PLANNED_EXTRACTIONS+HOLDOUT_PLANNED_JUDGES>MAX_DISPATCHES || usage.totalTokens>=MAX_ACTUAL_TOKENS)throw new Error("Shared hard budget cannot cover holdout plan");
  return value;
}

export interface HoldoutState { handoffHash:string; inputHash:string; checkpoints:Checkpoint[]; status:"running"|"complete"|"budget_stop" }
export interface HoldoutResult { status:HoldoutState["status"]; developmentDispatches:number; holdoutDispatches:number; combinedDispatches:number; combinedTokens:number; finalists:Array<{id:string; quality:number|null; score:ReturnType<typeof scoreAdjudicated>|null; failure:string|null}>; provisional:true }
export async function runIsolatedHoldout(deps:{handoff:HoldoutHandoff;planHash:string;evaluationHash:string;sample:SampleInput;gold:DevGold;caps:ApprovalCaps;load():HoldoutState|null;save(state:HoldoutState):void;dispatch(operation:Operation,outputAllowance:number):Promise<DispatchResult>}):Promise<HoldoutResult>{
  const handoff=validateHoldoutHandoff(deps.handoff,deps.planHash,deps.evaluationHash);
  if(deps.gold.claims.some(c=>c.sample!==deps.sample.code) || deps.gold.entities.some(c=>c.sample!==deps.sample.code) || deps.gold.negativeChecks.some(c=>c.sample!==deps.sample.code))throw new Error("Holdout gold/sample mismatch");
  const inputHash=sha256(JSON.stringify({sample:deps.sample,gold:deps.gold}));
  const state=deps.load()??{handoffHash:handoff.handoffHash,inputHash,checkpoints:[],status:"running" as const};
  if(state.handoffHash!==handoff.handoffHash || state.inputHash!==inputHash || state.checkpoints.length>4 || new Set(state.checkpoints.map(c=>c.key)).size!==state.checkpoints.length)throw new Error("Holdout checkpoint integrity failure");
  for(const c of state.checkpoints){if(!c.usage || c.state==="dispatching" || c.state==="failed_unknown")throw new Error("Unknown holdout usage blocks continuation");validateUsage(c.usage);}
  async function step(op:Operation,kind:Operation["kind"],extraction?:NarrativeOutput):Promise<unknown|null>{
    const prior=state.checkpoints.find(c=>c.key===op.key);
    if(prior){if(prior.identityHash!==op.identityHash || prior.kind!==kind)throw new Error("Holdout checkpoint identity mismatch");
      if(prior.state==="failed_known")return null;
      if(prior.state!=="completed" || !prior.output)throw new Error("Invalid holdout checkpoint");
      if(kind==="extraction"){const parsed=narrativeOutputSchema.parse(prior.output);if(validateGrounding(parsed,deps.sample.pages).length)throw new Error("Stored holdout extraction grounding failure");return parsed;}
      return validateAdjudication(prior.output,deps.gold,deps.sample.code,extraction!,deps.sample.pages);
    }
    const reservation=reserveNext([...handoff.developmentLedger as Checkpoint[],...state.checkpoints],deps.caps,JSON.stringify({prompt:op.prompt,payload:op.payload,schema:op.schemaJson}));
    if(!reservation){state.status="budget_stop";deps.save(state);return null;}
    const checkpoint:Checkpoint={key:op.key,kind,identityHash:op.identityHash,state:"dispatching",outputAllowance:reservation.outputAllowance};state.checkpoints.push(checkpoint);deps.save(state);
    let result:DispatchResult;
    try{result=await deps.dispatch(op,reservation.outputAllowance);}catch(error){checkpoint.state="failed_unknown";checkpoint.error=error instanceof Error?error.message:String(error);deps.save(state);throw new Error("Ambiguous holdout dispatch; stop");}
    try{validateUsage(result.usage);}catch(error){checkpoint.state="failed_unknown";checkpoint.error=error instanceof Error?error.message:String(error);deps.save(state);throw error;}
    checkpoint.usage=result.usage;checkpoint.responseId=result.responseId;deps.save(state);
    const all=budgetUsage([...handoff.developmentLedger as Checkpoint[],...state.checkpoints]);
    const dollars=(all.inputTokens*deps.caps.inputUsdPerMillion+all.outputTokens*deps.caps.outputUsdPerMillion)/1_000_000;
    if(result.usage.inputTokens>reservation.inputReserve || result.usage.outputTokens>reservation.outputAllowance || result.usage.totalTokens>reservation.reservedTokens || all.totalTokens>MAX_ACTUAL_TOKENS || dollars>deps.caps.maxUsd){checkpoint.state="failed_unknown";checkpoint.error="Shared budget discrepancy";deps.save(state);throw new Error("Shared budget discrepancy; stop");}
    if(result.status==="failed_known" || !result.output){checkpoint.state="failed_known";checkpoint.error=result.error??"Known-use failure";deps.save(state);return null;}
    const parsed=kind==="extraction"?narrativeOutputSchema.safeParse(result.output):adjudicationSchema.safeParse(result.output);
    if(!parsed.success){checkpoint.state="failed_known";checkpoint.error="Structured output failed schema validation";deps.save(state);return null;}
    checkpoint.receivedOutput=parsed.data;checkpoint.validationSourcePages=deps.sample.pages;checkpoint.validationIssues=[];deps.save(state);
    if(kind==="extraction"){
      checkpoint.candidateResponse={output:parsed.data as NarrativeOutput,sourcePages:deps.sample.pages,issues:[],rejectedItemCount:0};deps.save(state);
      const partition=partitionGrounding(parsed.data as NarrativeOutput,deps.sample.pages);
      checkpoint.candidateResponse.issues=partition.issues;checkpoint.candidateResponse.rejectedItemCount=partition.rejectedItemCount;checkpoint.validationIssues=partition.issues.map(i=>`${i.kind}[${i.index}] ${i.outputId}: ${i.reason}`);deps.save(state);
      if(!partition.usable){checkpoint.state="failed_known";checkpoint.error=`Entire holdout candidate unusable: ${partition.rejectedItemCount} rejected items; ${partition.issues.map(i=>`${i.kind}[${i.index}] ${i.reason}`).join("; ")||"no narrative items returned"}`;deps.save(state);return null;}
      checkpoint.output=partition.accepted;checkpoint.state="completed";deps.save(state);return partition.accepted;
    }else{
      try{validateAdjudication(parsed.data,deps.gold,deps.sample.code,extraction!,deps.sample.pages);}catch(error){checkpoint.state="failed_unknown";checkpoint.error=error instanceof Error?error.message:String(error);checkpoint.validationIssues=[checkpoint.error];deps.save(state);throw new Error("Holdout judge integrity failure; stop");}
    }
    checkpoint.output=parsed.data;checkpoint.state="completed";deps.save(state);return parsed.data;
  }
  const results:HoldoutResult["finalists"]=[];
  // This one-shot phase has no revision path and does not export source or row-level feedback to the optimizer.
  for(const finalist of handoff.finalistPrompts){
    const extractionSchemaJson=JSON.stringify(z.toJSONSchema(narrativeOutputSchema));
    const extract:Operation={key:`holdout:extract:${finalist.id}`,kind:"extraction",candidateId:finalist.id,sample:deps.sample.code,prompt:finalist.prompt,payload:deps.sample.sourcePayload,schemaJson:extractionSchemaJson,schemaHash:sha256(extractionSchemaJson),identityHash:operationIdentity("extraction",finalist.id,deps.sample.code,finalist.prompt,deps.sample.sourcePayload,sha256(extractionSchemaJson),handoff.handoffHash)};
    const output=await step(extract,"extraction") as NarrativeOutput|null;
    if(!output){results.push({id:finalist.id,quality:null,score:null,failure:"extraction failed or budget stopped"});continue;}
    const judgeSchemaJson=JSON.stringify(z.toJSONSchema(adjudicationSchema));
    const payload=JSON.stringify(blindedJudgeInput(deps.gold,deps.sample.code,output,deps.sample.pages));
    const judge:Operation={key:`holdout:judge:${finalist.id}`,kind:"judge",candidateId:finalist.id,sample:deps.sample.code,prompt:ADJUDICATION_PROMPT,payload,schemaJson:judgeSchemaJson,schemaHash:sha256(judgeSchemaJson),identityHash:operationIdentity("judge",finalist.id,deps.sample.code,ADJUDICATION_PROMPT,payload,sha256(judgeSchemaJson),sha256(JSON.stringify(output)))};
    const verdict=await step(judge,"judge",output);
    const extractionCheckpoint=state.checkpoints.find(c=>c.key===extract.key);
    const score=verdict?scoreAdjudicated(deps.gold,deps.sample.code,output,deps.sample.pages,verdict as z.infer<typeof adjudicationSchema>,extractionCheckpoint?.candidateResponse?.rejectedItemCount??0):null;
    results.push({id:finalist.id,quality:score?.quality??null,score,failure:score?null:"judge failed or budget stopped"});
  }
  if(state.status==="running")state.status="complete";deps.save(state);
  const combined=budgetUsage([...handoff.developmentLedger as Checkpoint[],...state.checkpoints]);
  return {status:state.status,developmentDispatches:handoff.developmentDispatches,holdoutDispatches:state.checkpoints.length,combinedDispatches:combined.dispatches,combinedTokens:combined.totalTokens,finalists:results,provisional:true};
}
