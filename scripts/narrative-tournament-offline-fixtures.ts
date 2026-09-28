import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanDocumentPagesForModel, pageTextForModel } from "../lib/pdf/model-text";
import { blindedJudgeInput, scoreAdjudicated, type DevGold } from "../lib/ai/narrative-tournament-evaluation";
import { narrativeOutputSchema, partitionGrounding, sha256 } from "../lib/ai/narrative-tournament";
import { findVerbatimEvidence } from "../lib/ai/graph-extraction";

const root=join(process.cwd(),"fixtures","private","narrative-dev");
const dir=join(root,"tournament");
const source=JSON.parse(readFileSync(join(root,"campaign_wiki_DEV_source.json"),"utf8")) as {samples:Array<{code:string;selectedPages:number[];sourceSha256:string}>};
const gold=JSON.parse(readFileSync(join(root,"campaign_wiki_DEV_scoring.json"),"utf8")) as DevGold;
const plan=JSON.parse(readFileSync(join(dir,"plan.json"),"utf8")) as {sampleInputHashes:Array<{sample:string;sourcePayloadHash:string;rawPageHash:string}>};
const fixtures=JSON.parse(readFileSync(join(dir,"known-good-extractions.json"),"utf8")) as Record<string,{goldClaimId:string;output:unknown}>;
const files:Record<string,string>={SW:"The Demonplague Sweetwater Village(1).pdf",WOTBS:"WotBS - Campaign Guide (1).pdf",TALES:"Tales_of_the_Demon_Lord_no_bkgd_v6-5-16 (1).pdf"};

async function pdfjsPages(bytes:Uint8Array, selected:number[]){
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task=pdfjs.getDocument({data:Uint8Array.from(bytes),useSystemFonts:true});
  const pdf=await task.promise;
  const pages:Array<{pageNumber:number;text:string}>=[];
  try{
    for(const number of selected){
      const page=await pdf.getPage(number),content=await page.getTextContent();
      let text="";
      for(const item of content.items)if("str" in item)text+=item.str+(item.hasEOL?"\n":" ");
      pages.push({pageNumber:number,text:text.replace(/\u0000/g,"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim()});
      page.cleanup();
    }
  }finally{await task.destroy();}
  return pages;
}

async function main(){
const results=[];
for(const sample of source.samples){
  const bytes=readFileSync(join(root,files[sample.code]));
  if(sha256(bytes)!==sample.sourceSha256)throw new Error(`Source PDF changed: ${sample.code}`);
  const raw=await pdfjsPages(bytes,sample.selectedPages);
  const cleaned=cleanDocumentPagesForModel(raw);
  const pages=raw.map(p=>({physicalPdfPage:p.pageNumber,text:p.text}));
  const modelPages=raw.map((p,i)=>({physicalPdfPage:p.pageNumber,text:pageTextForModel(cleaned.pages[i])}));
  const sourcePayload=`SOURCE PAGES\n\n${modelPages.map(p=>`<campaign-page number="${p.physicalPdfPage}">\n${p.text}\n</campaign-page>`).join("\n\n")}`;
  const expected=plan.sampleInputHashes.find(x=>x.sample===sample.code);
  if(!expected||sha256(sourcePayload)!==expected.sourcePayloadHash||sha256(JSON.stringify(pages))!==expected.rawPageHash)throw new Error(`Production-style serialization differs from frozen source input: ${sample.code}`);
  const fixture=fixtures[sample.code];
  if(!fixture)throw new Error(`Missing known-good fixture: ${sample.code}`);
  const output=narrativeOutputSchema.parse(fixture.output);
  for(const item of [...output.propositions.flatMap(p=>p.evidence),...output.entities.map(e=>({page:e.existencePage,quote:e.existenceQuote})),...output.relationships.map(r=>({page:r.page,quote:r.quote}))]){
    const model=modelPages.find(p=>p.physicalPdfPage===item.page)?.text??"";
    if(!findVerbatimEvidence(model,item.quote))throw new Error(`Fixture evidence absent from serialized model input: ${sample.code} p${item.page}`);
  }
  const partition=partitionGrounding(output,pages);
  if(partition.issues.length||!partition.usable)throw new Error(`Known-good fixture failed grounding: ${sample.code}: ${JSON.stringify(partition.issues)}`);
  const selected=gold.claims.find(c=>c.id===fixture.goldClaimId&&c.sample===sample.code);
  if(!selected||output.propositions.length!==1)throw new Error(`Fixture/gold identity mismatch: ${sample.code}`);
  const input=blindedJudgeInput(gold,sample.code,partition.accepted,pages);
  const adjudication={
    propositions:gold.claims.filter(c=>c.sample===sample.code).map(c=>({goldId:c.id,outputIds:c.id===selected.id?[output.propositions[0].id]:[],verdict:c.id===selected.id?"partial":"missing",modalityCorrect:true,
      evidence:c.id===selected.id?output.propositions[0].evidence[0]:{page:null,quote:""},uncertainty:"low",failurePattern:"none",reason:"Offline fixture checks the pipeline; this is not a blinded model judgment."})),
    entities:input.unmatchedEntities.map(e=>({goldId:e.id,outputName:null,verdict:"missing",presentationCorrect:false,parentCorrect:false,evidence:{page:null,quote:""},uncertainty:"low",reason:"Not included in the minimal fixture."})),
    negativeChecks:gold.negativeChecks.filter(n=>n.sample===sample.code).map(n=>({goldId:n.id,verdict:"uncertain",outputIds:[],evidence:{page:null,quote:""},reason:"No blinded judge was used in this offline fixture."})),
    unsupportedOutputs:[],unsupportedEntities:[],
  } as Parameters<typeof scoreAdjudicated>[4];
  const score=scoreAdjudicated(gold,sample.code,partition.accepted,pages,adjudication);
  if(score.propositionPoints<=0||score.quality<=0)throw new Error(`Known-good fixture did not score: ${sample.code}`);
  results.push({sample:sample.code,sourcePayloadHash:expected.sourcePayloadHash,rawPageHash:expected.rawPageHash,physicalPages:sample.selectedPages,fixtureClaimId:selected.id,propositionId:output.propositions[0].id,groundingIssues:partition.issues.length,propositionPoints:score.propositionPoints,quality:score.quality,scoreStatus:score.status});
}
const implementationHashes={
  fixtureHarness:sha256(readFileSync(join(process.cwd(),"scripts","narrative-tournament-offline-fixtures.ts"))),
  grounding:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament.ts"))),
  scoring:sha256(readFileSync(join(process.cwd(),"lib","ai","narrative-tournament-evaluation.ts"))),
  modelText:sha256(readFileSync(join(process.cwd(),"lib","pdf","model-text.ts"))),
  fixtureDefinitions:sha256(readFileSync(join(dir,"known-good-extractions.json"))),
};
const output={planSourceHashesVerified:true,mode:"offline_known_good_not_model_quality",implementationHashes,results};
writeFileSync(join(dir,"known-good-fixture-results.json"),`${JSON.stringify(output,null,2)}\n`);
console.log(JSON.stringify(output));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
