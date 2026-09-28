// Run only in a separately permissioned holdout context. This entry point never reads the development fixture directory.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { cleanDocumentPagesForModel, pageTextForModel } from "../lib/pdf/model-text";
import { ADJUDICATION_PROMPT, adjudicationSchema, type DevGold } from "../lib/ai/narrative-tournament-evaluation";
import { sha256 } from "../lib/ai/narrative-tournament";
import { runIsolatedHoldout, validateHoldoutHandoff, type HoldoutHandoff, type HoldoutState } from "../lib/ai/narrative-tournament-holdout";
import { buildTournamentRequest, parseTournamentAuthorization } from "../lib/ai/narrative-tournament-request";
import type { ApprovalCaps, DispatchResult, Operation, SampleInput } from "../lib/ai/narrative-tournament-runner";

const args=process.argv.slice(2),mode=args[0]??"--preflight";
function arg(flag:string){const i=args.indexOf(flag);return i<0?null:args[i+1]??null;}
const codeRoot=resolve(import.meta.dirname,"..");
const isolatedRootArg=arg("--isolated-root");
const isolatedRoot=isolatedRootArg?resolve(isolatedRootArg):null;
function inside(path:string,root:string){const rel=relative(root,path);return rel==="" || (!rel.startsWith("..") && !isAbsolute(rel));}
if(!isolatedRoot || inside(isolatedRoot,codeRoot) || inside(codeRoot,isolatedRoot))throw new Error("Separate holdout root outside the optimizer checkout required");
const holdoutRoot:string=isolatedRoot;
function isolatedPath(value:string|null,label:string){
  if(!value)throw new Error(`${label} path required`);
  const path=resolve(holdoutRoot,value);
  if(!inside(path,holdoutRoot))throw new Error(`${label} path escapes isolated holdout root`);
  return path;
}
function readJson(path:string):unknown{return JSON.parse(readFileSync(path,"utf8"));}
function save(path:string,value:unknown){mkdirSync(dirname(path),{recursive:true});const temp=`${path}.tmp`;writeFileSync(temp,JSON.stringify(value,null,2));renameSync(temp,path);}
const handoffPath=isolatedPath(arg("--handoff"),"handoff"),bundlePath=isolatedPath(arg("--bundle"),"bundle");
const handoff=readJson(handoffPath) as HoldoutHandoff;
const bundle=z.object({sample:z.string().min(1),pdfFile:z.string().min(1),pdfSha256:z.string().length(64),selectedPages:z.array(z.number().int().positive()).min(1),gold:z.unknown()}).strict().parse(readJson(bundlePath));
const pdfPath=isolatedPath(bundle.pdfFile,"PDF");
const pdfBytes=readFileSync(pdfPath);
if(sha256(pdfBytes)!==bundle.pdfSha256)throw new Error("Holdout PDF hash mismatch");
if(new Set(bundle.selectedPages).size!==bundle.selectedPages.length)throw new Error("Duplicate holdout page");
const evaluatorHash=sha256(readFileSync(resolve(codeRoot,"lib","ai","narrative-tournament-evaluation.ts")));
const evaluationHash=sha256(JSON.stringify({prompt:ADJUDICATION_PROMPT,schema:z.toJSONSchema(adjudicationSchema),evaluator:evaluatorHash}));

async function sampleFromPdf():Promise<SampleInput>{
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task=pdfjs.getDocument({data:Uint8Array.from(pdfBytes),useSystemFonts:true});
  const pdf=await task.promise;
  const raw:Array<{pageNumber:number;text:string}>=[];
  try{
    for(const number of bundle.selectedPages){
      if(number>pdf.numPages)throw new Error("Holdout page outside PDF");
      const page=await pdf.getPage(number),content=await page.getTextContent();
      let text="";
      for(const item of content.items)if("str" in item)text+=item.str+(item.hasEOL?"\n":" ");
      raw.push({pageNumber:number,text:text.replace(/\u0000/g,"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim()});
      page.cleanup();
    }
  }finally{await task.destroy();}
  const cleaned=cleanDocumentPagesForModel(raw);
  const pages=raw.map((p,i)=>({physicalPdfPage:p.pageNumber,text:p.text,modelText:pageTextForModel(cleaned.pages[i])}));
  return {code:bundle.sample,pages:pages.map(({physicalPdfPage,text})=>({physicalPdfPage,text})),
    sourcePayload:`SOURCE PAGES\n\n${pages.map(p=>`<campaign-page number="${p.physicalPdfPage}">\n${p.modelText}\n</campaign-page>`).join("\n\n")}`};
}

async function main(){
  const sample=await sampleFromPdf();
  const gold=bundle.gold as DevGold;
  if(!gold || !Array.isArray(gold.claims) || !Array.isArray(gold.entities) || !Array.isArray(gold.negativeChecks))throw new Error("Holdout scoring bundle invalid");
  validateHoldoutHandoff(handoff,handoff.developmentPlanHash,evaluationHash);
  const progressPath=isolatedPath(arg("--progress")??"holdout-progress.json","progress");
  if(mode==="--preflight"){
    console.log(JSON.stringify({mode:"isolated_holdout_preflight",paidDispatches:0,handoffHash:handoff.handoffHash,pdfHash:bundle.pdfSha256,sample:sample.code,pages:sample.pages.length,plannedExtractions:2,plannedJudges:2}));
    return;
  }
  if(mode!=="--paid")throw new Error("Use --preflight or --paid");
  const authorizationPath=isolatedPath(arg("--authorization-file"),"authorization");
  const authorizationBytes=readFileSync(authorizationPath);
  if(sha256(authorizationBytes)!==handoff.authorizationHash)throw new Error("Holdout authorization differs from development authorization");
  const approved=parseTournamentAuthorization(JSON.parse(authorizationBytes.toString("utf8")),handoff.developmentPlanHash);
  const caps:ApprovalCaps={maxUsd:approved.maxUsd,inputUsdPerMillion:approved.inputUsdPerMillion,outputUsdPerMillion:approved.outputUsdPerMillion,modelMaxOutputTokens:approved.modelMaxOutputTokens};
  const {default:OpenAI}=await import("openai");
  const client=new OpenAI({maxRetries:0});
  const result=await runIsolatedHoldout({handoff,planHash:approved.planHash,evaluationHash,sample,gold,caps,
    load:()=>existsSync(progressPath)?readJson(progressPath) as HoldoutState:null,
    save:state=>save(progressPath,state),
    async dispatch(operation:Operation,outputAllowance:number):Promise<DispatchResult>{
      const response=await client.responses.create(buildTournamentRequest(operation,outputAllowance));
      const u=response.usage;
      if(!u)throw new Error("Holdout response missing usage");
      const usage={inputTokens:u.input_tokens,outputTokens:u.output_tokens,totalTokens:u.total_tokens};
      if(response.status!=="completed"||response.incomplete_details)return {status:"failed_known",usage,responseId:response.id,error:`Response status ${response.status}`};
      try{return {status:"completed",usage,responseId:response.id,output:JSON.parse(response.output_text)}}catch{return {status:"failed_known",usage,responseId:response.id,error:"Unparseable holdout output"};}
    }});
  save(isolatedPath(arg("--result")??"holdout-result.json","result"),result);
  console.log(JSON.stringify({status:result.status,combinedDispatches:result.combinedDispatches,combinedTokens:result.combinedTokens,provisional:true}));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
