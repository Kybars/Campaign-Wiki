import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import { z } from "zod";
import { adjudicationSchema } from "../lib/ai/narrative-tournament-evaluation";
import { MODEL_ID, MODEL_MAX_OUTPUT_TOKENS, narrativeOutputSchema, sha256 } from "../lib/ai/narrative-tournament";
import { buildTournamentRequest, parseTournamentAuthorization } from "../lib/ai/narrative-tournament-request";
import type { Operation } from "../lib/ai/narrative-tournament-runner";

function operation(kind:Operation["kind"]):Operation {
  const schemaJson=JSON.stringify(z.toJSONSchema(kind==="extraction"?narrativeOutputSchema:adjudicationSchema));
  return {key:`synthetic:${kind}`,kind,candidateId:"synthetic",sample:"S",prompt:"Read source evidence.",payload:"SOURCE PAGES",schemaJson,schemaHash:sha256(schemaJson),identityHash:"synthetic"};
}

describe("GPT-6 Luna tournament request contract",()=>{
  it.each(["extraction","judge"] as const)("uses Standard GPT-6 Luna structured output for %s",kind=>{
    const request=buildTournamentRequest(operation(kind),MODEL_MAX_OUTPUT_TOKENS);
    expect(request.model).toBe("gpt-6-luna");
    expect(request.model).toBe(MODEL_ID);
    expect(request.reasoning).toEqual({effort:"medium"});
    expect(request.service_tier).toBe("default");
    expect(request.max_output_tokens).toBe(128000);
    expect(request).not.toHaveProperty("tools");
    expect(request.text.format.type).toBe("json_schema");
    expect(request.text.format.strict).toBe(true);
    expect(request.text.format.schema).toBeTruthy();
  });
  it("permits dynamic allowances above 20,000 and rejects allowances beyond the verified limit",()=>{
    expect(buildTournamentRequest(operation("extraction"),30000).max_output_tokens).toBe(30000);
    expect(()=>buildTournamentRequest(operation("extraction"),128001)).toThrow(/verified model maximum/);
  });
  it("binds paid authorization to GPT-6 Luna, Standard processing and conservative rates",()=>{
    const authorized={approvalPhrase:"I approve the paid narrative tournament",scope:"full_tournament",planHash:"synthetic-plan",model:"gpt-6-luna",reasoningEffort:"medium",serviceTier:"default",maxUsd:1.65,inputUsdPerMillion:0.275,outputUsdPerMillion:0.825,modelMaxOutputTokens:128000,maxRequests:50,maxTotalTokens:2000000,userApprovalReference:"synthetic test only"};
    expect(parseTournamentAuthorization(authorized,"synthetic-plan").model).toBe("gpt-6-luna");
    expect(()=>parseTournamentAuthorization({...authorized,model:"gpt-5.6-luna"},"synthetic-plan")).toThrow();
    expect(()=>parseTournamentAuthorization({...authorized,serviceTier:"fast"},"synthetic-plan")).toThrow();
    expect(()=>parseTournamentAuthorization({...authorized,inputUsdPerMillion:0.25},"synthetic-plan")).toThrow(/rates below/);
    expect(()=>parseTournamentAuthorization({...authorized,outputUsdPerMillion:0.75},"synthetic-plan")).toThrow(/rates below/);
    expect(()=>parseTournamentAuthorization(authorized,"different-plan")).toThrow(/plan hash/);
    expect(()=>parseTournamentAuthorization(authorized,"synthetic-plan","acceptance_only")).toThrow(/scope/);
    const acceptance={...authorized,scope:"acceptance_only",approvalPhrase:"I approve the paid narrative acceptance test"};
    expect(parseTournamentAuthorization(acceptance,"synthetic-plan","acceptance_only").scope).toBe("acceptance_only");
    expect(()=>parseTournamentAuthorization(acceptance,"synthetic-plan")).toThrow(/scope/);
  });
  it.each(["extraction","judge"] as const)("serializes the %s request through the installed SDK without network access",async kind=>{
    let sent:Record<string,unknown>|null=null;
    const client=new OpenAI({apiKey:"offline-test-key",maxRetries:0,fetch:async(_url,init)=>{
      sent=JSON.parse(String(init?.body)) as Record<string,unknown>;
      return new Response(JSON.stringify({id:"resp_offline",object:"response",status:"completed",output:[],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}),{status:200,headers:{"content-type":"application/json"}});
    }});
    await client.responses.create(buildTournamentRequest(operation(kind),30000));
    expect(sent).toMatchObject({model:"gpt-6-luna",reasoning:{effort:"medium"},service_tier:"default",max_output_tokens:30000,text:{format:{type:"json_schema",strict:true}}});
    expect(sent).not.toHaveProperty("tools");
  });
});
