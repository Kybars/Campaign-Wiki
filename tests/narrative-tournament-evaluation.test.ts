import { describe, expect, it } from "vitest";
import { blindedJudgeInput, deterministicEvaluation, scoreAdjudicated, validateAdjudication, type DevGold } from "../lib/ai/narrative-tournament-evaluation";
import type { NarrativeOutput } from "../lib/ai/narrative-tournament";

const pages=[{physicalPdfPage:1,text:"Mira intends to meet Joran tomorrow."}];
const gold:DevGold={claims:[{id:"G1",sample:"S",importance:3,subjects:["Mira","Joran"],modality:"plan",physicalPdfPage:1,expectedProposition:"Mira intends to meet Joran tomorrow.",sourceAnchor:"intends to meet"}],
  entities:[{id:"E1",sample:"S",name:"Mira",type:"npc",expectedPresentation:"page",parentOrAttachment:"",physicalPdfPage:1}],
  negativeChecks:[{id:"X1",sample:"S",physicalPdfPage:1,mustNot:"Do not claim they already met."}]};
const output:NarrativeOutput={propositions:[{id:"p1",statement:"Mira intends to meet Joran tomorrow.",modality:"intention",subjects:["Mira","Joran"],evidence:[{page:1,quote:"intends to meet Joran tomorrow"}]}],
  entities:[{name:"Mira",type:"npc",presentation:"page",parentOrAttachment:"",existencePage:1,existenceQuote:"Mira"}],relationships:[],sourceDiscrepancies:[]};
const judgment={propositions:[{goldId:"G1",outputIds:["p1"],verdict:"correct" as const,modalityCorrect:true,evidence:{page:1,quote:"Mira intends to meet Joran tomorrow."},uncertainty:"low" as const,failurePattern:"none" as const,reason:"Intent and people match the source."}],
  entities:[],negativeChecks:[{goldId:"X1",verdict:"pass" as const,outputIds:[],evidence:{page:null,quote:""},reason:"No completed meeting asserted."}],unsupportedOutputs:[],unsupportedEntities:[]};

describe("blinded development adjudication",()=>{
  it("records exact draft agreement while omitting variant identity from judge input",()=>{
    expect(deterministicEvaluation(gold,"S",output,pages).exactClaims).toHaveLength(1);
    const input=blindedJudgeInput(gold,"S",output,pages);
    expect(JSON.stringify(input)).not.toMatch(/narrative_first|relevance_gated|entity_centered/);
  });
  it("requires complete row coverage and source-backed positive decisions",()=>{
    expect(validateAdjudication(judgment,gold,"S",output,pages).propositions).toHaveLength(1);
    expect(()=>validateAdjudication({...judgment,propositions:[]},gold,"S",output,pages)).toThrow(/omitted/);
    expect(()=>validateAdjudication({...judgment,propositions:[{...judgment.propositions[0],evidence:{page:1,quote:"unsupported quote"}}]},gold,"S",output,pages)).toThrow(/not found/);
  });
  it("keeps uncertain judgments out of positive semantic points",()=>{
    const good=scoreAdjudicated(gold,"S",output,pages,judgment);
    const uncertain=scoreAdjudicated(gold,"S",output,pages,{...judgment,propositions:[{...judgment.propositions[0],verdict:"uncertain",uncertainty:"high"}]});
    expect(good.propositionPoints).toBe(3);
    expect(uncertain.propositionPoints).toBe(0);
    expect(uncertain.status).toBe("provisional_blinded_adjudication");
  });
});
