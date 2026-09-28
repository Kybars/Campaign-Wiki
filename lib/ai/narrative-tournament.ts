import { createHash } from "node:crypto";
import { z } from "zod";
import { findVerbatimEvidence } from "./graph-extraction";

export const TOURNAMENT_VERSION = "narrative-dev-2";
export const MODEL_ID = "gpt-6-luna";
export const MAX_DISPATCHES = 50;
export const MAX_ACTUAL_TOKENS = 2_000_000;
export const MODEL_MAX_OUTPUT_TOKENS = 128_000;
// GPT-6 Luna Standard rates with cache-write, >272K-input, and 10% regional uplifts.
export const MIN_CONSERVATIVE_INPUT_USD_PER_MILLION = 0.275;
export const MIN_CONSERVATIVE_OUTPUT_USD_PER_MILLION = 0.825;

export const narrativeOutputSchema = z.object({
  propositions: z.array(z.object({
    id: z.string().min(1), statement: z.string().min(1).max(700),
    modality: z.enum(["established", "attributed_belief", "rumor", "secret", "intention", "conditional", "counterfactual", "uncertain"]),
    subjects: z.array(z.string().min(1)).min(1),
    evidence: z.array(z.object({ page: z.number().int().positive(), quote: z.string().min(3).max(500) }).strict()).min(1).max(2),
  }).strict()).max(250),
  entities: z.array(z.object({
    name: z.string().min(1), type: z.enum(["npc", "location", "deity", "item", "quest", "event", "other", "faction"]),
    presentation: z.enum(["page", "attached", "source_only"]),
    parentOrAttachment: z.string(), existencePage: z.number().int().positive(), existenceQuote: z.string().min(3).max(500),
  }).strict()).max(200),
  relationships: z.array(z.object({
    source: z.string().min(1), label: z.string().min(1), target: z.string().min(1),
    modality: z.enum(["established", "attributed_belief", "rumor", "secret", "intention", "conditional", "counterfactual", "uncertain"]),
    page: z.number().int().positive(), quote: z.string().min(3).max(500),
  }).strict()).max(250),
  sourceDiscrepancies: z.array(z.object({ page: z.number().int().positive(), note: z.string().min(1).max(500) }).strict()).max(30),
}).strict();
export type NarrativeOutput = z.infer<typeof narrativeOutputSchema>;

const contract = `Return only the fixed JSON schema. Use only supplied pages. Give each distinct narrative proposition once, with exact page and short verbatim evidence. Separate established events from beliefs, rumors, plans, conditions and counterfactuals. A secret is GM knowledge, not automatically player-visible. Flag source contradictions. Entity identity, physical parent, and editorial page presentation are separate. A room or item can be attached or source-only while its important revelation is still a proposition. Keep game mechanics in optional reference material, not narrative assertions. Do not invent details or turn possible outcomes into completed history.`;

export const promptVariants = {
  baseline: `Current Claims-2 baseline adapted to this common output schema: Extract explicit, useful facts from the entire supplied source. Include descriptive, identity, status, capability, belief, and location facts as well as actions, even when a fact involves only one known entity. Each claim is one proposition; split independent events or story beats, but preserve a genuinely connected proposition involving multiple entities. The entire statement, including every participant and qualifier, must be supported by cited evidence. Do not infer unsupported lore or repeat paraphrases. ${contract}`,
  narrative_first: `Build a compact campaign encyclopedia. First identify the causal story: important people, places, factions, motives, past events, secrets, clues and possible consequences. Then record the few propositions needed to tell that story accurately. Retain low-profile named entities when the text supports them, while attaching map rooms and minor props to their narrative parent. ${contract}`,
  entity_centered: `Make an identity inventory before writing propositions. For every named person, place, faction and consequential object, resolve aliases conservatively, decide its parent and page presentation, and record independent existence evidence. Then attach source-backed facts and relationships to the resolved identities. Do not merge uncertain identities. ${contract}`,
  relevance_gated: `Treat this as editorial selection for a source-backed wiki. Include a proposition if it explains motivation, history, identity, relationship, clue, revelation or plausible consequence. Omit encounter procedure, routine room inventory and system mechanics from the narrative layer. Keep important facts found in otherwise minor rooms. Give supporting entities a page only when an article would help navigation; otherwise attach or retain as source-only. ${contract}`,
} as const;
export type Variant = keyof typeof promptVariants;

export function sha256(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
export function normalized(value: string) { return value.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim(); }
export function inputIdentity(variant: Variant, sample: string, pages: Array<{ physicalPdfPage: number; text: string }>) {
  const input = JSON.stringify({ version: TOURNAMENT_VERSION, model: MODEL_ID, variant, prompt: promptVariants[variant], schema: z.toJSONSchema(narrativeOutputSchema), sample, pages });
  return { promptHash: sha256(promptVariants[variant]), inputHash: sha256(input), schemaHash: sha256(JSON.stringify(z.toJSONSchema(narrativeOutputSchema))) };
}

export interface GroundingIssue {
  kind: "proposition" | "entity" | "relationship" | "sourceDiscrepancy";
  index: number;
  outputId: string;
  reason: string;
  page: number | null;
  quote: string | null;
}

export function partitionGrounding(output: NarrativeOutput, pages: Array<{ physicalPdfPage: number; text: string }>) {
  const byPage = new Map(pages.map(p => [p.physicalPdfPage, p.text]));
  const issues: GroundingIssue[] = [];
  const rejected = {
    propositions: new Set<number>(), entities: new Set<number>(), relationships: new Set<number>(), sourceDiscrepancies: new Set<number>(),
  };
  const issue = (kind: GroundingIssue["kind"], index: number, outputId: string, reason: string, page: number | null = null, quote: string | null = null) => {
    issues.push({ kind, index, outputId, reason, page, quote });
    if (kind === "sourceDiscrepancy") rejected.sourceDiscrepancies.add(index);
    else if(kind === "entity") rejected.entities.add(index);
    else if(kind === "proposition") rejected.propositions.add(index);
    else rejected.relationships.add(index);
  };
  const check = (kind: GroundingIssue["kind"], index: number, outputId: string, page: number, quote: string) => {
    const source = byPage.get(page);
    if (!source) issue(kind,index,outputId,"page outside selected window",page,quote);
    else if (!findVerbatimEvidence(source,quote)) issue(kind,index,outputId,"quote absent from raw PDF.js page",page,quote);
  };
  const entityNames = output.entities.map(e => normalized(e.name));
  const duplicateNames = new Set(entityNames.filter((name,i) => entityNames.indexOf(name) !== i));
  output.entities.forEach((e,i) => {
    const name = normalized(e.name), parent = normalized(e.parentOrAttachment);
    check("entity",i,e.name,e.existencePage,e.existenceQuote);
    if (duplicateNames.has(name)) issue("entity",i,e.name,"duplicate entity identity",e.existencePage,e.existenceQuote);
    if (e.presentation === "attached" && !parent) issue("entity",i,e.name,"attachment missing",e.existencePage,e.existenceQuote);
    if (parent === name) issue("entity",i,e.name,"self-parent",e.existencePage,e.existenceQuote);
  });
  // Reject descendants of invalid entities. This also catches missing parents and cycles.
  let changed = true;
  while (changed) {
    changed = false;
    const validNames = new Set(output.entities.filter((_,i) => !rejected.entities.has(i)).map(e => normalized(e.name)));
    output.entities.forEach((e,i) => {
      if (rejected.entities.has(i)) return;
      const parent = normalized(e.parentOrAttachment);
      if (parent && !validNames.has(parent)) { issue("entity",i,e.name,"unknown or rejected parent",e.existencePage,e.existenceQuote); changed=true; }
    });
    const remaining = new Map(output.entities.flatMap((e,i) => rejected.entities.has(i) ? [] : [[normalized(e.name), {index:i,parent:normalized(e.parentOrAttachment)}] as const]));
    for (const [name,{index}] of remaining) {
      if (rejected.entities.has(index)) continue;
      const seen = new Set<string>(); let cursor = name;
      while (cursor && remaining.has(cursor) && !seen.has(cursor)) { seen.add(cursor); cursor = remaining.get(cursor)!.parent; }
      if (cursor && seen.has(cursor)) { issue("entity",index,output.entities[index].name,"parent cycle",output.entities[index].existencePage,output.entities[index].existenceQuote); changed=true; }
    }
  }
  const names = new Set(output.entities.filter((_,i) => !rejected.entities.has(i)).map(e => normalized(e.name)));
  const propositionIds = output.propositions.map(p => p.id);
  const duplicateIds = new Set(propositionIds.filter((id,i) => propositionIds.indexOf(id) !== i));
  output.propositions.forEach((p,i) => {
    if (duplicateIds.has(p.id)) issue("proposition",i,p.id,"duplicate proposition ID");
    p.evidence.forEach(e => check("proposition",i,p.id,e.page,e.quote));
    p.subjects.forEach(s => { if (!names.has(normalized(s))) issue("proposition",i,p.id,`unknown or rejected subject: ${s}`); });
  });
  output.relationships.forEach((r,i) => {
    const id = `${r.source} | ${r.label} | ${r.target}`;
    check("relationship",i,id,r.page,r.quote);
    if (!names.has(normalized(r.source)) || !names.has(normalized(r.target))) issue("relationship",i,id,"unknown or rejected endpoint",r.page,r.quote);
  });
  output.sourceDiscrepancies.forEach((d,i) => { if (!byPage.has(d.page)) issue("sourceDiscrepancy",i,`discrepancy:${i}`,"page outside selected window",d.page); });
  const accepted: NarrativeOutput = {
    propositions: output.propositions.filter((_,i) => !rejected.propositions.has(i)),
    entities: output.entities.filter((_,i) => !rejected.entities.has(i)),
    relationships: output.relationships.filter((_,i) => !rejected.relationships.has(i)),
    sourceDiscrepancies: output.sourceDiscrepancies.filter((_,i) => !rejected.sourceDiscrepancies.has(i)),
  };
  const rejectedItemCount = Object.values(rejected).reduce((n,set) => n+set.size,0);
  return { accepted, issues, rejectedItemCount, usable: accepted.propositions.length+accepted.entities.length+accepted.relationships.length>0 };
}

export function validateGrounding(output: NarrativeOutput, pages: Array<{ physicalPdfPage: number; text: string }>) {
  return partitionGrounding(output,pages).issues.map(i => `${i.kind}[${i.index}] ${i.outputId}: ${i.reason}`);
}

export interface BudgetState { dispatches: number; actualInputTokens: number; actualOutputTokens: number; actualTotalTokens: number; unresolvedDispatch: boolean; }
export interface PaidCaps { maxUsd: number; inputUsdPerMillion: number; outputUsdPerMillion: number; }
export function reservePaidDispatch(state: BudgetState, caps: PaidCaps, input: string, requestedOutputTokens: number) {
  if (state.unresolvedDispatch) throw new Error("Unresolved prior dispatch; reconcile usage before continuing");
  if (state.dispatches >= MAX_DISPATCHES) throw new Error("50-dispatch ceiling reached");
  if (![caps.maxUsd, caps.inputUsdPerMillion, caps.outputUsdPerMillion].every(n => Number.isFinite(n) && n > 0)) throw new Error("Positive approved money cap and conservative rates required");
  if (!Number.isSafeInteger(requestedOutputTokens) || requestedOutputTokens <= 0) throw new Error("Positive output allowance required");
  // A byte upper bound plus fixed envelope/schema allowance is intentionally conservative.
  // It is a reservation, not a claim about billed tokenizer counts.
  const inputReserve = Buffer.byteLength(input, "utf8") + 8192;
  const actual = state.actualTotalTokens;
  const totalReservation = inputReserve + requestedOutputTokens;
  if (actual + totalReservation > MAX_ACTUAL_TOKENS) throw new Error("2,000,000-token reservation would be exceeded");
  const moneyReserved = ((state.actualInputTokens + inputReserve) * caps.inputUsdPerMillion + (state.actualOutputTokens + requestedOutputTokens) * caps.outputUsdPerMillion) / 1_000_000;
  if (moneyReserved > caps.maxUsd) throw new Error("Approved money cap reservation would be exceeded");
  return { inputReserve, outputReserve: requestedOutputTokens, totalReservation, moneyReserved };
}

export const reviewSchema = z.object({
  propositions: z.array(z.object({ goldId: z.string(), outputIds: z.array(z.string()), meaning: z.enum(["correct", "partial", "wrong"]), modality: z.boolean(), evidence: z.boolean() }).strict()),
  entities: z.array(z.object({ goldId: z.string(), outputName: z.string(), identity: z.boolean(), presentation: z.boolean(), parent: z.boolean() }).strict()),
  relationships: z.array(z.object({ goldClaimId: z.string(), outputIndex: z.number().int().nonnegative().nullable(), endpoints: z.boolean(), meaning: z.boolean(), evidence: z.boolean() }).strict()),
  negativeChecks: z.array(z.object({ goldId: z.string(), passed: z.boolean() }).strict()),
  unsupportedOutputIds: z.array(z.string()),
}).strict();
export type Review = z.infer<typeof reviewSchema>;
export function scoreReviewed(gold: { claims: Array<{ id: string; importance: number; subjects?: string[] }>; entities: Array<{ id: string }>; negativeChecks: Array<{ id: string }> }, review: Review) {
  const claimById = new Map(gold.claims.map(c => [c.id, c]));
  const relationshipGold = new Set(gold.claims.filter(c => (c.subjects?.length ?? 0) > 1).map(c => c.id));
  const entityIds = new Set(gold.entities.map(e => e.id));
  const negativeIds = new Set(gold.negativeChecks.map(e => e.id));
  const unique = (values: string[]) => { if (new Set(values).size !== values.length) throw new Error("Duplicate review ID"); };
  unique(review.propositions.map(r => r.goldId)); unique(review.entities.map(r => r.goldId)); unique(review.relationships.map(r => r.goldClaimId)); unique(review.negativeChecks.map(r => r.goldId));
  if (review.propositions.some(r => !claimById.has(r.goldId)) || review.entities.some(r => !entityIds.has(r.goldId)) || review.relationships.some(r => !relationshipGold.has(r.goldClaimId)) || review.negativeChecks.some(r => !negativeIds.has(r.goldId))) throw new Error("Unknown gold ID");
  const weightedTotal = gold.claims.reduce((n, c) => n + c.importance, 0);
  const propositionPoints = review.propositions.reduce((n, r) => n + (r.meaning === "correct" && r.modality && r.evidence ? claimById.get(r.goldId)!.importance : r.meaning === "partial" && r.modality && r.evidence ? claimById.get(r.goldId)!.importance * 0.5 : 0), 0);
  const identityPoints = review.entities.filter(r => r.identity).length;
  const presentationPoints = review.entities.filter(r => r.identity && r.presentation && r.parent).length;
  const relationshipPoints = review.relationships.filter(r => r.outputIndex !== null && r.endpoints && r.meaning && r.evidence).length;
  const negativePassed = review.negativeChecks.filter(r => r.passed).length;
  return { propositionPoints, weightedTotal, propositionReviewed: review.propositions.length, propositionTotal: gold.claims.length,
    identityPoints, presentationPoints, entityReviewed: review.entities.length, entityTotal: gold.entities.length,
    relationshipPoints, relationshipReviewed: review.relationships.length, relationshipTotal: relationshipGold.size,
    negativePassed, negativeReviewed: review.negativeChecks.length, negativeTotal: gold.negativeChecks.length,
    unsupportedCount: new Set(review.unsupportedOutputIds).size,
    complete: review.propositions.length === gold.claims.length && review.entities.length === gold.entities.length && review.relationships.length === relationshipGold.size && review.negativeChecks.length === gold.negativeChecks.length };
}
