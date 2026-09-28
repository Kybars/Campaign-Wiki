import { describe, expect, it } from "vitest";
import { reserveNext, runTournament, type DispatchResult, type HistoricalLedger, type Operation, type RunnerDeps, type TournamentState } from "../lib/ai/narrative-tournament-runner";
import type { DevGold } from "../lib/ai/narrative-tournament-evaluation";
import type { NarrativeOutput } from "../lib/ai/narrative-tournament";

const codes=["S1","S2","S3"];
const pages=[{physicalPdfPage:1,text:"Mira met Joran."}];
const gold:DevGold={claims:codes.map(sample=>({id:`${sample}-G`,sample,importance:3,subjects:["Mira","Joran"],modality:"established",physicalPdfPage:1,expectedProposition:"Mira met Joran.",sourceAnchor:"met Joran"})),
  entities:codes.map(sample=>({id:`${sample}-E`,sample,name:"Mira",type:"npc",expectedPresentation:"page",parentOrAttachment:"",physicalPdfPage:1})),
  negativeChecks:codes.map(sample=>({id:`${sample}-X`,sample,physicalPdfPage:1,mustNot:"Do not claim Mira met a dragon."}))};
const output:NarrativeOutput={propositions:[{id:"p1",statement:"Mira met Joran.",modality:"established",subjects:["Mira","Joran"],evidence:[{page:1,quote:"Mira met Joran."}]}],
  entities:[{name:"Mira",type:"npc",presentation:"page",parentOrAttachment:"",existencePage:1,existenceQuote:"Mira"},{name:"Joran",type:"npc",presentation:"attached",parentOrAttachment:"Mira",existencePage:1,existenceQuote:"Joran"}],relationships:[],sourceDiscrepancies:[]};
function fakeResult(op:Operation):DispatchResult{
  const usage={inputTokens:100,outputTokens:100,totalTokens:200};
  if(op.kind==="extraction")return {status:"completed",usage,output};
  const verdict=op.candidateId==="revision_1"||op.candidateId==="revision_2"?"correct":op.candidateId==="narrative_first"||op.candidateId==="relevance_gated"?"partial":"missing";
  const pattern=op.candidateId==="revision_1"?"unsupported":op.candidateId==="revision_2"?"none":op.candidateId==="narrative_first"?"modality":"omission";
  const negative=op.candidateId==="relevance_gated"?"uncertain":"pass";
  return {status:"completed",usage,output:{propositions:[{goldId:`${op.sample}-G`,outputIds:verdict==="missing"?[]:["p1"],verdict,modalityCorrect:true,
    evidence:verdict==="missing"?{page:null,quote:""}:{page:1,quote:"Mira met Joran."},uncertainty:"low",failurePattern:pattern,reason:"Synthetic test decision."}],
    entities:[],negativeChecks:[{goldId:`${op.sample}-X`,verdict:negative,outputIds:[],evidence:{page:null,quote:""},reason:"Synthetic test check."}],unsupportedOutputs:[],unsupportedEntities:[]}};
}
function harness(dispatch:(op:Operation)=>Promise<DispatchResult>,history:HistoricalLedger|null=null){
  let stored:TournamentState|null=null;const keys:string[]=[];const snapshots:TournamentState[]=[];
  const deps:RunnerDeps={planHash:"synthetic-plan",samples:codes.map(code=>({code,pages,sourcePayload:"SOURCE PAGES\nMira met Joran."})),gold,history,
    caps:{maxUsd:100,inputUsdPerMillion:1,outputUsdPerMillion:1,modelMaxOutputTokens:100000},load:()=>stored,save:(s)=>{stored=structuredClone(s);snapshots.push(structuredClone(s));},dispatch:async(op)=>{keys.push(op.key);return dispatch(op);}};
  return {keys,snapshots,load:()=>stored,run:()=>runTournament(deps),accept:()=>runTournament(deps,"acceptance")};
}

describe("adaptive tournament ledger",()=>{
  it("runs only the six acceptance operations and reuses them during the full first round",async()=>{
    const h=harness(async op=>fakeResult(op));
    const accepted=await h.accept();
    expect(accepted.newDispatches).toBe(6);
    expect(accepted.allSourcesGroundedAndScored).toBe(true);
    expect(h.keys).toEqual(["extract:narrative_first:S1","extract:narrative_first:S2","extract:narrative_first:S3","judge:narrative_first:S1","judge:narrative_first:S2","judge:narrative_first:S3"]);
    const resumed=await h.run();
    expect(resumed.actualDispatches).toBe(36);
    expect(h.keys.filter(k=>k.includes(":narrative_first:"))).toHaveLength(6);
  });
  it("reports accepted peers, rejected items, exact grounding categories and per-source usage",async()=>{
    const mixed:NarrativeOutput={...output,propositions:[...output.propositions,{id:"unsupported",statement:"Mira found a dragon.",modality:"established",subjects:["Mira"],evidence:[{page:1,quote:"Mira found a dragon."}]}]};
    const h=harness(async op=>op.kind==="extraction"&&op.sample==="S1"?{status:"completed",usage:{inputTokens:100,outputTokens:100,totalTokens:200},output:mixed}:fakeResult(op));
    const result=await h.accept();
    const first=result.sources.find(s=>s.sample==="S1")!;
    expect(first.accepted.propositions).toEqual(["p1"]);
    expect(first.rejected).toEqual([{kind:"proposition",outputId:"unsupported",categories:["quote absent from raw PDF.js page"],reasons:["quote absent from raw PDF.js page"]}]);
    expect(first.groundingErrorCategories).toEqual({"quote absent from raw PDF.js page":1});
    expect(first.provisionalQuality).not.toBeNull();
    expect(first).toMatchObject({inputTokens:200,outputTokens:200,totalTokens:400});
    expect(result.allSourcesGroundedAndScored).toBe(true);
  });
  it("plans all first-round comparisons, then two source-wide revisions and plateaus",async()=>{
    const h=harness(async op=>fakeResult(op));const result=await h.run();
    expect(result.status).toBe("plateau");expect(result.selectedId).toBe("revision_1");
    expect(result.actualDispatches).toBe(36);expect(result.candidates).toHaveLength(6);
    expect(h.keys.slice(0,12).every(k=>k.startsWith("extract:"))).toBe(true);
    expect(h.keys.filter(k=>k.startsWith("judge:")).length).toBe(18);
    expect((await h.run()).actualDispatches).toBe(36);
  });
  it("charges a known failed candidate and continues independent planned work",async()=>{
    const h=harness(async op=>op.key==="extract:baseline:S1"?{status:"failed_known",usage:{inputTokens:100,outputTokens:10,totalTokens:110},error:"truncated"}:fakeResult(op));
    const result=await h.run();
    expect(result.candidates.find(c=>c.id==="baseline")?.complete).toBe(false);
    expect(h.keys).toContain("extract:baseline:S2");
    expect(result.actualDispatches).toBeGreaterThan(30);
  });
  it("stops on ambiguous dispatch and refuses automatic resume",async()=>{
    const h=harness(async op=>{if(op.key==="extract:baseline:S1")throw new Error("network reset");return fakeResult(op);});
    await expect(h.run()).rejects.toThrow(/Ambiguous dispatch/);
    expect(h.keys).toHaveLength(1);
    await expect(h.run()).rejects.toThrow(/Ambiguous prior dispatch/);
  });
  it("stops on judge source-evidence integrity failure",async()=>{
    const h=harness(async op=>{const result=fakeResult(op);if(op.key==="judge:baseline:S1")return {...result,output:{...result.output as object,propositions:[{goldId:"S1-G",outputIds:["p1"],verdict:"correct",modalityCorrect:true,evidence:{page:1,quote:"no source match"},uncertainty:"low",failurePattern:"none",reason:"Bad quote."}]}};return result;});
    await expect(h.run()).rejects.toThrow(/Judge integrity failure/);
    const failed=h.load()?.checkpoints.find(c=>c.key==="judge:baseline:S1");
    expect(failed?.receivedOutput).toBeDefined();
    expect(failed?.validationSourcePages).toEqual(pages);
    expect(failed?.validationIssues).toEqual([expect.stringMatching(/quote not found/)]);
  });
  it("continues after a known-use failed judge without selecting its incomplete candidate",async()=>{
    const h=harness(async op=>op.key==="judge:baseline:S1"?{status:"failed_known",usage:{inputTokens:100,outputTokens:10,totalTokens:110},error:"incomplete judge"}:fakeResult(op));
    const result=await h.run();
    expect(result.candidates.find(c=>c.id==="baseline")?.complete).toBe(false);
    expect(h.keys).toContain("judge:baseline:S2");
  });
  it("stops when actual usage escapes the pre-dispatch reservation",async()=>{
    const h=harness(async op=>op.key==="extract:baseline:S1"?{status:"failed_known",usage:{inputTokens:500000,outputTokens:10,totalTokens:500010},error:"unexpected usage"}:fakeResult(op));
    await expect(h.run()).rejects.toThrow(/Budget discrepancy/);
    expect(h.keys).toHaveLength(1);
  });
  it("derives output allowance from remaining shared caps, above 20k when available",()=>{
    const reserve=reserveNext([],{maxUsd:100,inputUsdPerMillion:1,outputUsdPerMillion:1,modelMaxOutputTokens:100000},"small request");
    expect(reserve?.outputAllowance).toBe(100000);
    expect(reserveNext([],{maxUsd:0.0001,inputUsdPerMillion:1,outputUsdPerMillion:1,modelMaxOutputTokens:100000},"small request")).toBeNull();
  });
  it("saves a schema-valid response before grounding, retains exact issues, and scores grounded peers",async()=>{
    const mixed: NarrativeOutput={...output,propositions:[...output.propositions,{id:"bad",statement:"Unsupported meeting.",modality:"established",subjects:["Mira"],evidence:[{page:1,quote:"Mira fought a dragon."}]}]};
    const h=harness(async op=>op.kind==="extraction"?{status:"completed",usage:{inputTokens:100,outputTokens:100,totalTokens:200},responseId:`response-${op.key}`,output:mixed}:fakeResult(op));
    const result=await h.run();
    const before=h.snapshots.find(s=>s.checkpoints.find(c=>c.key==="extract:baseline:S1")?.candidateResponse?.output.propositions.length===2 && s.checkpoints.find(c=>c.key==="extract:baseline:S1")?.candidateResponse?.issues.length===0);
    expect(before).toBeDefined();
    const checkpoint=h.load()?.checkpoints.find(c=>c.key==="extract:baseline:S1");
    expect(checkpoint?.responseId).toBe("response-extract:baseline:S1");
    expect(checkpoint?.candidateResponse?.sourcePages).toEqual(pages);
    expect(checkpoint?.candidateResponse?.issues).toEqual([expect.objectContaining({outputId:"bad",page:1,quote:"Mira fought a dragon.",reason:"quote absent from raw PDF.js page"})]);
    expect((checkpoint?.output as NarrativeOutput).propositions.map(p=>p.id)).toEqual(["p1"]);
    expect(result.candidates[0].scores[0].unsupportedCount).toBe(1);
  });
  it("records why a wholly ungrounded candidate is unusable",async()=>{
    const bad: NarrativeOutput={propositions:[{id:"bad",statement:"Invented.",modality:"established",subjects:["Missing"],evidence:[{page:1,quote:"Invented event"}]}],entities:[],relationships:[],sourceDiscrepancies:[]};
    const h=harness(async op=>op.key==="extract:baseline:S1"?{status:"completed",usage:{inputTokens:100,outputTokens:100,totalTokens:200},responseId:"r-bad",output:bad}:fakeResult(op));
    await h.run();
    const checkpoint=h.load()?.checkpoints.find(c=>c.key==="extract:baseline:S1");
    expect(checkpoint?.state).toBe("failed_known");
    expect(checkpoint?.error).toMatch(/Entire candidate unusable.*quote absent.*unknown or rejected subject/);
    expect(checkpoint?.candidateResponse?.output.propositions[0].id).toBe("bad");
    expect(checkpoint?.usage?.totalTokens).toBe(200);
  });
  it("carries historical calls into shared limits and blocks an unresolved historical dispatch",async()=>{
    const prior={key:"old:1",kind:"extraction" as const,identityHash:"old",state:"failed_known" as const,usage:{inputTokens:100,outputTokens:100,totalTokens:200},outputAllowance:1000};
    const history:HistoricalLedger={planHash:"old-plan",ledgerHash:"saved-ledger",checkpoints:[prior]};
    const h=harness(async op=>fakeResult(op),history);
    const result=await h.run();
    expect(result.actualDispatches).toBe(37);
    expect(result.actualTokens).toBe(7400);
    const unresolved=harness(async op=>fakeResult(op),{...history,checkpoints:[{...prior,key:"old:2",state:"dispatching",usage:undefined}]});
    await expect(unresolved.run()).rejects.toThrow(/Ambiguous prior dispatch/);
    expect(unresolved.keys).toEqual([]);
  });
  it("charges the pinned tenth unknown request at its full model bounds without calling it actual usage",async()=>{
    const reserved={key:"extract:relevance_gated:SW",kind:"extraction" as const,identityHash:"6ea4c1eb9aec189821c42f4322232d283ffc6b3b485e53935c78895bccf6f8f5",state:"dispatching" as const,outputAllowance:128000,historicalReservation:{inputTokens:1050000,outputTokens:128000,totalTokens:1178000}};
    const history:HistoricalLedger={planHash:"old-plan",ledgerHash:"saved-ledger",checkpoints:[reserved]};
    const h=harness(async op=>fakeResult(op),history);
    const result=await h.accept();
    expect(result.historicalDispatches).toBe(1);
    expect(result.chargedTokensIncludingReservation).toBe(1179200);
    expect(h.load()?.history?.checkpoints[0].usage).toBeUndefined();
    expect(()=>reserveNext([{...reserved,historicalReservation:{...reserved.historicalReservation,inputTokens:1}}],{maxUsd:10,inputUsdPerMillion:0.275,outputUsdPerMillion:0.825,modelMaxOutputTokens:128000},"test")).toThrow(/Invalid historical reservation/);
  });
});
