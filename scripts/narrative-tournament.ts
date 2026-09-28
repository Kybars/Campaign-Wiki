import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { cleanDocumentPagesForModel, pageTextForModel } from "../lib/pdf/model-text";
import { ADJUDICATION_PROMPT, adjudicationSchema, type DevGold } from "../lib/ai/narrative-tournament-evaluation";
import { MAX_ACTUAL_TOKENS, MAX_DISPATCHES, MODEL_ID, narrativeOutputSchema, normalized, promptVariants, sha256 } from "../lib/ai/narrative-tournament";
import { budgetUsage, HISTORICAL_UNRESOLVED_INPUT_RESERVE, HISTORICAL_UNRESOLVED_OUTPUT_RESERVE, MAX_PLANNED_EXTRACTIONS, MAX_PLANNED_JUDGES, MAX_REVISIONS, MIN_IMPROVEMENT, RUNNER_VERSION, revisionDirectives, runTournament, type ApprovalCaps, type DispatchResult, type Operation, type SampleInput, type TournamentState } from "../lib/ai/narrative-tournament-runner";
import { HOLDOUT_FINALISTS, HOLDOUT_PLANNED_EXTRACTIONS, HOLDOUT_PLANNED_JUDGES, HOLDOUT_VERSION, freezeHoldoutHandoff } from "../lib/ai/narrative-tournament-holdout";
import { buildTournamentRequest, parseTournamentAuthorization, tournamentTextFormat, TOURNAMENT_REASONING_EFFORT, TOURNAMENT_SERVICE_TIER } from "../lib/ai/narrative-tournament-request";

const root=join(process.cwd(),"fixtures","private","narrative-dev");
const outputDir=join(root,"tournament");
const historicalPath=join(outputDir,"history","paid-progress-a34d058a.json");
const historicalPlanPath=join(outputDir,"history","plan-a34d058a.json");
const progressPath=join(outputDir,`paid-progress-${RUNNER_VERSION}.json`);
function historicalLedger(){
  const bytes=readFileSync(historicalPath);
  const saved=JSON.parse(bytes.toString("utf8")) as TournamentState;
  if(sha256(bytes)!=="83154faf8e1d81c1817c4cb318a2865bef2e3cf8b7bddeaeb5a7d32f25dced20"||saved.planHash!=="a34d058ad7957501b3440db1824f74077fcedbe7434bf16c36d1dde1595d5d56"||saved.checkpoints.length!==10)throw new Error("Historical paid ledger identity mismatch");
  const oldPlan=readJson(historicalPlanPath) as {planHash:string;version:string;model:string;reasoningEffort:string;serviceTier:string;sampleInputHashes:Array<{sample:string;sourcePayloadHash:string}>;baselinePromptHashes:Record<string,string>;extractionSchemaHash:string};
  const tenth=saved.checkpoints[9];
  if(oldPlan.planHash!==saved.planHash||oldPlan.version!=="narrative-adaptive-3"||oldPlan.model!==MODEL_ID||oldPlan.reasoningEffort!==TOURNAMENT_REASONING_EFFORT||oldPlan.serviceTier!==TOURNAMENT_SERVICE_TIER||tenth?.key!=="extract:relevance_gated:SW"||tenth.state!=="dispatching"||tenth.usage||tenth.outputAllowance!==HISTORICAL_UNRESOLVED_OUTPUT_RESERVE)throw new Error("Historical unresolved request identity mismatch");
  return {planHash:saved.planHash,ledgerHash:sha256(bytes),checkpoints:saved.checkpoints.map((c,i)=>i===9?{...c,historicalReservation:{inputTokens:HISTORICAL_UNRESOLVED_INPUT_RESERVE,outputTokens:HISTORICAL_UNRESOLVED_OUTPUT_RESERVE,totalTokens:HISTORICAL_UNRESOLVED_INPUT_RESERVE+HISTORICAL_UNRESOLVED_OUTPUT_RESERVE}}:c),oldPlan};
}
const filenames:Record<string,string>={SW:"The Demonplague Sweetwater Village(1).pdf",WOTBS:"WotBS - Campaign Guide (1).pdf",TALES:"Tales_of_the_Demon_Lord_no_bkgd_v6-5-16 (1).pdf"};
const sourceBytes=readFileSync(join(root,"campaign_wiki_DEV_source.json"));
const goldBytes=readFileSync(join(root,"campaign_wiki_DEV_scoring.json"));
const source=JSON.parse(sourceBytes.toString("utf8")) as { samples:Array<{code:string;section:string;sourceSha256:string;sourcePdfPages:string;selectedPages:number[];pages:Array<{physicalPdfPage:number;text:string;textSha256:string;characters:number}>}> };
const gold=JSON.parse(goldBytes.toString("utf8")) as DevGold & {samples:Array<{code:string;sourceSha256:string;selectedPages:number[]}>};
const args=process.argv.slice(2),mode=args[0]??"--preflight";
function arg(flag:string){const i=args.indexOf(flag);return i<0?null:args[i+1]??null;}
function save(path:string,value:unknown){mkdirSync(outputDir,{recursive:true});const temp=`${path}.tmp`;writeFileSync(temp,JSON.stringify(value,null,2));renameSync(temp,path);}
function readJson(path:string):unknown{return JSON.parse(readFileSync(path,"utf8"));}
function noPrivateWatermark(value:string,label:string){if(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|purchased by|licensed to|purchase watermark|order\s*#\s*\d{5,}/iu.test(value))throw new Error(`Possible private watermark in ${label}; stop before model input`);}
function tokenSet(value:string){return new Set(normalized(value).match(/[\p{L}\p{N}]+/gu)??[]);}
function overlap(reference:string,other:string){const left=tokenSet(reference),right=tokenSet(other);return left.size?Number(([...left].filter(t=>right.has(t)).length/left.size).toFixed(3)):null;}

async function pdfjsSelected(bytes:Uint8Array,selected:number[]){
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task=pdfjs.getDocument({data:Uint8Array.from(bytes),useSystemFonts:true});
  const pdf=await task.promise;
  const pages:Array<{pageNumber:number;text:string;columnSwitches:number}>=[];
  try{
    for(const number of selected){
      if(number<1||number>pdf.numPages)throw new Error("Selected page outside PDF");
      const page=await pdf.getPage(number),content=await page.getTextContent();
      let text="",prior:null|"left"|"right"=null,switches=0;
      const midpoint=(page.view[0]+page.view[2])/2;
      for(const item of content.items){
        if(!("str" in item))continue;
        text+=item.str+(item.hasEOL?"\n":" ");
        if(!item.str.trim()||!("transform" in item))continue;
        const y=item.transform[5];if(y<page.view[1]+40||y>page.view[3]-40)continue;
        const column=item.transform[4]<midpoint?"left":"right";
        if(prior&&prior!==column)switches++;prior=column;
      }
      pages.push({pageNumber:number,text:text.replace(/\u0000/g,"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim(),columnSwitches:switches});
      page.cleanup();
    }
  }finally{await task.destroy();}
  return {pageCount:pdf.numPages,pages};
}

async function prepare(){
  const history=historicalLedger();
  if(sha256(sourceBytes)!=="941aac345d86b856f0634e1ae44d201d6359fc22a078b4aaea83c699e16ebf1a"||sha256(goldBytes)!=="426f4410e743a7b328255321ece019089fb93dbdff2933620d927f34948d5ebb")throw new Error("Frozen development source/scoring data changed");
  const fixtureBytes=readFileSync(join(outputDir,"known-good-fixture-results.json"));
  const fixture=JSON.parse(fixtureBytes.toString("utf8")) as {planSourceHashesVerified:boolean;implementationHashes:Record<string,string>;results:Array<{sample:string;sourcePayloadHash:string;rawPageHash:string;groundingIssues:number;propositionPoints:number;quality:number}>};
  const fixtureHashes={fixtureHarness:sha256(readFileSync(join(process.cwd(),"scripts","narrative-tournament-offline-fixtures.ts"))),grounding:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament.ts"))),scoring:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament-evaluation.ts"))),modelText:sha256(readFileSync(join(process.cwd(),"lib","pdf","model-text.ts"))),fixtureDefinitions:sha256(readFileSync(join(outputDir,"known-good-extractions.json")))};
  if(!fixture.planSourceHashesVerified||JSON.stringify(fixture.implementationHashes)!==JSON.stringify(fixtureHashes)||fixture.results.length!==3||fixture.results.some(r=>r.groundingIssues!==0||r.propositionPoints<=0||r.quality<=0))throw new Error("Current three-source known-good offline fixture pass required before preflight");
  if(source.samples.length!==3||gold.claims.length!==80||gold.entities.length!==78||gold.negativeChecks.length!==20)throw new Error("Development fixture topology changed");
  const samples:SampleInput[]=[],diagnostics:unknown[]=[];
  for(const sample of source.samples){
    const pdfBytes=readFileSync(join(root,filenames[sample.code]));
    if(sha256(pdfBytes)!==sample.sourceSha256)throw new Error(`PDF hash mismatch: ${sample.code}`);
    const scoring=gold.samples.find(s=>s.code===sample.code);
    if(!scoring||scoring.sourceSha256!==sample.sourceSha256||JSON.stringify(scoring.selectedPages)!==JSON.stringify(sample.selectedPages))throw new Error(`Source/scoring metadata mismatch: ${sample.code}`);
    const extracted=await pdfjsSelected(pdfBytes,sample.selectedPages);
    if(extracted.pageCount!==Number(sample.sourcePdfPages))throw new Error(`PDF page count mismatch: ${sample.code}`);
    const cleaned=cleanDocumentPagesForModel(extracted.pages.map(p=>({pageNumber:p.pageNumber,text:p.text})));
    const pages=extracted.pages.map((raw,index)=>{
      const draft=sample.pages.find(p=>p.physicalPdfPage===raw.pageNumber);
      if(!draft||sha256(draft.text)!==draft.textSha256||draft.text.length!==draft.characters)throw new Error(`Cleaned source metadata mismatch: ${sample.code} p${raw.pageNumber}`);
      const model=pageTextForModel(cleaned.pages[index]);
      noPrivateWatermark(model,`${sample.code} p${raw.pageNumber}`);
      const rows=gold.claims.filter(c=>c.sample===sample.code&&c.physicalPdfPage===raw.pageNumber);
      const spanRows=rows.map(c=>{const needle=normalized(c.sourceAnchor);return {goldId:c.id,section:(c as {part?:string}).part??"",cleanStart:normalized(draft.text).indexOf(needle),pdfjsStart:normalized(raw.text).indexOf(needle),modelStart:normalized(model).indexOf(needle)};});
      diagnostics.push({sample:sample.code,page:raw.pageNumber,section:sample.section,parts:[...new Set(spanRows.map(r=>r.section))],cleanedCharacters:draft.text.length,pdfjsCharacters:raw.text.length,modelCharacters:model.length,
        cleanedTokenRecall:overlap(draft.text,raw.text),productionLikeTokenRecall:overlap(draft.text,model),columnSwitches:raw.columnSwitches,anchorSpans:spanRows});
      return {physicalPdfPage:raw.pageNumber,text:raw.text,modelText:model};
    });
    const sourcePayload=`SOURCE PAGES\n\n${pages.map(p=>`<campaign-page number="${p.physicalPdfPage}">\n${p.modelText}\n</campaign-page>`).join("\n\n")}`;
    samples.push({code:sample.code,pages:pages.map(p=>({physicalPdfPage:p.physicalPdfPage,text:p.text})),sourcePayload});
    for(const claim of gold.claims.filter(c=>c.sample===sample.code&&c.companionIdentityEvidence)){
      const evidence=claim.companionIdentityEvidence!;
      const companion=pages.find(p=>p.physicalPdfPage===evidence.physicalPdfPage);
      if(!companion || evidence.sourceAnchors.length<2 || evidence.sourceAnchors.some(anchor=>!normalized(companion.text).includes(normalized(anchor)) || !normalized(companion.modelText).includes(normalized(anchor))))throw new Error(`Companion identity evidence absent from raw/model PDF.js text: ${claim.id}`);
    }
  }
  const oldSample=history.oldPlan.sampleInputHashes.find(s=>s.sample==="SW");
  const oldSchema=JSON.stringify(z.toJSONSchema(narrativeOutputSchema));
  const tenthPrompt=promptVariants.relevance_gated;
  const tenthPayload=samples.find(s=>s.code==="SW")?.sourcePayload;
  const tenthIdentity=sha256(JSON.stringify({version:"narrative-adaptive-3",provider:"openai",model:MODEL_ID,kind:"extraction",candidateId:"relevance_gated",sample:"SW",prompt:tenthPrompt,payload:tenthPayload,schemaHash:sha256(oldSchema),upstreamHash:history.planHash}));
  if(!tenthPayload||oldSample?.sourcePayloadHash!==sha256(tenthPayload)||history.oldPlan.baselinePromptHashes.relevance_gated!==sha256(tenthPrompt)||history.oldPlan.extractionSchemaHash!==sha256(oldSchema)||history.checkpoints[9].identityHash!==tenthIdentity)throw new Error("Historical tenth prompt, input, schema or dispatch identity mismatch");
  const tenthRequestBytes=Buffer.byteLength(JSON.stringify({prompt:tenthPrompt,payload:tenthPayload,schema:oldSchema}),"utf8");
  const historicalCharged=budgetUsage(history.checkpoints);
  const plan={version:RUNNER_VERSION,model:MODEL_ID,reasoningEffort:TOURNAMENT_REASONING_EFFORT,serviceTier:TOURNAMENT_SERVICE_TIER,
    sdkVersion:(JSON.parse(readFileSync(join(process.cwd(),"node_modules","openai","package.json"),"utf8")) as {version:string}).version,
    sourceHash:sha256(sourceBytes),scoringHash:sha256(goldBytes),
    historicalLedger:{planHash:history.planHash,ledgerHash:history.ledgerHash,dispatches:history.checkpoints.length,knownTokens:history.checkpoints.reduce((n,c)=>n+(c.usage?.totalTokens??0),0),unknownActualRequests:1,tenthVerifiedRequestBytes:tenthRequestBytes,tenthOutputAllowance:HISTORICAL_UNRESOLVED_OUTPUT_RESERVE,tenthReservedInputTokens:HISTORICAL_UNRESOLVED_INPUT_RESERVE,tenthReservedOutputTokens:HISTORICAL_UNRESOLVED_OUTPUT_RESERVE,chargedTokensIncludingReservation:historicalCharged.totalTokens,remainingSharedTokens:MAX_ACTUAL_TOKENS-historicalCharged.totalTokens,remainingSharedRequests:MAX_DISPATCHES-historicalCharged.dispatches},
    knownGoodFixtureHash:sha256(fixtureBytes),knownGoodFixtureImplementationHashes:fixtureHashes,
    behaviorHashes:{runner:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament-runner.ts"))),evaluator:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament-evaluation.ts"))),schemaAndGrounding:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament.ts"))),apiRequest:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament-request.ts"))),serialization:sha256(readFileSync(join(process.cwd(),"scripts","narrative-tournament.ts"))),holdout:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament-holdout.ts"))),holdoutCli:sha256(readFileSync(join(process.cwd(),"scripts","narrative-tournament-holdout.ts")))},
    sampleInputHashes:samples.map(s=>({sample:s.code,sourcePayloadHash:sha256(s.sourcePayload),rawPageHash:sha256(JSON.stringify(s.pages))})),
    baselinePromptHashes:Object.fromEntries(Object.entries(promptVariants).map(([k,v])=>[k,sha256(v)])),
    extractionSchemaHash:sha256(JSON.stringify(z.toJSONSchema(narrativeOutputSchema))),judgePromptHash:sha256(ADJUDICATION_PROMPT),judgeSchemaHash:sha256(JSON.stringify(z.toJSONSchema(adjudicationSchema))),
    sdkTextFormatHashes:{extraction:sha256(JSON.stringify(tournamentTextFormat("extraction"))),judge:sha256(JSON.stringify(tournamentTextFormat("judge")))},
    revisionDirectiveHash:sha256(JSON.stringify(revisionDirectives)),criteria:{maxRevisions:MAX_REVISIONS,minImprovement:MIN_IMPROVEMENT,selection:"0.8 mean quality + 0.2 minimum sample quality; near tie <0.02 prefers fewer actual tokens",provisionalWeights:"0.50 proposition, 0.15 identity, 0.15 multi-subject, 0.10 presentation, 0.10 negative checks, minus 0.05 per unsupported"},
    dispatchPlan:{acceptanceOnly:{candidateId:"narrative_first",extractionsAtMost:3,judgesAtMost:3,reusableFirstRound:true,requiresSeparateAuthorization:true},initialExtractions:12,initialJudgesAtMost:12,revisionExtractionsAtMost:6,revisionJudgesAtMost:6,developmentExtractionsAtMost:MAX_PLANNED_EXTRACTIONS,developmentJudgesAtMost:MAX_PLANNED_JUDGES,holdoutVersion:HOLDOUT_VERSION,holdoutFinalists:HOLDOUT_FINALISTS,holdoutExtractionsAtMost:HOLDOUT_PLANNED_EXTRACTIONS,holdoutJudgesAtMost:HOLDOUT_PLANNED_JUDGES,paidDispatchesAtMost:MAX_PLANNED_EXTRACTIONS+MAX_PLANNED_JUDGES+HOLDOUT_PLANNED_EXTRACTIONS+HOLDOUT_PLANNED_JUDGES,hardDispatchCeiling:MAX_DISPATCHES,hardActualTokenCeiling:MAX_ACTUAL_TOKENS}};
  const planHash=sha256(JSON.stringify(plan));
  if(fixture.results.some(r=>!samples.some(s=>s.code===r.sample&&sha256(s.sourcePayload)===r.sourcePayloadHash&&sha256(JSON.stringify(s.pages))===r.rawPageHash)))throw new Error("Known-good fixture source hashes differ from current PDF.js serialization");
  return {samples,diagnostics,plan:{...plan,planHash},history};
}

async function preflight(){
  const prepared=await prepare();
  save(join(outputDir,"plan.json"),prepared.plan);
  save(join(outputDir,"reading-order.json"),{planHash:prepared.plan.planHash,diagnostics:prepared.diagnostics,notes:["Source payload uses PDF.js selected pages and the production model-text cleaner, followed by production-style campaign-page tags.","Cleaning recurrence is computed within selected windows; production computes it across the complete uploaded document.","Gold anchors and PyMuPDF offsets are diagnostic only, never citation offsets.","The Tales page-29 visual diagram is excluded."]});
  console.log(JSON.stringify({planHash:prepared.plan.planHash,pages:prepared.diagnostics.length,acceptanceExtractionsAtMost:3,acceptanceJudgesAtMost:3,plannedDevelopmentDispatchesAtMost:36,plannedHoldoutDispatchesAtMost:4,plannedPaidDispatchesAtMost:40,historical:prepared.plan.historicalLedger,modelInputAnchorMisses:prepared.diagnostics.flatMap(d=>(d as {anchorSpans:Array<{modelStart:number}>}).anchorSpans).filter(a=>a.modelStart<0).length}));
}
async function paid(phase:"acceptance"|"full"){
  const authorizationPath=arg("--authorization-file");
  if(!authorizationPath)throw new Error("Explicit monetary-cap authorization file required; no paid dispatch");
  const prepared=await prepare();
  const savedPlan=readJson(join(outputDir,"plan.json")) as {planHash:string};
  if(savedPlan.planHash!==prepared.plan.planHash)throw new Error("Current offline preflight plan required");
  const authorized=parseTournamentAuthorization(readJson(authorizationPath),prepared.plan.planHash,phase==="acceptance"?"acceptance_only":"full_tournament");
  if(phase==="full"){
    const resultPath=join(outputDir,"acceptance-comparison.json");
    if(!existsSync(resultPath)||!existsSync(progressPath))throw new Error("Successful separately authorized three-source acceptance phase required before full tournament");
    const accepted=readJson(resultPath) as {planHash:string;phase:string;allSourcesGroundedAndScored:boolean;sources:Array<{sample:string;provisionalQuality:number|null}>};
    const progress=readJson(progressPath) as TournamentState;
    if(accepted.planHash!==prepared.plan.planHash||accepted.phase!=="acceptance_only"||!accepted.allSourcesGroundedAndScored||progress.planHash!==prepared.plan.planHash||accepted.sources.length!==3||prepared.samples.some(s=>!accepted.sources.some(row=>row.sample===s.code&&row.provisionalQuality!==null&&row.provisionalQuality>0)||!progress.checkpoints.some(c=>c.key===`extract:narrative_first:${s.code}`&&c.state==="completed"&&!!c.output)||!progress.checkpoints.some(c=>c.key===`judge:narrative_first:${s.code}`&&c.state==="completed"&&!!c.output)))throw new Error("Three-source grounded and scored acceptance gate not met");
  }
  const caps:ApprovalCaps={maxUsd:authorized.maxUsd,inputUsdPerMillion:authorized.inputUsdPerMillion,outputUsdPerMillion:authorized.outputUsdPerMillion,modelMaxOutputTokens:authorized.modelMaxOutputTokens};
  const {default:OpenAI}=await import("openai");
  const client=new OpenAI({maxRetries:0});
  const deps={planHash:prepared.plan.planHash,samples:prepared.samples,gold,caps,history:prepared.history,
    load:()=>existsSync(progressPath)?readJson(progressPath) as TournamentState:null,
    save:(state:TournamentState)=>save(progressPath,state),
    async dispatch(operation:Operation,outputAllowance:number):Promise<DispatchResult>{
      // responses.create returns usage even for completed but unparsable structured text.
      // A transport exception has ambiguous billing and is never retried automatically.
      const response=await client.responses.create(buildTournamentRequest(operation,outputAllowance));
      const u=response.usage;
      if(!u)throw new Error("Response returned without usage");
      const usage={inputTokens:u.input_tokens,outputTokens:u.output_tokens,totalTokens:u.total_tokens};
      if(response.status!=="completed"||response.incomplete_details)return {status:"failed_known",usage,responseId:response.id,error:`Response status ${response.status}`};
      try{return {status:"completed",usage,responseId:response.id,output:JSON.parse(response.output_text)}}
      catch{return {status:"failed_known",usage,responseId:response.id,error:"Structured output was not parseable JSON"};}
    }};
  if(phase==="acceptance"){
    const result=await runTournament(deps,"acceptance");
    save(join(outputDir,"acceptance-comparison.json"),result);
    console.log(JSON.stringify({phase:result.phase,allSourcesGroundedAndScored:result.allSourcesGroundedAndScored,newDispatches:result.newDispatches,comparisonPath:join(outputDir,"acceptance-comparison.json")}));
  }else{
    const comparison=await runTournament(deps);
    save(join(outputDir,"comparison.json"),{planHash:prepared.plan.planHash,...comparison});
    console.log(JSON.stringify({status:comparison.status,selectedId:comparison.selectedId,actualDispatches:comparison.actualDispatches,actualTokens:comparison.actualTokens,comparisonPath:join(outputDir,"comparison.json")}));
  }
}
async function replay(){
  const prepared=await prepare();
  const saved=readJson(join(outputDir,"plan.json")) as {planHash:string};
  if(saved.planHash!==prepared.plan.planHash)throw new Error("Preflight plan stale");
  const result={planHash:prepared.plan.planHash,mode:"offline_contract_replay",newPaidDispatches:0,historical:prepared.plan.historicalLedger,plannedAcceptanceAtMost:6,plannedInitial:24,plannedAdaptiveAtMost:12,plannedHoldoutAtMost:4,plannedTotalAtMost:40,
    sourcePayloadHashes:prepared.plan.sampleInputHashes,extractionSchemaHash:prepared.plan.extractionSchemaHash,judgeSchemaHash:prepared.plan.judgeSchemaHash};
  save(join(outputDir,"replay.json"),result);console.log(JSON.stringify(result));
}
async function freezeFinalists(){
  const prepared=await prepare();
  const saved=readJson(join(outputDir,"plan.json")) as {planHash:string};
  if(saved.planHash!==prepared.plan.planHash)throw new Error("Preflight plan stale");
  if(!existsSync(progressPath))throw new Error("Completed paid development comparison required before finalist freeze");
  const state=readJson(progressPath) as TournamentState;
  const authorizationPath=arg("--authorization-file");
  if(!authorizationPath)throw new Error("Approved authorization file required for holdout freeze");
  const authorizationBytes=readFileSync(authorizationPath);
  parseTournamentAuthorization(JSON.parse(authorizationBytes.toString("utf8")),prepared.plan.planHash);
  const handoff=freezeHoldoutHandoff(state,sha256(JSON.stringify({prompt:ADJUDICATION_PROMPT,schema:z.toJSONSchema(adjudicationSchema),evaluator:prepared.plan.behaviorHashes.evaluator})),sha256(authorizationBytes));
  save(join(outputDir,"holdout-handoff.json"),handoff);
  console.log(JSON.stringify({handoffHash:handoff.handoffHash,finalists:handoff.finalistPrompts.map(x=>x.id),developmentDispatches:handoff.developmentDispatches,developmentTokens:handoff.developmentTokens}));
}
void(async()=>{if(mode==="--preflight")await preflight();else if(mode==="--replay")await replay();else if(mode==="--acceptance")await paid("acceptance");else if(mode==="--paid")await paid("full");else if(mode==="--freeze-finalists")await freezeFinalists();else throw new Error("Use --preflight, --replay, --acceptance, --paid, or --freeze-finalists");})().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
