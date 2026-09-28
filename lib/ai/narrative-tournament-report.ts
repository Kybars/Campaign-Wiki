import { ADJUDICATION_PROMPT, adjudicationSchema, type Adjudication, type DevClaim, type DevGold } from "./narrative-tournament-evaluation";
import { MODEL_ID, TOURNAMENT_VERSION, narrativeOutputSchema, normalized, promptVariants, sha256, type NarrativeOutput } from "./narrative-tournament";
import { RUNNER_VERSION, budgetUsage, revisionDirectives, validateUsage, type CandidateResult, type Checkpoint, type FailurePattern, type TournamentState } from "./narrative-tournament-runner";

export interface FrozenReportPlan {
  planHash:string; model:string; version:string; baselinePromptHashes:Record<string,string>; judgePromptHash:string;
  sampleInputHashes:Array<{sample:string}>;
}
export interface PromptVersion {
  name:string; version:string; hash:string; prompt:string; compareTo:string|null;
  failurePattern:FailurePattern|null; reason:string;
}
export interface PromptComparisonDetail {
  candidate:string; sample:string; score:CandidateResult["scores"][number]|null;
  extraction:Checkpoint|null; judge:Checkpoint|null;
  extractionOutput:NarrativeOutput|null; adjudication:Adjudication|null;
  importantRecovered:Array<{gold:DevClaim;judgment:Adjudication["propositions"][number]}>;
  importantMissed:Array<{gold:DevClaim;judgment:Adjudication["propositions"][number]}>;
  improvedFromComparator:string[]; regressedFromComparator:string[];
  pageSelectionErrors:Array<{entity:string;expected:string;actual:string;sourcePage:number;sourceQuote:string}>;
}

function segments(value:string){return value.split(/\n|(?<=[.!?])\s+/u).map(s=>s.trim()).filter(Boolean);}
export function readablePromptDiff(before:string,after:string){
  const left=segments(before),right=segments(after);
  const dp=Array.from({length:left.length+1},()=>Array<number>(right.length+1).fill(0));
  for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)dp[i][j]=left[i]===right[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
  const lines:string[]=[];let i=0,j=0;
  while(i<left.length||j<right.length){
    if(i<left.length&&j<right.length&&left[i]===right[j]){lines.push(`  ${left[i]}`);i++;j++;}
    else if(i<left.length&&(j===right.length||dp[i+1][j]>=dp[i][j+1]))lines.push(`- ${left[i++]}`);
    else lines.push(`+ ${right[j++]}`);
  }
  return lines.join("\n");
}

function promptVersions(state:TournamentState|null):PromptVersion[]{
  const initial=Object.entries(promptVariants).map(([name,prompt])=>({name,version:TOURNAMENT_VERSION,hash:sha256(prompt),prompt,compareTo:name==="baseline"?null:"baseline",failurePattern:null,reason:name==="baseline"?"Reference wording for this tournament.":"Initial editorial strategy; no observed effect exists before a paid run."} as PromptVersion));
  const byName=new Map(initial.map(v=>[v.name,v]));
  for(const revision of state?.revisions??[]){
    const parent=byName.get(revision.parentId),directive=revisionDirectives[revision.pattern];
    if(!parent||!directive||revision.prompt!==`${parent.prompt}\n${directive}`||sha256(revision.prompt)!==revision.promptHash)throw new Error(`Revision prompt integrity failure: ${revision.id}`);
    const version:PromptVersion={name:revision.id,version:`${RUNNER_VERSION}/${revision.id}`,hash:revision.promptHash,prompt:revision.prompt,compareTo:revision.parentId,failurePattern:revision.pattern,reason:`Revision selected from the parent's weighted general ${revision.pattern} failure pattern. Added directive: ${directive}`};
    byName.set(version.name,version);
    initial.push(version);
  }
  return initial;
}

function sharedInstructions(versions:PromptVersion[]){
  const marker="Return only the fixed JSON schema.";
  const snippets=versions.slice(0,4).map(v=>v.prompt.slice(v.prompt.indexOf(marker)));
  if(snippets.some(s=>!s.startsWith(marker)||s!==snippets[0]))throw new Error("Shared extraction instruction mismatch");
  return snippets[0];
}

function rank(item:Adjudication["propositions"][number]|undefined){
  if(!item||!item.modalityCorrect||item.uncertainty==="high")return 0;
  return item.verdict==="correct"?2:item.verdict==="partial"?1:0;
}
function maybeOutput(checkpoint:Checkpoint|null){return checkpoint?.state==="completed"&&checkpoint.output?narrativeOutputSchema.parse(checkpoint.output):null;}
function maybeJudge(checkpoint:Checkpoint|null){return checkpoint?.state==="completed"&&checkpoint.output?adjudicationSchema.parse(checkpoint.output):null;}
function usdNotReported(){return "USD is intentionally omitted: the checkpoint contains actual token totals but not invoice-grade billing details.";}
function fmt(value:number|null|undefined){return value===null||value===undefined?"—":value.toFixed(3);}
function evidence(page:number|null,quote:string,label="source quote"){
  return page===null?"no cited page":`physical PDF p. ${page}, ${label}: “${quote.replace(/[\r\n]+/gu," ")}”`;
}
function usage(checkpoints:Array<Checkpoint|null>){
  const known=checkpoints.filter((c):c is Checkpoint=>Boolean(c));
  if(!known.length)return null;
  if(known.some(c=>!c.usage))return null;
  return budgetUsage(known);
}
function tokenCell(checkpoint:Checkpoint|null){
  return checkpoint?.usage?`${checkpoint.usage.inputTokens} / ${checkpoint.usage.outputTokens}`:checkpoint?"unknown":"—";
}

export function buildPromptComparison(plan:FrozenReportPlan,gold:DevGold,state:TournamentState|null){
  if(plan.model!==MODEL_ID||plan.version!==RUNNER_VERSION||!plan.planHash)throw new Error("Frozen model/runner plan mismatch");
  const versions=promptVersions(state);
  for(const v of versions.slice(0,4))if(plan.baselinePromptHashes[v.name]!==v.hash)throw new Error(`Frozen initial prompt hash mismatch: ${v.name}`);
  if(plan.judgePromptHash!==sha256(ADJUDICATION_PROMPT))throw new Error("Frozen judge prompt hash mismatch");
  if(state){
    if(state.planHash!==plan.planHash)throw new Error("Saved run plan hash mismatch");
    if(new Set(state.checkpoints.map(c=>c.key)).size!==state.checkpoints.length)throw new Error("Duplicate saved checkpoint key");
    for(const checkpoint of state.checkpoints)if(checkpoint.usage)validateUsage(checkpoint.usage);
    if(state.comparison){
      const totals=budgetUsage([...(state.history?.checkpoints??[]),...state.checkpoints]);
      if(totals.dispatches!==state.comparison.actualDispatches||totals.totalTokens!==state.comparison.actualTokens)throw new Error("Saved comparison/usage ledger mismatch");
      for(const candidate of state.comparison.candidates){const version=versions.find(v=>v.name===candidate.id);if(!version||candidate.promptHash!==version.hash)throw new Error(`Saved candidate prompt hash mismatch: ${candidate.id}`);}
    }
  }
  const samples=plan.sampleInputHashes.map(s=>s.sample);
  if(samples.length!==3||new Set(samples).size!==3)throw new Error("Frozen development source list mismatch");
  const checkpointByKey=new Map((state?.checkpoints??[]).map(c=>[c.key,c]));
  const candidateById=new Map((state?.comparison?.candidates??[]).map(c=>[c.id,c]));
  const details:PromptComparisonDetail[]=[];
  for(const version of versions)for(const sample of samples){
    const candidate=candidateById.get(version.name);
    const extraction=checkpointByKey.get(`extract:${version.name}:${sample}`)??null;
    const judge=checkpointByKey.get(`judge:${version.name}:${sample}`)??null;
    const extractionOutput=maybeOutput(extraction),adjudication=maybeJudge(judge);
    const score=candidate?.scores.find(s=>s.sample===sample)??null;
    const importantGold=gold.claims.filter(c=>c.sample===sample&&c.importance>=3);
    const judgedById=new Map(adjudication?.propositions.map(j=>[j.goldId,j])??[]);
    const importantRecovered=importantGold.flatMap(g=>{const judgment=judgedById.get(g.id);return judgment&&rank(judgment)>0?[{gold:g,judgment}]:[];});
    const importantMissed=adjudication?importantGold.flatMap(g=>{const judgment=judgedById.get(g.id);return judgment&&rank(judgment)===0?[{gold:g,judgment}]:[]}):[];
    const comparator=version.compareTo?checkpointByKey.get(`judge:${version.compareTo}:${sample}`):null;
    const priorById=new Map(maybeJudge(comparator??null)?.propositions.map(j=>[j.goldId,j])??[]);
    const improvedFromComparator=adjudication&&version.compareTo&&comparator?.state==="completed"?importantGold.filter(g=>rank(judgedById.get(g.id))>rank(priorById.get(g.id))).map(g=>g.id):[];
    const regressedFromComparator=adjudication&&version.compareTo&&comparator?.state==="completed"?importantGold.filter(g=>rank(judgedById.get(g.id))<rank(priorById.get(g.id))).map(g=>g.id):[];
    const pageSelectionErrors=extractionOutput?gold.entities.filter(g=>g.sample===sample).flatMap(g=>{
      const found=extractionOutput.entities.find(e=>normalized(e.name)===normalized(g.name));
      if(!found)return [];
      const presentationCorrect=g.expectedPresentation==="page_or_reuse"?["page","attached"].includes(found.presentation):found.presentation===g.expectedPresentation;
      const parentCorrect=!g.parentOrAttachment||normalized(found.parentOrAttachment)===normalized(g.parentOrAttachment);
      return presentationCorrect&&parentCorrect?[]:[{entity:g.name,expected:`${g.expectedPresentation}${g.parentOrAttachment?` / ${g.parentOrAttachment}`:""}`,actual:`${found.presentation}${found.parentOrAttachment?` / ${found.parentOrAttachment}`:""}`,sourcePage:found.existencePage,sourceQuote:found.existenceQuote}];
    }):[];
    details.push({candidate:version.name,sample,score,extraction,judge,extractionOutput,adjudication,importantRecovered,importantMissed,improvedFromComparator,regressedFromComparator,pageSelectionErrors});
  }
  const lines:string[]=[
    "# Prompt comparison — private development artifact",
    "",
    `Frozen plan SHA-256: ${plan.planHash}. Model: ${MODEL_ID}. Initial prompt version: ${TOURNAMENT_VERSION}. Runner version: ${RUNNER_VERSION}.`,
    "",
    "This file is local-only because development claim wording and source quotations may be copyrighted. It contains no Delian holdout material. Automatic semantic judgments are provisional development measurements, not verified gold. Exact request prompts below are the **system instruction text**; each extraction also received its fixed source-page payload as a separate user message. Source payload bytes are not repeated here.",
    "",
    state?.comparison ? `Run status: ${state.status}; selected development candidate: ${state.comparison.selectedId??"none"}.` : "Run status: **offline preflight only**. No extraction or judge requests, adaptive revisions, quality observations, or token usage exist yet.",
    "",
    "## Shared extraction instructions",
    "",
    "The following text appears verbatim at the end of all four initial prompts and is retained by adaptive revisions:",
    "",
    "```text",sharedInstructions(versions),"```","",
    "## Complete blinded-judge prompt","",
    `SHA-256: ${sha256(ADJUDICATION_PROMPT)}. The judge receives development source pages, draft rubric rows, deterministic exact-match IDs, and candidate output without a variant name. Its source quotes and uncertainty are retained in the private run record.`,
    "","```text",ADJUDICATION_PROMPT,"```","",
    "## Results and interpretation","",
    usdNotReported(),"",
  ];
  if(!state?.comparison){
    lines.push("No observed quality or token comparison is possible before the paid development run. Descriptions of prompt intent below are hypotheses, not measured effects.","");
  }else{
    lines.push("Observed associations below compare each initial variant with `baseline` and each adaptive revision with its recorded parent. Score deltas and claim transitions describe this development run; they do not establish that a wording change caused the difference.","");
    lines.push("| Prompt | Compared with | Sweetwater Δ | WotBS Δ | Tales Δ | Actual token Δ | Observation |","| --- | --- | ---: | ---: | ---: | ---: | --- |");
    for(const version of versions){
      if(!version.compareTo)continue;
      const candidate=candidateById.get(version.name),parent=candidateById.get(version.compareTo);
      const delta=(sample:string)=>{const a=candidate?.scores.find(s=>s.sample===sample)?.quality,b=parent?.scores.find(s=>s.sample===sample)?.quality;return a===undefined||b===undefined?"—":`${a-b>=0?"+":""}${(a-b).toFixed(3)}`;};
      const tokenDelta=candidate&&parent?`${candidate.actualTokens-parent.actualTokens>=0?"+":""}${candidate.actualTokens-parent.actualTokens}`:"—";
      const values=samples.map(delta),observation=values.every(x=>x==="—")?"No paired scores":values.some(x=>x.startsWith("-"))&&values.some(x=>x.startsWith("+"))?"Mixed gains and regressions":values.some(x=>x.startsWith("-"))?"Regression on scored source(s)":"No scored-source regression";
      lines.push(`| \`${version.name}\` | \`${version.compareTo}\` | ${values.join(" | ")} | ${tokenDelta} | ${observation} |`);
    }
    lines.push("","Hypotheses about why a variant changed performance appear with its prompt below. The observed scores and claim-level transitions above are the evidence; no causal attribution is made.","");
  }
  for(const version of versions){
    const candidate=candidateById.get(version.name);
    lines.push(`## ${version.name}`,"",`- Version: \`${version.version}\``, `- Exact prompt SHA-256: \`${version.hash}\``, `- Compared with: ${version.compareTo?`\`${version.compareTo}\``:"reference baseline"}`);
    if(version.failurePattern){
      const parent=candidateById.get(version.compareTo!);
      lines.push(`- Revision reason: weighted general \`${version.failurePattern}\` failure pattern${parent?` (parent pattern weight ${parent.patternTotals[version.failurePattern]??0})`:""}. ${revisionDirectives[version.failurePattern]}`);
    }else lines.push(`- Design intent (hypothesis, not result): ${version.reason}`);
    lines.push("","### Exact extraction system prompt","","```text",version.prompt,"```","","### Readable diff","",version.compareTo?`Against \`${version.compareTo}\`:`:"Baseline reference: no preceding tournament prompt.","");
    if(version.compareTo){const parent=versions.find(v=>v.name===version.compareTo)!;lines.push("```diff",readablePromptDiff(parent.prompt,version.prompt),"```","");}
    lines.push("### Development adventure results","","| Source | Provisional narrative quality | Proposition points | Identity / relationship / presentation / negative | Uncertain / unsupported | Extraction input / output | Judge input / output | Total actual tokens |","| --- | ---: | ---: | --- | --- | --- | --- | ---: |");
    for(const sample of samples){
      const detail=details.find(d=>d.candidate===version.name&&d.sample===sample)!;
      const rowUsage=usage([detail.extraction,detail.judge]);
      const s=detail.score;
      lines.push(`| ${sample} | ${fmt(s?.quality)} | ${s?`${s.propositionPoints}/${s.weightedTotal}`:"—"} | ${s?`${s.identityPoints} / ${s.relationshipPoints} / ${s.presentationPoints} / ${s.negativePassed}`:"—"} | ${s?`${s.uncertainCount} / ${s.unsupportedCount}`:"—"} | ${tokenCell(detail.extraction)} | ${tokenCell(detail.judge)} | ${rowUsage?.totalTokens??"—"} |`);
    }
    const own=state?.checkpoints.filter(c=>c.key.includes(`:${version.name}:`))??[];
    const total=usage(own);
    lines.push("",`Actual usage across development sources: **${total?`${total.inputTokens} input + ${total.outputTokens} output = ${total.totalTokens} total tokens`:`not available`}**. ${candidate?`Selection quality: ${fmt(candidate.quality)}; complete on all three sources: ${candidate.complete}.`:"No run record yet."}`,"");
    for(const sample of samples){
      const d=details.find(x=>x.candidate===version.name&&x.sample===sample)!;
      lines.push(`#### ${sample}: important source-backed observations`,"");
      if(d.extraction?.candidateResponse?.issues.length){
        lines.push("**Rejected grounding items** (excluded before judging and counted as errors):","");
        for(const item of d.extraction.candidateResponse.issues)lines.push(`- ${item.kind} \`${item.outputId}\`: ${item.reason}; cited page ${item.page??"none"}, candidate quote: “${item.quote??"none"}”.`);
        lines.push("");
      }
      if(!d.adjudication){lines.push(d.judge?.state==="failed_known"?`Judge failed with known usage: ${d.judge.error??"unspecified"}.`:d.extraction?.state==="failed_known"?`Extraction failed with known usage: ${d.extraction.error??"unspecified"}.`:"No adjudicated development record yet.","");continue;}
      const recovered=d.importantRecovered;
      lines.push("**Important recovered claims** (draft importance ≥3; provisional judge):","");
      if(!recovered.length)lines.push("- None recorded.");
      for(const {gold:g,judgment:j} of recovered)lines.push(`- \`${g.id}\` (${j.verdict}): ${g.expectedProposition} — ${evidence(j.evidence.page,j.evidence.quote)}. ${j.reason}`);
      lines.push("","**Important missed or uncertain claims** (draft importance ≥3):","");
      if(!d.importantMissed.length)lines.push("- None recorded.");
      for(const {gold:g,judgment:j} of d.importantMissed)lines.push(`- \`${g.id}\` (${j.verdict}${j.modalityCorrect?"":", modality mismatch"}; uncertainty ${j.uncertainty}): ${g.expectedProposition} — physical PDF p. ${g.physicalPdfPage}, draft anchor: “${g.sourceAnchor}”. ${j.reason}`);
      if(version.compareTo){lines.push("",`Claim transitions vs \`${version.compareTo}\`: recovered or improved ${d.improvedFromComparator.length?d.improvedFromComparator.map(id=>`\`${id}\``).join(", "):"none"}; regressed ${d.regressedFromComparator.length?d.regressedFromComparator.map(id=>`\`${id}\``).join(", "):"none"}.`,"");}
      lines.push("**Unsupported candidate claims/entities** (provisional judge):","");
      const unsupported=d.adjudication.unsupportedOutputs;
      if(!unsupported.length&&!d.adjudication.unsupportedEntities.length)lines.push("- None flagged.");
      for(const item of unsupported){const p=d.extractionOutput?.propositions.find(p=>p.id===item.outputId);lines.push(`- \`${item.outputId}\` (${item.verdict}): ${p?.statement??"output missing"}. Candidate evidence: ${p?.evidence.map(e=>evidence(e.page,e.quote)).join("; ")??"none"}. Judge: ${item.reason}${item.evidence.page?` (${evidence(item.evidence.page,item.evidence.quote)})`:""}.`);}
      for(const item of d.adjudication.unsupportedEntities)lines.push(`- Entity \`${item.outputName}\`: ${item.reason}${item.evidence.page?` (${evidence(item.evidence.page,item.evidence.quote)})`:""}.`);
      lines.push("","**Page-selection/attachment mismatches against the draft rubric** (provisional):","");
      if(!d.pageSelectionErrors.length)lines.push("- None detected by exact-name comparison.");
      for(const item of d.pageSelectionErrors)lines.push(`- ${item.entity}: expected \`${item.expected}\`, candidate \`${item.actual}\`; ${evidence(item.sourcePage,item.sourceQuote,"candidate existence quote")}.`);
      lines.push("");
    }
  }
  lines.push("## Adaptive revision inventory","",state?.revisions.length?`All ${state.revisions.length} recorded adaptive prompt(s) are printed in full above, in saved creation order.`:"No adaptive revision has been generated or used. This section is populated only from saved paid development records.","");
  const machine={planHash:plan.planHash,model:MODEL_ID,status:state?.status??"offline_preflight",versions,judgePrompt:ADJUDICATION_PROMPT,judgePromptHash:sha256(ADJUDICATION_PROMPT),details,observedComparison:state?.comparison??null};
  return {markdown:lines.join("\n"),details:machine};
}
