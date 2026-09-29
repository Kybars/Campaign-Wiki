import { createHash } from "node:crypto";
import { z } from "zod";
import type { Claims3Request } from "./claims-3-experiment";
import { cleanSectionHeading, HEROES_ID } from "./claims-3-experiment";
import type { EvidenceUnit } from "./claims-2-experiment";
import { normalizeName } from "../graph/normalize";
import { modelInputHash, semanticInputHash, type AIOperationIdentity } from "./operation-checkpoint";

export const CLAIMS_4_1_BEHAVIOR_VERSION = "claims-4-1-experiment-1";
export const CLAIMS_4_1_SCHEMA_VERSION = 1;
export const CLAIMS_4_1_PROMPT = `Extract every useful, explicit, source-supported proposition from the ENTIRE supplied source. Prioritize complete information coverage, not narrative summarization.

**One independently useful fact is the default claim unit.** Split independent actions, properties, relationships, discoveries, objectives, consequences and story developments into separate short claims—even when they appear in the same sentence, paragraph, timeline entry or encounter. Prefer more small claims with fewer materially involved participants over fewer broad claims with many participants. Do not compress several facts into a narrative summary.

Preserve a cause, condition, exception, negation, timing or attribution within a claim when removing it would change that proposition’s meaning. Preserve rumors as rumors, intentions as intentions, and possible or scheduled events as such. A scenario’s governing context may be carried separately in SOURCE CONTEXT, but a claim must not imply that an unplayed event has occurred.

Extract useful details even if they appear only once, concern one participant, seem minor, or occur in a passage already represented by another claim. Include identities, motives, secrets, locations, capabilities, relationships, clues, obstacles, encounter conditions, consequences, rewards and consequential rules. Check each supplied passage for independently useful facts you have not yet represented.

List only the participants materially involved in EACH individual claim. A participant mentioned nearby is not automatically involved. Preserve source-grounded names missing from KNOWN ENTITIES; resolution happens later. References to the player-character collective—including “the characters,” “the heroes,” “the adventurers,” “the party” and clear equivalent references—use the canonical name “Heroes / Party.” Do not confuse this collective with in-world adventurers, generic creatures, the GM, or a monster’s game-mechanical “hero role.”

Cite one direct evidence unit by default. Use additional units only when needed to support the proposition or resolve a continuation. Headings and nearby text may supply interpretive context but are not direct proof. Every asserted fact and qualifier must be supported. Preserve surprising source wording rather than silently correcting it.

Return only the fixed candidate-claim schema.`;

export const claims41OutputSchema = z.object({ claims: z.array(z.object({
  statement: z.string().trim().min(1).max(900),
  participants: z.array(z.string().trim().min(1).max(200)).max(24),
  evidence_unit_ids: z.array(z.string().trim().min(1).max(50)).min(1).max(5),
}).strict()).max(400) }).strict();
export type Claims41Output = z.infer<typeof claims41OutputSchema>;
export interface Claims41Request extends Claims3Request { inputDifferences: string[] }
export type Claims41Status = "ready" | "pending_identity" | "pending_evidence" | "pending_source_status" | "pending_gm_review";
export type SourceStatus = "established" | "rumor" | "plan" | "scheduled" | "conditional" | "gm_instruction" | "unclear";
export interface Claims41Claim {
  requestId: string; proposalIndex: number; original: Claims41Output["claims"][number];
  state: Claims41Status; reasons: string[]; sourceStatus: SourceStatus;
  participants: Array<{ name: string; canonicalId: string | null; diagnostic: string | null }>;
  evidence: Array<{ unitId: string; page: number; start: number; end: number; text: string; direct: boolean }>;
  context: string | null; sectionHeading?: string; sourceOrder: number | null;
  duplicateProposalIndexes: number[];
  evidenceValidity: "valid" | "pending"; participantResolution: "resolved" | "pending";
  sourceStatusDecision: "qualified" | "pending"; reviewSignals: string[];
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export const claims41PromptHash = () => sha(CLAIMS_4_1_PROMPT);
export const claims41SchemaHash = () => sha(JSON.stringify(z.toJSONSchema(claims41OutputSchema)));

export function planClaims41Request(base: Claims3Request): Claims41Request {
  const evidenceUnits = base.evidenceUnits.map((unit) => ({ ...unit, rawSource: { ...unit.rawSource } }));
  let inheritedTimeline = false;
  for (const unit of evidenceUnits) {
    if (/^Timeline for the War$/iu.test(unit.text)) inheritedTimeline = true;
    if (unit.context === "what_if_they_do_nothing") inheritedTimeline = false;
    if (inheritedTimeline && unit.context === "main") unit.context = "full_campaign_timeline_assuming_heroes_succeed";
  }
  const entities = base.entities.map((entity) => entity.canonicalId === HEROES_ID ? { ...entity, aliases: [
    "Heroes", "the heroes", "the party", "party", "characters", "the characters", "adventurers", "the adventurers", "PCs", "player characters", "the player characters", "adventuring party",
  ] } : entity);
  return { ...base, requestId: base.requestId.replace("claims3", "claims4-1"), entities, evidenceUnits,
    inputDifferences: ["Claims-4.1 changes prompt, schema, and output cap; frozen raw spans, unit IDs, offsets, request boundary, and Claims-3 deterministic context are retained.",
      "Claims-4.1 explicitly allows source participants missing from the inventory and supplies adjacent sentence context for interpretation separately from direct citation.",
      "The WotBS success-assuming full-campaign timeline heading is inherited deterministically until the separate no-heroes context begins."] };
}

export function serializeClaims41Request(request: Claims41Request) {
  const entities = request.entities.map((entity) => `${entity.canonicalId} | ${entity.name} | ${entity.type}${entity.aliases.length ? ` | ${entity.aliases.join(", ")}` : ""}`).join("\n");
  let lastContext = "";
  const source = request.evidenceUnits.map((unit, index) => {
    const context = cleanSectionHeading(unit.context) ?? unit.context;
    const header = context === lastContext ? "" : `SOURCE CONTEXT (interpretive, not evidence): ${context}\n`;
    lastContext = context;
    const previous = request.evidenceUnits[index - 1];
    const continuation = previous && previous.page !== unit.page && previous.context === unit.context ? " [PAGE CONTINUATION]" : "";
    return `${header}[${unit.unitId} @ PDF ${unit.page}]${unit.kind === "heading" ? " HEADING" : ""}${continuation}: ${unit.text}`;
  }).join("\n");
  return { entities, source, payload: `KNOWN ENTITIES (non-exhaustive)\n${entities}\n\nSOURCE\n${source}` };
}

export function claims41TokenDiagnostics(request: Claims41Request) {
  const { entities, source } = serializeClaims41Request(request);
  const characters = { source: source.length, entity: entities.length, prompt: CLAIMS_4_1_PROMPT.length, schema: JSON.stringify(z.toJSONSchema(claims41OutputSchema)).length };
  const estimatedTokens = Object.fromEntries(Object.entries(characters).map(([key, length]) => [key, Math.ceil(length / 4)])) as Record<keyof typeof characters, number>;
  return { characters, estimatedTokens: { ...estimatedTokens, totalInput: Object.values(estimatedTokens).reduce((a, b) => a + b, 0) } };
}

const terms = (text: string) => new Set((text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((word) => !new Set(["that", "this", "with", "from", "have", "their", "they", "them", "when", "where", "will", "would", "could", "into", "about", "there", "which", "were", "been", "because", "after", "before", "heroes", "party"]).has(word)));
function evidenceOverlap(statement: string, units: EvidenceUnit[]) {
  const claimTerms = terms(statement);
  const sourceTerms = terms(units.map((unit) => unit.text).join(" "));
  if (!claimTerms.size) return 0;
  return [...claimTerms].filter((word) => sourceTerms.has(word)).length / claimTerms.size;
}
function resolveParticipant(request: Claims41Request, name: string, units: EvidenceUnit[]) {
  const normalized = normalizeName(name);
  const evidenceText = units.map((unit) => unit.text).join(" ");
  const partyNames = new Set(["heroes / party", "heroes", "the heroes", "party", "the party", "characters", "the characters", "adventurers", "the adventurers", "pcs", "player characters", "the player characters", "adventuring party"]);
  if (partyNames.has(normalized)) {
    if (/\bhero role\b/iu.test(evidenceText) && /hero/iu.test(normalized)) return { name, canonicalId: null, diagnostic: "game_role_not_party" };
    if (/\b(?:thousands|hundreds|dozens) of (?:in-world )?(?:heroes|adventurers|characters)\b|\b(?:npc|monster|creature|villager) (?:party|heroes|adventurers)\b/iu.test(evidenceText))
      return { name, canonicalId: null, diagnostic: "in_world_collective_not_party" };
    const form = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const appears = normalized === "heroes / party" ? /\b(?:the characters|the heroes|the adventurers|the party|player characters|pcs)\b/iu.test(evidenceText)
      : new RegExp(`\\b${form}\\b`, "iu").test(evidenceText);
    const pcCue = /\b(?:player characters|pcs|the characters|the party|the heroes|the adventurers|adventuring party)\b/iu.test(evidenceText);
    const adventureAction = /^Characters\b/u.test(evidenceText) || /^(?:adventurers|heroes)\s+(?:find|discover|meet|enter|leave|travel|fight|defeat|learn|receive|can|must|may)\b/iu.test(evidenceText);
    const inheritedPartyContext = /what_if_they_do_nothing|full_campaign_timeline_assuming_heroes_succeed|adventure hook/iu.test(units[0]?.context ?? "");
    if (appears && (pcCue || adventureAction || inheritedPartyContext || /\b(?:characters|heroes|adventurers)\b/iu.test(normalized) && /\b(?:you|players|encounter|adventure|quest|reward|read aloud)\b/iu.test(evidenceText)))
      return { name, canonicalId: HEROES_ID, diagnostic: null };
    return { name, canonicalId: null, diagnostic: "ambiguous_party_reference" };
  }
  const exact = request.entities.filter((entity) => normalizeName(entity.name) === normalized);
  const alias = request.entities.filter((entity) => entity.aliases.some((value) => normalizeName(value) === normalized));
  const article = normalized.startsWith("the ") ? normalized.slice(4) : `the ${normalized}`;
  const variant = request.entities.filter((entity) => [entity.name, ...entity.aliases].some((value) => normalizeName(value) === article));
  const found = exact.length ? exact : alias.length ? alias : variant;
  const unique = [...new Map(found.map((entity) => [entity.canonicalId, entity])).values()];
  if (unique.length === 1) return { name, canonicalId: unique[0].canonicalId, diagnostic: null };
  if (unique.length > 1) return { name, canonicalId: null, diagnostic: "ambiguous_alias" };
  // A definite local creature reference may be linked through an explicit
  // source chain: a unique named individual of that type, followed by that
  // individual's return as the named creature. Indefinite type references stay
  // unresolved. The chain is derived from this request, not a name exception.
  if (/^the /iu.test(name) && units.some((unit) => unit.text.toLowerCase().includes(normalized))) {
    const type = normalized.slice(4);
    const returnUnit = request.evidenceUnits.find((unit) =>
      new RegExp(`\\bknown as a ${type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(unit.text));
    if (returnUnit) {
      const preceding = request.evidenceUnits.filter((unit) => unit.order < returnUnit.order && unit.order >= returnUnit.order - 5);
      const antecedentType = returnUnit.text.match(/^The (\w+) returned\b/iu)?.[1];
      const individuals = request.entities.filter((entity) => preceding.some((unit) =>
        new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, a ${antecedentType ?? "<unknown>"}\\b`, "iu").test(unit.text)));
      if (individuals.length === 1) return { name, canonicalId: individuals[0].canonicalId, diagnostic: "source_established_local_identity" };
    }
  }
  // A type name is never silently promoted to a named individual. Local identity
  // can resolve only when the cited source explicitly equates the two names.
  const matching = request.entities.filter((entity) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(evidenceText) &&
    new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(evidenceText) && /\b(?:named|called|known as)\b/iu.test(evidenceText));
  if (matching.length === 1) return { name, canonicalId: matching[0].canonicalId, diagnostic: "source_established_identity" };
  if (/^(?:a|an|the)?\s*(?:creature|monster|person|someone|something|group|people|others|enemy|foe|victim|individual)s?$/iu.test(name.trim()))
    return { name, canonicalId: null, diagnostic: "generic_non_entity" };
  return { name, canonicalId: null, diagnostic: "unknown_participant" };
}

function sourceStatus(statement: string, units: EvidenceUnit[]): SourceStatus {
  const text = statement;
  const context = units[0]?.context ?? "";
  if (/what_if_they_do_nothing|if the heroes do nothing/iu.test(context)) return "conditional";
  if (/\b(?:gm|game master|you should|have the players|award the players|read aloud|instructs?)\b/iu.test(text)) return "gm_instruction";
  if (/rumou?r/iu.test(context) || /\b(?:rumou?red?|is said to|reportedly|some say|believed to|residents report)\b/iu.test(text)) return "rumor";
  if (/day [1-9]|timeline|schedule/iu.test(context) || /\b(?:day [1-9])\b/iu.test(text)) return "scheduled";
  if (/\b(?:if|unless|would|could|might|should|when the heroes|on a successful|on a failed)\b/iu.test(text)) return "conditional";
  if (/\b(?:plans to|intends to|hopes to|seeks to)\b/iu.test(text)) return "plan";
  const relevant = units.flatMap((unit) => unit.text.split(/(?<=[.!?])\s+/u)).filter((sentence) => evidenceOverlap(statement, [{ text: sentence } as EvidenceUnit]) >= 0.35);
  if (relevant.some((sentence) => /\b(?:rumou?red?|is said to|reportedly|some say|believed to|residents report)\b/iu.test(sentence))) return "rumor";
  if (relevant.some((sentence) => /\b(?:plans to|intends to|hopes to|seeks to)\b/iu.test(sentence))) return "plan";
  if (relevant.some((sentence) => /\b(?:if|unless|would|could|might)\b/iu.test(sentence))) return "conditional";
  return "established";
}
function statementStatus(statement: string) {
  if (/\b(?:rumou?red?|is said to|reportedly|some say|believed to|residents report)\b/iu.test(statement)) return "rumor";
  if (/\b(?:if|unless|would|could|might|should|when|on a successful|on a failed|possible|optional|hypothetical|timeline|scheduled|day [1-9])\b/iu.test(statement)) return "conditional";
  if (/\b(?:gm|game master|instruct|award|read aloud)\b/iu.test(statement)) return "gm_instruction";
  return "established";
}
function possibleSourceDiscrepancy(request: Claims41Request, units: EvidenceUnit[]) {
  const binding = units.map((unit) => unit.text).join(" ").match(/\bbound\s+(\p{Lu}[\p{L}'’-]*)\b/u);
  if (!binding) return false;
  const entity = request.entities.find((item) => normalizeName(item.name) === normalizeName(binding[1]));
  if (!entity || entity.type.toLowerCase() !== "deity") return false;
  const creatureTypes = request.evidenceUnits.filter((unit) => unit.order < units[0].order && unit.order >= units[0].order - 8)
    .flatMap((unit) => [...unit.text.matchAll(/\bknown as an? (\p{L}+)\b/giu)].map((match) => match[1]));
  return creatureTypes.some((type) => request.evidenceUnits.some((unit) =>
    new RegExp(`\\b${type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(unit.text) &&
    /\b(?:imprisoned|trapped|contained|wards?)\b/iu.test(unit.text)));
}

export function reconcileClaims41(output: Claims41Output, request: Claims41Request) {
  const parsed = claims41OutputSchema.parse(output);
  const byId = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
  const claims: Claims41Claim[] = parsed.claims.map((original, proposalIndex) => {
    const cited = original.evidence_unit_ids.map((id) => byId.get(id));
    const units = cited.filter((unit): unit is EvidenceUnit => Boolean(unit));
    const reasons: string[] = [];
    if (units.length !== cited.length) reasons.push("unknown_evidence_unit");
    if (new Set(original.evidence_unit_ids).size !== original.evidence_unit_ids.length) reasons.push("duplicate_evidence_unit");
    if (units.some((unit) => unit.kind !== "sentence")) reasons.push("heading_is_context_only");
    if (units.some((unit) => unit.rawSource.page !== unit.page || !unit.rawSource.text.trim() ||
      unit.rawSource.start < 0 || unit.rawSource.end - unit.rawSource.start !== unit.rawSource.text.length)) reasons.push("invalid_source_mapping");
    const distant = units.length > 1 && units.some((unit, index) => index > 0 && unit.order > units[index - 1].order + 1);
    const contextualIds = new Set(distant ? units.filter((unit) => /timeline below presents|assuming the heroes succeed|if the heroes do nothing/iu.test(unit.text)).map((unit) => unit.unitId) : []);
    const directUnits = units.filter((unit) => !contextualIds.has(unit.unitId));
    const reviewSignals: string[] = [];
    if (distant && !contextualIds.size) reviewSignals.push("nonadjacent_evidence_review");
    if (!directUnits.length) reasons.push("no_direct_evidence");
    if (directUnits.length && evidenceOverlap(original.statement, directUnits) < 0.32) reviewSignals.push("low_lexical_overlap");
    const directText = directUnits.map((unit) => unit.text).join(" ").toLowerCase();
    const qualifierWords = ["only", "never", "none", "all", "every", "always"];
    const participantWords = terms(original.participants.join(" "));
    const longNovelWords = [...terms(original.statement)].filter((word) => word.length >= 9 &&
      !participantWords.has(word) && !directText.includes(word) && !(units[0]?.context.toLowerCase() ?? "").includes(word));
    if (qualifierWords.some((word) => new RegExp(`\\b${word}\\b`, "iu").test(original.statement) &&
      !new RegExp(`\\b${word}\\b`, "iu").test(directText)) || longNovelWords.length > 0) reviewSignals.push("novel_qualifier_or_word");
    const participants = original.participants.map((name) => resolveParticipant(request, name, units));
    if (participants.some((item) => !item.canonicalId && item.diagnostic !== "generic_non_entity")) reasons.push("identity_unresolved");
    const status = sourceStatus(original.statement, units);
    const wordStatus = statementStatus(original.statement);
    // Governing context is retained as metadata. Only a claim that drops a
    // qualifier from its own proposition needs a source-status task.
    const contextGoverned = /what_if_they_do_nothing|if the heroes do nothing|timeline|day [1-9]|schedule|adventure hook/iu.test(units[0]?.context ?? "");
    if ((status === "rumor" && wordStatus !== "rumor") ||
      (status === "plan" && !/\b(?:plans?|intends?|hopes?|seeks?|aims?)\b/iu.test(original.statement)) ||
      (status === "conditional" && !contextGoverned && wordStatus === "established") ||
      (status === "gm_instruction" && wordStatus !== "gm_instruction")) reasons.push("source_status_unqualified");
    if (units.length && possibleSourceDiscrepancy(request, units)) reasons.push("possible_source_discrepancy");
    const evidenceValidity = reasons.some((reason) => /evidence|source_mapping|heading/.test(reason)) ? "pending" : "valid";
    const participantResolution = reasons.includes("identity_unresolved") ? "pending" : "resolved";
    const sourceStatusDecision = reasons.includes("source_status_unqualified") ? "pending" : "qualified";
    const state: Claims41Status = evidenceValidity === "pending" ? "pending_evidence"
      : reasons.includes("source_status_unqualified") ? "pending_source_status"
      : reasons.includes("identity_unresolved") ? "pending_identity"
      : reasons.includes("possible_source_discrepancy") ? "pending_gm_review" : "ready";
    return { requestId: request.requestId, proposalIndex, original, state, reasons, sourceStatus: status, participants,
      evidenceValidity, participantResolution, sourceStatusDecision, reviewSignals,
      evidence: units.map((unit) => ({ unitId: unit.unitId, page: unit.page, start: unit.rawSource.start, end: unit.rawSource.end, text: unit.rawSource.text, direct: unit.kind === "sentence" && !contextualIds.has(unit.unitId) })),
      context: units[0]?.context ?? null, ...(units[0] && cleanSectionHeading(units[0].context) ? { sectionHeading: cleanSectionHeading(units[0].context) } : {}),
      sourceOrder: units[0]?.order ?? null, duplicateProposalIndexes: [] };
  });
  const merged: Claims41Claim[] = [];
  const seen = new Map<string, Claims41Claim>();
  for (const claim of claims) {
    const statementKey = claim.original.statement.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
    const key = JSON.stringify([statementKey, claim.context, claim.sourceStatus]);
    const prior = seen.get(key) ?? (!claim.context ? merged.find((item) =>
      item.original.statement.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim() === statementKey && item.sourceStatus === claim.sourceStatus) : undefined);
    if (!prior) { const copy = { ...claim, evidence: [...claim.evidence], participants: [...claim.participants],
      reasons: [...claim.reasons], reviewSignals: [...claim.reviewSignals], duplicateProposalIndexes: [] }; seen.set(key, copy); merged.push(copy); continue; }
    const quality = (item: Claims41Claim) => (item.evidenceValidity === "valid" ? 4 : 0) +
      (item.sourceStatusDecision === "qualified" ? 2 : 0) + (item.participantResolution === "resolved" ? 1 : 0);
    const better = quality(claim) > quality(prior);
    const best = better ? claim : prior;
    const worse = better ? prior : claim;
    const duplicateProposalIndexes = [...prior.duplicateProposalIndexes, claim.proposalIndex];
    const replacement = { ...best, duplicateProposalIndexes,
      evidence: [...best.evidence, ...worse.evidence.filter((item) => worse.evidenceValidity === "valid" && !best.evidence.some((existing) => existing.unitId === item.unitId))],
      participants: [...best.participants, ...worse.participants.filter((item) => item.canonicalId && !best.participants.some((existing) => existing.canonicalId === item.canonicalId))],
      reasons: [...best.reasons], reviewSignals: [...new Set([...best.reviewSignals, ...worse.reviewSignals])] };
    seen.set(key, replacement);
    seen.set(JSON.stringify([statementKey, prior.context, prior.sourceStatus]), replacement);
    merged[merged.indexOf(prior)] = replacement;
  }
  return { rawProposals: parsed, proposals: claims, claims: merged, diagnostics: { proposed: claims.length, retained: merged.length,
    byState: Object.fromEntries(["ready", "pending_identity", "pending_evidence", "pending_source_status", "pending_gm_review"].map((state) => [state, merged.filter((claim) => claim.state === state).length])),
    byReason: Object.fromEntries([...new Set(merged.flatMap((claim) => claim.reasons))].map((reason) => [reason, merged.filter((claim) => claim.reasons.includes(reason)).length])) } };
}

export function claims41CheckpointIdentity(args: { request: Claims41Request; fixtureHash: string; sourceHash: string; inventoryHash: string; manifestHash: string; modelId: string }): AIOperationIdentity {
  return { campaignId: "claims41-offline-benchmark", documentId: args.fixtureHash, sourceExtractionCacheId: null, providerId: "openai", modelId: args.modelId,
    processingMode: "claims_experiment", stage: "extraction", operationType: "claims_4_1_experiment", operationKey: args.request.requestId,
    inputHash: modelInputHash(CLAIMS_4_1_PROMPT, serializeClaims41Request(args.request).payload),
    upstreamFingerprint: semanticInputHash({ sourceHash: args.sourceHash, inventoryHash: args.inventoryHash, manifestHash: args.manifestHash,
      baselineRequestId: args.request.baselineRequestId, units: args.request.evidenceUnits, entities: args.request.entities }),
    behaviorVersion: CLAIMS_4_1_BEHAVIOR_VERSION, schemaVersion: CLAIMS_4_1_SCHEMA_VERSION };
}
