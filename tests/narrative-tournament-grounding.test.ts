import { describe, expect, it } from "vitest";
import { narrativeOutputSchema, partitionGrounding, validateGrounding, type NarrativeOutput } from "../lib/ai/narrative-tournament";
import { scoreAdjudicated, type DevGold } from "../lib/ai/narrative-tournament-evaluation";

const pages=[{physicalPdfPage:6,text:"Mira crossed the\nriver. Joran stayed by the old well. Mira pro-\nceeded east."},{physicalPdfPage:7,text:"A different page."}];
const entity=(name:string,quote=name)=>({name,type:"npc" as const,presentation:"page" as const,parentOrAttachment:"",existencePage:6,existenceQuote:quote});
const proposition=(id:string,quote:string,page=6,subjects=["Mira"])=>({id,statement:"Mira crossed the river.",modality:"established" as const,subjects,evidence:[{page,quote}]});
const output=(propositions:NarrativeOutput["propositions"],entities:NarrativeOutput["entities"],relationships:NarrativeOutput["relationships"]=[]):NarrativeOutput=>narrativeOutputSchema.parse({propositions,entities,relationships,sourceDiscrepancies:[]});

describe("item-level narrative grounding",()=>{
  it("accepts actual PDF.js page numbers, verbatim quotes and whitespace/line-wrap normalization",()=>{
    const candidate=output([proposition("good","crossed the river"),proposition("wrapped","Mira proceeded east")],[entity("Mira")]);
    const result=partitionGrounding(candidate,pages);
    expect(result.issues).toEqual([]);
    expect(result.accepted.propositions).toHaveLength(2);
    expect(validateGrounding(candidate,pages)).toEqual([]);
  });
  it("rejects a quote on the wrong physical page or a paraphrase without discarding a grounded peer",()=>{
    const candidate=output([proposition("good","crossed the river"),proposition("wrong-page","crossed the river",7),proposition("paraphrase","Mira traversed the stream")],[entity("Mira")]);
    const result=partitionGrounding(candidate,pages);
    expect(result.accepted.propositions.map(p=>p.id)).toEqual(["good"]);
    expect(result.issues.map(i=>[i.outputId,i.reason])).toEqual([
      ["wrong-page","quote absent from raw PDF.js page"],["paraphrase","quote absent from raw PDF.js page"],
    ]);
    expect(result.rejectedItemCount).toBe(2);
  });
  it("rejects duplicate identities and their dependents while preserving unrelated identities",()=>{
    const candidate=output([proposition("mira","crossed the river"),proposition("joran","Joran stayed by the old well",6,["Joran"])],[entity("Mira"),entity("Mira"),entity("Joran")]);
    const result=partitionGrounding(candidate,pages);
    expect(result.accepted.entities.map(e=>e.name)).toEqual(["Joran"]);
    expect(result.accepted.propositions.map(p=>p.id)).toEqual(["joran"]);
    expect(result.issues.filter(i=>i.reason==="duplicate entity identity")).toHaveLength(2);
    expect(result.issues.some(i=>i.outputId==="mira"&&i.reason.includes("rejected subject"))).toBe(true);
  });
  it("rejects every occurrence of a duplicate proposition ID",()=>{
    const result=partitionGrounding(output([proposition("repeat","crossed the river"),proposition("repeat","crossed the river"),proposition("unique","crossed the river")],[entity("Mira")]),pages);
    expect(result.accepted.propositions.map(p=>p.id)).toEqual(["unique"]);
    expect(result.issues.filter(i=>i.reason==="duplicate proposition ID")).toHaveLength(2);
  });
  it("rejects a parent cycle without losing an unrelated grounded entity",()=>{
    const a={...entity("A","Mira"),parentOrAttachment:"B"};
    const b={...entity("B","Joran"),parentOrAttachment:"A"};
    const result=partitionGrounding(output([proposition("good","crossed the river")],[a,b,entity("Mira")]),pages);
    expect(result.accepted.entities.map(e=>e.name)).toEqual(["Mira"]);
    expect(result.accepted.propositions.map(p=>p.id)).toEqual(["good"]);
    expect(result.issues.some(i=>i.reason==="parent cycle")).toBe(true);
  });
  it("rejects a relationship with a missing endpoint but keeps its independently grounded proposition",()=>{
    const candidate=output([proposition("good","crossed the river")],[entity("Mira")],[{source:"Mira",label:"met",target:"Missing",modality:"established",page:6,quote:"Mira crossed the"}]);
    const result=partitionGrounding(candidate,pages);
    expect(result.accepted.propositions.map(p=>p.id)).toEqual(["good"]);
    expect(result.accepted.relationships).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({kind:"relationship",reason:"unknown or rejected endpoint"})]);
    expect(result.rejectedItemCount).toBe(1);
  });
  it("never credits an ungrounded claim and counts it as an unsupported error",()=>{
    const candidate=output([proposition("good","crossed the river"),proposition("bad","Mira traversed the stream")],[entity("Mira")]);
    const result=partitionGrounding(candidate,pages);
    const gold:DevGold={claims:[
      {id:"G-good",sample:"S",importance:3,subjects:["Mira"],modality:"established",physicalPdfPage:6,expectedProposition:"Mira crossed the river.",sourceAnchor:"crossed the"},
      {id:"G-bad",sample:"S",importance:3,subjects:["Mira"],modality:"established",physicalPdfPage:6,expectedProposition:"Mira traversed the stream.",sourceAnchor:"crossed the"},
    ],entities:[],negativeChecks:[]};
    const judgment={propositions:[
      {goldId:"G-good",outputIds:["good"],verdict:"correct" as const,modalityCorrect:true,evidence:{page:6,quote:"crossed the"},uncertainty:"low" as const,failurePattern:"none" as const,reason:"Direct support."},
      {goldId:"G-bad",outputIds:[],verdict:"missing" as const,modalityCorrect:true,evidence:{page:null,quote:""},uncertainty:"low" as const,failurePattern:"omission" as const,reason:"Rejected output cannot count."},
    ],entities:[],negativeChecks:[],unsupportedOutputs:[],unsupportedEntities:[]};
    const scored=scoreAdjudicated(gold,"S",result.accepted,pages,judgment,result.rejectedItemCount);
    expect(result.accepted.propositions.map(p=>p.id)).toEqual(["good"]);
    expect(scored.propositionPoints).toBe(3);
    expect(scored.unsupportedCount).toBe(1);
    expect(scored.patterns.unsupported).toBe(1);
    expect(()=>scoreAdjudicated(gold,"S",result.accepted,pages,{...judgment,propositions:[judgment.propositions[0],{...judgment.propositions[1],outputIds:["bad"],verdict:"correct" as const,evidence:{page:6,quote:"crossed the"}}]},1)).toThrow(/unknown output ID/);
  });
});
