import { describe, expect, it } from "vitest";
import type { Claims41Output, Claims41Request } from "../lib/ai/claims-4-1-experiment";
import { reconcileClaims41V222 } from "../lib/ai/claims-4-1-reconciliation-v2-2-2";
import { CLAIMS_4_1_RECONCILIATION_V2_2_3_VERSION, reconcileClaims41V223 } from "../lib/ai/claims-4-1-reconciliation-v2-2-3";

function fixture(texts: string[], names: string[] = []): Claims41Request {
  return { requestId: "synthetic-v223", baselineRequestId: "synthetic", inputDifferences: [],
    entities: names.map(name=>({canonicalId:`e:${name}`,name,type:"npc",aliases:[]})),
    evidenceUnits: texts.map((text,order)=>({unitId:`u${order}`,segmentId:"block",page:1,context:"section",kind:"sentence",order,text,
      rawSource:{page:1,start:order*300,end:order*300+text.length,text}})) };
}
const proposal = (statement:string,participants:string[],index=0)=>({statement,participants,evidence_unit_ids:[`u${index}`]});
const run = (request:Claims41Request,claims:Claims41Output["claims"])=>reconcileClaims41V223({claims},request);

describe("Claims-4.1 Reconciliation v2.2.3 targeted corrective invariants",()=>{
  it.each(["After the battle, Arlen returned as a wraith.","Later, Arlen became a wraith."])("anchors a transition subject after a leading adjunct: %s",statement=>{
    const result=run(fixture([statement,"The wraith haunts the coast."],["Arlen"]),[proposal(statement,["Arlen","wraith"])]);
    expect(result.version).toBe(CLAIMS_4_1_RECONCILIATION_V2_2_3_VERSION);
    expect(result.claims[0].identityRelations).toEqual([expect.objectContaining({kind:"identity_transition",fromEntityId:"e:Arlen",sourceClaimIndex:0})]);
    expect(result.candidateEntities.map(e=>e.name)).toEqual(["wraith"]);
  });
  it("chooses the final participant span nearest the marker",()=>{
    const statement="Arlen met Mira, and Mira became the Ash Queen.";
    const result=run(fixture(["Mira became the Ash Queen."],["Arlen","Mira"]),[proposal(statement,["Arlen","Mira","Ash Queen"])]);
    expect(result.claims[0].identityRelations[0]).toMatchObject({fromEntityId:"e:Mira"});
  });
  it("anchors pure alias subjects without inventing a second entity",()=>{
    const statement="After the battle, Arlen was also called Ember.";
    const result=run(fixture([statement],["Arlen"]),[proposal(statement,["Arlen","Ember"])]);
    expect(result.claims[0].identityRelations[0]).toMatchObject({kind:"same_identity_alias",entityId:"e:Arlen"});
    expect(result.candidateEntities).toEqual([]);
  });
  it.each(["She became the Ash Queen.","The scholar became the Ash Queen."])("aligns a directly cited anaphor without context: %s",source=>{
    const result=run(fixture([source],["Arlen"]),[proposal("Arlen became the Ash Queen.",["Arlen","Ash Queen"])]);
    expect(result.claims[0].identityRelations).toHaveLength(1);
    expect(result.claims[0].contextEvidence).toEqual([]);
  });
  it.each(["She was also called Ember.","The scholar was also called Ember."])("aligns an alias anaphor: %s",source=>{
    const result=run(fixture([source],["Arlen"]),[proposal("Arlen was also called Ember.",["Arlen","Ember"])]);
    expect(result.claims[0].identityRelations[0]).toMatchObject({kind:"same_identity_alias",entityId:"e:Arlen"});
  });
  it("records bounded confirming context and remains proposal-order independent",()=>{
    const request=fixture(["Arlen was a scholar.","The scholar became a wraith.","The wraith haunts the coast."],["Arlen"]);
    const result=run(request,[proposal("The wraith haunts the coast.",["wraith"],2),proposal("Arlen became a wraith.",["Arlen","wraith"],1)]);
    expect(result.claims[0].participants[0].kind).toBe("candidate_entity");
    expect(result.claims[1].contextEvidence.map(e=>e.unitId)).toEqual(["u0"]);
    expect(result.claims[0].identityRelations[0].sourceClaimIndex).toBe(1);
  });
  it.each(["Mira became the Ash Queen.","The Ash Mage became the Ash Queen."])("rejects a different proper source subject: %s",source=>{
    const result=run(fixture([source],["Arlen","Mira","Ash Mage"]),[proposal("Arlen became the Ash Queen.",["Arlen","Ash Queen"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
  });
  it.each(["Mira entered the crypt.","Mira was a scholar."])("rejects conflicting bounded source reference: %s",context=>{
    const source=context.includes("scholar")?"The scholar became the Ash Queen.":"She became the Ash Queen.";
    const result=run(fixture([context,source],["Arlen","Mira"]),[proposal("Arlen became the Ash Queen.",["Arlen","Ash Queen"],1)]);
    expect(result.claims[0].identityRelations).toEqual([]);
  });
  it("does not manufacture an ungrounded identity subject",()=>{
    const result=run(fixture(["She became the Ash Queen."]),[proposal("Arlen became the Ash Queen.",["Arlen","Ash Queen"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
    expect(result.candidateEntities.some(e=>e.name==="Arlen")).toBe(false);
  });
  it("rejects a conflicting proper antecedent absent from the supplied inventory",()=>{
    const result=run(fixture(["Mira entered the crypt.","She became the Ash Queen."],["Arlen"]),[proposal("Arlen became the Ash Queen.",["Arlen","Ash Queen"],1)]);
    expect(result.claims[0].identityRelations).toEqual([]);
    expect(result.candidateEntities.some(e=>e.name==="Mira")).toBe(false);
  });
  it("does not remove a classifying qualifier from the source identity subject",()=>{
    const result=run(fixture(["Native Kestari became the Ash Queen."],["Kestari"]),[proposal("Kestari became the Ash Queen.",["Kestari","Ash Queen"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
  });
  it("retains the strict parser when participant anchoring is not unique",()=>{
    const result=run(fixture(["After the battle, Arlen became a wraith.","The wraith arrived."],["Arlen"]),[proposal("After the battle, Arlen became a wraith.",["Arlen","ARLEN","wraith"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
  });
  it("retains exact canonical alias subject equivalence",()=>{
    const request=fixture(["Ember became the Ash Queen."],["Arlen"]);
    request.entities[0].aliases=["Ember"];
    expect(run(request,[proposal("Arlen became the Ash Queen.",["Arlen","Ash Queen"])]).claims[0].identityRelations).toHaveLength(1);
  });
  it("requires a unique participant anchor for context-free anaphor alignment",()=>{
    const result=run(fixture(["She became the Ash Queen."],["Arlen"]),[proposal("Arlen became the Ash Queen.",["Arlen","ARLEN","Ash Queen"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
  });
  it("requires identical relation kind and endpoint in directly cited evidence",()=>{
    const request=fixture(["She was called the Ash Queen.","She became the Silver King."],["Arlen"]);
    const result=run(request,[proposal("Arlen became the Ash Queen.",["Arlen","Ash Queen"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
  });
  it("retains endpoint persistence rules",()=>{
    const result=run(fixture(["She became a wraith."],["Arlen"]),[proposal("Arlen became a wraith.",["Arlen","wraith"])]);
    expect(result.claims[0].identityRelations).toEqual([]);
    expect(result.claims[0].participants[1].kind).toBe("unresolved");
  });

  it.each(["Mira's student arrived.","students of Mira hurried away.","Mira students hurried away.","Mira and his students hurried away.","Mira and her students hurried away.","Mira and their students hurried away.","Mira and its students hurried away."])("matches explicit descriptor surface forms: %s",source=>{
    const result=run(fixture([source],["Mira"]),[proposal("Mira students departed.",["Mira students"])]);
    expect(result.claims[0].participants[0]).toMatchObject({kind:"descriptor",canonicalId:"e:Mira"});
  });
  it.each(["army","fleet","agents","priests","nobles","envoy","clergy","siege engines"])("accepts unambiguous noun prefix without restricting its predicate: %s",role=>{
    const text=`Mira ${role} assembled beside the harbor.`;
    expect(run(fixture([text],["Mira"]),[proposal(text,[`Mira ${role}`])]).claims[0].participants[0].kind).toBe("descriptor");
  });
  it.each(["Mira guards the gate.","Mira forces the door open.","Mira forces doors."])("does not mistake a verb for a descriptor: %s",text=>{
    const mention=text.startsWith("Mira guards")?"Mira guards":"Mira forces";
    expect(run(fixture([text],["Mira"]),[proposal(text,[mention])]).claims[0].participants[0].kind).toBe("unresolved");
  });
  it.each(["Mira's guards assembled.","guards of Mira assembled.","The Mira guards assembled.","Mira guards are assembling."])("requires grammatical noun evidence for guards: %s",source=>{
    expect(run(fixture([source],["Mira"]),[proposal("Mira guards assembled.",["Mira guards"])]).claims[0].participants[0].kind).toBe("descriptor");
  });
  it("does not attach an entity's determiner to a following verb",()=>{
    const text="The Regent guards the gate.";
    expect(run(fixture([text],["Regent"]),[proposal(text,["Regent guards"])]).claims[0].participants[0].kind).toBe("unresolved");
  });
  it("supports a determined noun phrase with a finite base predicate",()=>{
    const text="The Mira guards patrol the coast.";
    expect(run(fixture([text],["Mira"]),[proposal(text,["Mira guards"])]).claims[0].participants[0].kind).toBe("descriptor");
  });
  it("uses bounded ordinal continuation and only the proving context",()=>{
    const request=fixture(["The Second Veloran army assembled.","Rain fell.","The second army advanced."],["Velora"]);
    const result=run(request,[proposal("The Second Veloran army advanced.",["Second Veloran army"],2)]);
    expect(result.claims[0].participants[0]).toMatchObject({kind:"descriptor",canonicalId:"e:Velora"});
    expect(result.claims[0].contextEvidence.map(e=>e.unitId)).toEqual(["u0"]);
    expect(result.claims[0].participants[0].supportingEvidence[0].direct).toBe(false);
  });
  it.each([{context:"Mira and his students departed.",direct:"His students arrived.",mention:"Mira students"},
    {context:"Priests of Mira assembled.",direct:"The priests departed.",mention:"Mira priests"}])("uses explicit shorthand continuation: %j",({context,direct,mention})=>{
    const result=run(fixture([context,direct],["Mira"]),[proposal("The group departed.",[mention],1)]);
    expect(result.claims[0].participants[0].kind).toBe("descriptor");
    expect(result.claims[0].contextEvidence.map(e=>e.unitId)).toEqual(["u0"]);
  });
  it("rejects ambiguous descriptor parents",()=>{
    const result=run(fixture(["Priests of Mira and priests of Arlen gathered.","The priests departed."],["Mira","Arlen"]),[proposal("The priests departed.",["the priests"],1)]);
    expect(result.claims[0].participants[0].kind).toBe("unresolved");
  });
  it.each(["different section","outside window"])("does not exceed descriptor context: %s",boundary=>{
    const request=fixture(["Mira's students arrived.","Rain fell.","Snow fell.","His students left."],["Mira"]);
    if(boundary==="different section") request.evidenceUnits[0].context="elsewhere";
    const result=run(request,[proposal("Mira students left.",["Mira students"],3)]);
    expect(result.claims[0].participants[0].kind).toBe("unresolved");
    expect(result.claims[0].contextEvidence).toEqual([]);
  });
  it.each(["native","local","several","many","some","captured","ordinary","generic"])("classifies solely classifying capitalized collectives: %s",modifier=>{
    const text=`The ${modifier} Kestari arrived.`;
    const result=run(fixture([text]),[proposal(text,["Kestari"])]);
    expect(result.claims[0].participants[0].kind).toBe("generic_non_entity");
    expect(result.candidateEntities).toEqual([]);
  });
  it("does not classify an independently named referent as generic",()=>{
    const result=run(fixture(["Native Kestari arrived.","Kestari entered the citadel."]),[proposal("Kestari entered the citadel.",["Kestari"],1)]);
    expect(result.claims[0].participants[0].kind).toBe("candidate_entity");
  });
  it("classifies the full capitalized collective participant phrase",()=>{
    const text="Native Kestari arrived.";
    expect(run(fixture([text]),[proposal(text,["native Kestari"])]).claims[0].participants[0].kind).toBe("generic_non_entity");
  });
  it.each(["the army","an army","the forces"])("does not attach bare ambiguous groups to nearby factions: %s",mention=>{
    const result=run(fixture(["Mira entered the citadel.",`${mention} advanced.`],["Mira"]),[proposal(`${mention} advanced.`,[mention],1)]);
    expect(result.claims[0].entityAssociations).toEqual([]);
    expect(["generic_non_entity","unresolved"]).toContain(result.claims[0].participants[0].kind);
  });

  it.each(["Arlen entered the chamber.","Arlen, a scholar, entered the chamber.","The river was home to Arlen, a nymph."])("adds known participant pronoun provenance: %s",context=>{
    const result=run(fixture([context,"She opened the chest."],["Arlen"]),[proposal("Arlen opened the chest.",["Arlen"],1)]);
    expect(result.claims[0].participants[0]).toMatchObject({kind:"canonical_entity",canonicalId:"e:Arlen"});
    expect(result.claims[0].contextEvidence.map(e=>e.unitId)).toEqual(["u0"]);
    expect(result.claims[0].directEvidence.map(e=>e.unitId)).toEqual(["u1"]);
  });
  it("adds candidate participant provenance without changing resolution",()=>{
    const result=run(fixture(["Arlen, a scholar, entered the chamber.","She opened the chest."]),[proposal("Arlen opened the chest.",["Arlen"],1)]);
    expect(result.claims[0].participants[0].kind).toBe("candidate_entity");
    expect(result.claims[0].contextEvidence.map(e=>e.unitId)).toEqual(["u0"]);
  });
  it.each(["Arlen entered with Mira.","The tablet records the name Arlen.","The tablet lists Arlen, Mira.","The tablet says \"Arlen\"."])("rejects competing or nonreferential provenance: %s",context=>{
    const result=run(fixture([context,"She opened the chest."],["Arlen","Mira"]),[proposal("Arlen opened the chest.",["Arlen"],1)]);
    expect(result.claims[0].contextEvidence).toEqual([]);
  });
  it.each(["Arlen, a dragon, rested.","Arlen was a dragon."])("requires explicit definite-description type evidence: %s",context=>{
    const result=run(fixture([context,"The dragon opened the chest."],["Arlen"]),[proposal("Arlen opened the chest.",["Arlen"],1)]);
    expect(result.claims[0].contextEvidence.map(e=>e.unitId)).toEqual(["u0"]);
  });
  it("does not guess definite-description types",()=>{
    const result=run(fixture(["Arlen entered the chamber.","The dragon opened the chest."],["Arlen"]),[proposal("Arlen opened the chest.",["Arlen"],1)]);
    expect(result.claims[0].contextEvidence).toEqual([]);
  });
  it("uses the nearest relevant clause, retaining only its evidence",()=>{
    const result=run(fixture(["Mira entered the chamber.","Arlen, a scholar, arrived.","She opened the chest."],["Arlen","Mira"]),[proposal("Arlen opened the chest.",["Arlen"],2)]);
    expect(result.claims[0].contextEvidence.map(e=>e.unitId)).toEqual(["u1"]);
  });
  it("does not bypass a nearer competing antecedent using an older unit",()=>{
    const result=run(fixture(["Arlen entered the chamber.","Mira arrived.","She opened the chest."],["Arlen"]),[proposal("Arlen opened the chest.",["Arlen"],2)]);
    expect(result.claims[0].contextEvidence).toEqual([]);
  });
  it("does not bypass a nearer joint subject using an older antecedent",()=>{
    const result=run(fixture(["Arlen entered the chamber.","Arlen and Mira entered the crypt.","She opened the chest."],["Arlen","Mira"]),[proposal("Arlen opened the chest.",["Arlen"],2)]);
    expect(result.claims[0].contextEvidence).toEqual([]);
  });
  it("permits a continuing page break with unchanged structural context",()=>{
    const request=fixture(["Arlen, a scholar, arrived.","She opened the chest."],["Arlen"]);
    request.evidenceUnits[1].page=2;request.evidenceUnits[1].rawSource.page=2;
    expect(run(request,[proposal("Arlen opened the chest.",["Arlen"],1)]).claims[0].contextEvidence.map(e=>e.unitId)).toEqual(["u0"]);
  });
  it("keeps resolved-participant provenance bounded across structural sections",()=>{
    const request=fixture(["Arlen, a scholar, entered.","She opened the chest."],["Arlen"]);
    request.evidenceUnits[0].context="elsewhere";
    expect(run(request,[proposal("Arlen opened the chest.",["Arlen"],1)]).claims[0].contextEvidence).toEqual([]);
  });

  it("flags a local lexical substitution despite different outer wording, without contaminating shared evidence",()=>{
    const source="Long ago the guild honored Mira beside the bronze shrine during winter. Mira arrived.";
    const result=run(fixture([source],["Arlen","Mira"]),[
      proposal("Yesterday the guild honored Arlen beside the bronze shrine before sunrise.",["Arlen"]),
      proposal("Mira arrived.",["Mira"])]);
    expect(result.claims[0].reviewReasons).toContain("source_discrepancy");
    expect(result.claims[1].reviewReasons).not.toContain("source_discrepancy");
  });
  it("rejects multiple source substitutions sharing the lexical window",()=>{
    const result=run(fixture(["The guild honored Mira beside the bronze shrine. The guild honored Nara beside the bronze shrine."],["Arlen","Mira","Nara"]),
      [proposal("The guild honored Arlen beside the bronze shrine.",["Arlen"])]);
    expect(result.claims[0].reviewReasons).not.toContain("source_discrepancy");
  });
  it("accepts an exactly five-token substitution with three content words",()=>{
    const result=run(fixture(["Priests praised Mira beside shrines."],["Arlen","Mira"]),[proposal("Priests praised Arlen beside shrines.",["Arlen"])]);
    expect(result.claims[0].reviewReasons).toContain("source_discrepancy");
  });
  it("requires lexical context on both sides of the entity",()=>{
    const result=run(fixture(["Mira guarded several bronze shrines yesterday."],["Arlen","Mira"]),[proposal("Arlen guarded several bronze shrines yesterday.",["Arlen"])]);
    expect(result.claims[0].reviewReasons).not.toContain("source_discrepancy");
  });
  it("does not count articles and prepositions as the three nontrivial tokens",()=>{
    const result=run(fixture(["The priests with Mira in the shrine."],["Arlen","Mira"]),[proposal("The priests with Arlen in the shrine.",["Arlen"])]);
    expect(result.claims[0].reviewReasons).not.toContain("source_discrepancy");
  });
  it.each(["Mira entered.","The guild saw Mira."])("rejects insufficient lexical windows: %s",source=>{
    const result=run(fixture([source],["Arlen","Mira"]),[proposal(source.replace("Mira","Arlen"),["Arlen"])]);
    expect(result.claims[0].reviewReasons).not.toContain("source_discrepancy");
  });
  it("does not flag an entity already at the matching proposition position",()=>{
    const text="The guild honored Arlen beside the bronze shrine. The guild honored Mira beside the bronze shrine.";
    expect(run(fixture([text],["Arlen","Mira"]),[proposal("The guild honored Arlen beside the bronze shrine.",["Arlen"])]).claims[0].reviewReasons).not.toContain("source_discrepancy");
  });
  it("normalizes punctuation, apostrophes and entity-adjacent articles",()=>{
    const request=fixture(["The guild honored the Ash Queen beside Arlen’s bronze shrine."],["Mira","Ash Queen"]);
    const result=run(request,[proposal("The guild honored Mira beside Arlen's bronze shrine.",["Mira"])]);
    expect(result.claims[0].reviewReasons).toContain("source_discrepancy");
  });
  it("does not treat legitimate transition endpoints as substitutions",()=>{
    const statement="Arlen became the Ash Queen.";
    expect(run(fixture([statement],["Arlen"]),[proposal(statement,["Arlen","Ash Queen"])]).claims[0].reviewReasons).not.toContain("source_discrepancy");
  });
  it("retains explicit-negation discrepancy detection",()=>{
    expect(run(fixture(["Arlen is not a scholar."],["Arlen"]),[proposal("Arlen is a scholar.",["Arlen"])]).claims[0].reviewReasons).toContain("source_discrepancy");
  });

  it.each([
    "A successful DC 15 Dexterity check picks the lock.",
    "A successful DC 20 Strength check forces the door open.",
    "A successful DC 15 Dexterity check opens the door.",
    "Climbing the wall requires a successful DC 15 Athletics check.",
    "A creature must succeed on a DC 13 Constitution save or become blinded for 1 minute.",
    "A creature must succeed on a DC 13 Constitution save or take 2d6 poison damage.",
    "When reduced to 20 hit points, the creature flees to another combat area.",
    "The doors have AC 17, 27 hit points, and immunity to poison.",
    "The creature has resistance to fire and vulnerability to cold.",
    "Repeat the DC 13 Constitution save each turn.",
    "The creature makes two attacks each turn.",
    "The creature deals 2d6 fire damage.",
    "When the creature is frightened, it retreats.",
  ])("keeps pure access/save/stat/threshold mechanics out of GM Review: %s",statement=>{
    const result=run(fixture([statement],["Heroes / Party"]),[proposal(statement,["Heroes / Party"])]);
    expect(result.claims[0].wikiDisposition).toBe("mechanical_only");
    expect(result.claims[0].entityAssociations).toEqual([]);
    expect(result.gmReview).toEqual([]);
  });
  it.each([
    "A successful Perception check reveals a secret door leading to the archive.",
    "A successful Perception check finds the lost ring beneath the robes.",
    "A successful Perception check reveals the king's name carved beneath the niche.",
    "The door is locked and has AC 17 and 20 hit points.",
    "Climbing the wall built by Arlen requires a successful DC 15 Athletics check.",
    "The creature fled the city after the king died.",
  ])("preserves mixed/world propositions unchanged: %s",statement=>{
    const original=proposal(statement,["door"]);
    const result=run(fixture([statement]),[original]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].wikiDisposition).toBe("present");
    expect(result.claims[0].original).toEqual(original);
  });
  it("keeps canonical locks and raw proposals/inventory byte-for-byte immutable",()=>{
    const request=fixture(["Mira's students entered.","Arlen became the Ash Queen."],["Mira","Mira students","Arlen"]);
    const claims=[proposal("Mira students entered.",["Mira students"]),proposal("Arlen became the Ash Queen.",["Arlen","Ash Queen"],1)];
    const before=JSON.stringify({request,claims});
    const result=run(request,claims);
    expect(result.claims[0].participants[0]).toMatchObject({kind:"canonical_entity",canonicalId:"e:Mira students"});
    expect(JSON.stringify({request,claims})).toBe(before);
    expect(JSON.stringify(result.rawProposals)).toBe(JSON.stringify({claims}));
    expect(result.claims.map(c=>c.original)).toEqual(claims);
    expect(result.claims).toHaveLength(claims.length);
    expect(result.candidateEntities.every(e=>e.origin==="reconciliation_candidate")).toBe(true);
  });
  it("preserves ordinary unresolved coreference behavior",()=>{
    const request=fixture(["Arlen was a dragon.","The dragon opened the chest."],["Arlen"]);
    const claims=[proposal("The dragon opened the chest.",["the dragon"],1)];
    const result=run(request,claims),old=reconcileClaims41V222({claims},request);
    expect(result.claims[0].participants).toEqual(old.claims[0].participants);
    expect(result.claims[0].contextEvidence).toEqual(old.claims[0].contextEvidence);
  });
  it("preserves Timeline and source-status behavior",()=>{
    const request=fixture(["November *", "Arlen plans to enter the citadel.","Mira captures the citadel.","The GM should award treasure."],["Arlen","Mira"]);
    request.evidenceUnits[0].kind="heading";
    request.evidenceUnits.forEach(u=>u.context="full_campaign_timeline_assuming_heroes_succeed");
    request.evidenceUnits[2].context="what_if_they_do_nothing";
    const claims=[proposal(request.evidenceUnits[1].text,["Arlen"],1),proposal(request.evidenceUnits[2].text,["Mira"],2),proposal(request.evidenceUnits[3].text,[],3)];
    const result=run(request,claims),old=reconcileClaims41V222({claims},request);
    expect(result.claims.map(c=>({timeline:c.timelineAssociation,status:c.sourceStatus}))).toEqual(old.claims.map(c=>({timeline:c.timelineAssociation,status:c.sourceStatus})));
  });
});
