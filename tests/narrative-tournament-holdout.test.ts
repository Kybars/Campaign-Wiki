import { describe, expect, it } from "vitest";
import { freezeHoldoutHandoff, runIsolatedHoldout, validateHoldoutHandoff, type HoldoutState } from "../lib/ai/narrative-tournament-holdout";
import { promptVariants, sha256, type NarrativeOutput } from "../lib/ai/narrative-tournament";
import type { DevGold } from "../lib/ai/narrative-tournament-evaluation";
import type { Checkpoint, DispatchResult, Operation, TournamentState } from "../lib/ai/narrative-tournament-runner";

const pages=[{physicalPdfPage:1,text:"Mira met Joran."}];
const gold:DevGold={claims:[{id:"G",sample:"H",importance:3,subjects:["Mira"],modality:"established",physicalPdfPage:1,expectedProposition:"Mira met Joran.",sourceAnchor:"Mira met Joran"}],entities:[],negativeChecks:[]};
const output:NarrativeOutput={propositions:[{id:"p1",statement:"Mira met Joran.",modality:"established",subjects:["Mira"],evidence:[{page:1,quote:"Mira met Joran."}]}],entities:[{name:"Mira",type:"npc",presentation:"page",parentOrAttachment:"",existencePage:1,existenceQuote:"Mira"}],relationships:[],sourceDiscrepancies:[]};
function development():TournamentState{
  const checkpoints:Checkpoint[]=Object.keys(promptVariants).flatMap(id=>["A","B","C"].map(sample=>({key:`extract:${id}:${sample}`,kind:"extraction" as const,identityHash:sha256(`${id}:${sample}`),state:"completed" as const,usage:{inputTokens:100,outputTokens:100,totalTokens:200},outputAllowance:128000,output})));
  const candidates=Object.keys(promptVariants).map((id,index)=>({id,promptHash:sha256(promptVariants[id as keyof typeof promptVariants]),scores:[],quality:0.8-index*0.1,actualTokens:600,estimatedCostUsd:0.001,complete:true,failures:[],patternTotals:{}}));
  return {planHash:"synthetic-plan",checkpoints,revisions:[],status:"complete",comparison:{status:"complete",selectedId:"baseline",candidates,actualDispatches:12,actualTokens:2400,chargedTokensIncludingReservation:2400,reservedUnknownTokens:0,estimatedCostUsd:0.001,provisional:true,recommendedAuditSample:[],caveat:"provisional"}};
}
const caps={maxUsd:10,inputUsdPerMillion:0.5,outputUsdPerMillion:1.8,modelMaxOutputTokens:128000};
function mock(op:Operation):DispatchResult{
  const usage={inputTokens:100,outputTokens:100,totalTokens:200};
  if(op.kind==="extraction")return {status:"completed",usage,output};
  return {status:"completed",usage,output:{propositions:[{goldId:"G",outputIds:["p1"],verdict:"correct",modalityCorrect:true,evidence:{page:1,quote:"Mira met Joran."},uncertainty:"low",failurePattern:"none",reason:"Exact supported event."}],entities:[],negativeChecks:[],unsupportedOutputs:[],unsupportedEntities:[]}};
}
describe("isolated holdout handoff",()=>{
  it("freezes two development finalists and charges four one-shot calls to shared usage",async()=>{
    const handoff=freezeHoldoutHandoff(development(),"evalhash",sha256("approved-file"));
    expect(handoff.finalistPrompts.map(f=>f.id)).toEqual(["baseline","narrative_first"]);
    let stored:HoldoutState|null=null;const keys:string[]=[];
    const run=()=>runIsolatedHoldout({handoff,planHash:"synthetic-plan",evaluationHash:"evalhash",sample:{code:"H",pages,sourcePayload:"SOURCE PAGES\nMira met Joran."},gold,caps,load:()=>stored,save:s=>{stored=structuredClone(s);},dispatch:async op=>{keys.push(op.key);return mock(op);}});
    const result=await run();
    expect(result.holdoutDispatches).toBe(4);expect(result.combinedDispatches).toBe(16);expect(result.combinedTokens).toBe(3200);
    expect(result.finalists.map(f=>f.quality)).toEqual([1,1]);
    expect((await run()).holdoutDispatches).toBe(4);expect(keys).toHaveLength(4);
  });
  it("rejects tampered or unresolved development usage",()=>{
    const handoff=freezeHoldoutHandoff(development(),"evalhash",sha256("approved-file"));
    expect(()=>validateHoldoutHandoff({...handoff,developmentTokens:1},"synthetic-plan","evalhash")).toThrow(/freeze identity/);
    const state=development();state.checkpoints[0].state="dispatching";
    expect(()=>freezeHoldoutHandoff(state,"evalhash",sha256("approved-file"))).toThrow(/Unreserved/);
  });
  it("carries prior-plan usage into the holdout handoff and refuses unresolved prior usage",()=>{
    const state=development();
    const historical:Checkpoint={key:"extract:baseline:A",kind:"extraction",identityHash:"old",state:"failed_known",usage:{inputTokens:100,outputTokens:100,totalTokens:200},outputAllowance:128000};
    state.history={planHash:"old-plan",ledgerHash:"old-ledger",checkpoints:[historical]};
    state.comparison!.actualDispatches=13;state.comparison!.actualTokens=2600;state.comparison!.chargedTokensIncludingReservation=2600;
    const handoff=freezeHoldoutHandoff(state,"evalhash",sha256("approved-file"));
    expect(handoff.developmentDispatches).toBe(13);
    expect(handoff.developmentTokens).toBe(2600);
    expect(handoff.developmentLedger[0].key).toBe("history:old-plan:extract:baseline:A");
    expect(validateHoldoutHandoff(handoff,"synthetic-plan","evalhash")).toBe(handoff);
    state.history.checkpoints[0]={...historical,state:"dispatching",usage:undefined};
    expect(()=>freezeHoldoutHandoff(state,"evalhash",sha256("approved-file"))).toThrow(/Unreserved development usage/);
  });
  it("stops on an ambiguous holdout dispatch with no automatic retry",async()=>{
    const handoff=freezeHoldoutHandoff(development(),"evalhash",sha256("approved-file"));
    let stored:HoldoutState|null=null;let calls=0;
    const run=()=>runIsolatedHoldout({handoff,planHash:"synthetic-plan",evaluationHash:"evalhash",sample:{code:"H",pages,sourcePayload:"SOURCE PAGES\nMira met Joran."},gold,caps,load:()=>stored,save:s=>{stored=structuredClone(s);},dispatch:async()=>{calls++;throw new Error("network reset");}});
    await expect(run()).rejects.toThrow(/Ambiguous holdout dispatch/);
    await expect(run()).rejects.toThrow(/Unknown holdout usage/);
    expect(calls).toBe(1);
  });
  it("charges a known-use failed finalist and evaluates the independent finalist",async()=>{
    const handoff=freezeHoldoutHandoff(development(),"evalhash",sha256("approved-file"));
    let stored:HoldoutState|null=null;const keys:string[]=[];
    const result=await runIsolatedHoldout({handoff,planHash:"synthetic-plan",evaluationHash:"evalhash",sample:{code:"H",pages,sourcePayload:"SOURCE PAGES\nMira met Joran."},gold,caps,load:()=>stored,save:s=>{stored=structuredClone(s);},dispatch:async op=>{
      keys.push(op.key);
      if(op.key==="holdout:extract:baseline")return {status:"failed_known",usage:{inputTokens:100,outputTokens:10,totalTokens:110},error:"truncated"};
      return mock(op);
    }});
    expect(result.holdoutDispatches).toBe(3);
    expect(result.finalists[0].quality).toBeNull();
    expect(result.finalists[1].quality).toBe(1);
    expect(keys).toContain("holdout:judge:narrative_first");
  });
});
