import { createHash } from "node:crypto";
import { z } from "zod";
import type { Claims3Request } from "./claims-3-experiment";
import { cleanSectionHeading, HEROES_ID } from "./claims-3-experiment";
import type { EvidenceUnit } from "./claims-2-experiment";
import { normalizeName } from "../graph/normalize";
import { modelInputHash, semanticInputHash, type AIOperationIdentity } from "./operation-checkpoint";

export const CLAIMS_4_BEHAVIOR_VERSION = "claims-4-experiment-1";
export const CLAIMS_4_SCHEMA_VERSION = 1;
export const CLAIMS_4_PROMPT = `Extract every useful source-grounded proposition in this request, including named participants absent from KNOWN ENTITIES. The inventory helps identify people and things; it is not a limit. Cover identity, history, motives, objectives, abilities, places, relationships, secrets, rules, rewards, encounter consequences, and developments. Keep connected causes, conditions, qualifications, attribution, and participants together; split independent facts when useful. Preserve rumors as attributed rumors. Preserve planned timelines, possible outcomes, adventure hooks, and GM instructions with their contingent or instructional wording; never state that they occurred in play. A creature's game-mechanical "hero role" is not the Heroes / Party. Keep the source's wording when it seems surprising; do not silently correct it. SOURCE CONTEXT and headings aid interpretation but are not direct evidence. Cite the smallest direct sentence units that together support the complete statement; additional distant context may inform interpretation but should not be cited as direct proof. A page continuation may require units on both pages. Output only self-contained candidate statements, source participant names, and direct unit IDs. Extract first; identity and display decisions happen later.`;

export const claims4OutputSchema = z.object({ claims: z.array(z.object({
  statement: z.string().trim().min(1).max(900),
  participants: z.array(z.string().trim().min(1).max(200)).max(24),
  evidence_unit_ids: z.array(z.string().trim().min(1).max(50)).min(1).max(5),
}).strict()).max(400) }).strict();
export type Claims4Output = z.infer<typeof claims4OutputSchema>;
export interface Claims4Request extends Claims3Request { inputDifferences: string[] }
export type Claims4Status = "ready" | "pending_identity" | "pending_evidence" | "pending_source_status" | "pending_gm_review";
export type SourceStatus = "established" | "rumor" | "plan" | "scheduled" | "conditional" | "gm_instruction" | "unclear";
export interface Claims4Claim {
  requestId: string; proposalIndex: number; original: Claims4Output["claims"][number];
  state: Claims4Status; reasons: string[]; sourceStatus: SourceStatus;
  participants: Array<{ name: string; canonicalId: string | null; diagnostic: string | null }>;
  evidence: Array<{ unitId: string; page: number; start: number; end: number; text: string; direct: boolean }>;
  context: string | null; sectionHeading?: string; sourceOrder: number | null;
  duplicateProposalIndexes: number[];
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export const claims4PromptHash = () => sha(CLAIMS_4_PROMPT);
export const claims4SchemaHash = () => sha(JSON.stringify(z.toJSONSchema(claims4OutputSchema)));

export function planClaims4Request(base: Claims3Request): Claims4Request {
  const evidenceUnits = base.evidenceUnits.map((unit) => ({ ...unit, rawSource: { ...unit.rawSource } }));
  let inheritedTimeline = false;
  for (const unit of evidenceUnits) {
    if (/^Timeline for the War$/iu.test(unit.text)) inheritedTimeline = true;
    if (unit.context === "what_if_they_do_nothing") inheritedTimeline = false;
    if (inheritedTimeline && unit.context === "main") unit.context = "full_campaign_timeline_assuming_heroes_succeed";
  }
  return { ...base, requestId: base.requestId.replace("claims3", "claims4"), evidenceUnits,
    inputDifferences: ["Claims-4 changes prompt, schema, and output cap; frozen raw spans, unit IDs, offsets, request boundary, and Claims-3 deterministic context are retained.",
      "Claims-4 explicitly allows source participants missing from the inventory and supplies adjacent sentence context for interpretation separately from direct citation.",
      "The WotBS success-assuming full-campaign timeline heading is inherited deterministically until the separate no-heroes context begins."] };
}

export function serializeClaims4Request(request: Claims4Request) {
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

export function claims4TokenDiagnostics(request: Claims4Request) {
  const { entities, source } = serializeClaims4Request(request);
  const characters = { source: source.length, entity: entities.length, prompt: CLAIMS_4_PROMPT.length, schema: JSON.stringify(z.toJSONSchema(claims4OutputSchema)).length };
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
function resolveParticipant(request: Claims4Request, name: string, units: EvidenceUnit[]) {
  const normalized = normalizeName(name);
  const evidenceText = units.map((unit) => unit.text).join(" ");
  if (normalized === "party" || normalized === "the party") {
    return /\b(adventuring party|player characters|the heroes)\b/iu.test(evidenceText)
      ? { name, canonicalId: HEROES_ID, diagnostic: null } : { name, canonicalId: null, diagnostic: "ambiguous_party_reference" };
  }
  if (/\bhero role\b/iu.test(evidenceText) && /^(?:heroes|the heroes)$/iu.test(name.trim())) return { name, canonicalId: null, diagnostic: "game_role_not_party" };
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
  return { name, canonicalId: null, diagnostic: "unknown_participant" };
}

function sourceStatus(statement: string, units: EvidenceUnit[]): SourceStatus {
  const text = `${statement} ${units.map((unit) => unit.text).join(" ")}`;
  const context = units[0]?.context ?? "";
  if (/what_if_they_do_nothing|if the heroes do nothing/iu.test(context)) return "conditional";
  if (/\b(?:gm|game master|you should|have the players|award the players|read aloud)\b/iu.test(text)) return "gm_instruction";
  if (/rumou?r/iu.test(context) || /\b(?:rumou?red?|is said to|reportedly|some say|believed to|residents report)\b/iu.test(text)) return "rumor";
  if (/day [1-9]|timeline|schedule/iu.test(context) || /\b(?:day [1-9])\b/iu.test(text)) return "scheduled";
  if (/\b(?:if|unless|would|could|might|should|when the heroes|on a successful|on a failed)\b/iu.test(text)) return "conditional";
  if (/\b(?:plans to|intends to|hopes to|seeks to)\b/iu.test(text)) return "plan";
  return "established";
}
function statementStatus(statement: string) {
  if (/\b(?:rumou?red?|is said to|reportedly|some say|believed to|residents report)\b/iu.test(statement)) return "rumor";
  if (/\b(?:if|unless|would|could|might|should|when|on a successful|on a failed|possible|optional|hypothetical|timeline|scheduled|day [1-9])\b/iu.test(statement)) return "conditional";
  if (/\b(?:gm|game master|instruct|award|read aloud)\b/iu.test(statement)) return "gm_instruction";
  return "established";
}
function possibleSourceDiscrepancy(request: Claims4Request, units: EvidenceUnit[]) {
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

export function reconcileClaims4(output: Claims4Output, request: Claims4Request) {
  const parsed = claims4OutputSchema.parse(output);
  const byId = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
  const claims: Claims4Claim[] = parsed.claims.map((original, proposalIndex) => {
    const cited = original.evidence_unit_ids.map((id) => byId.get(id));
    const units = cited.filter((unit): unit is EvidenceUnit => Boolean(unit));
    const reasons: string[] = [];
    if (units.length !== cited.length) reasons.push("unknown_evidence_unit");
    if (new Set(original.evidence_unit_ids).size !== original.evidence_unit_ids.length) reasons.push("duplicate_evidence_unit");
    if (units.some((unit) => unit.kind !== "sentence")) reasons.push("heading_is_context_only");
    if (units.some((unit) => unit.rawSource.page !== unit.page || !unit.rawSource.text.trim())) reasons.push("invalid_source_mapping");
    const distant = units.length > 1 && units.some((unit, index) => index > 0 && unit.order > units[index - 1].order + 1);
    const contextualIds = new Set(distant ? units.filter((unit) => /timeline below presents|assuming the heroes succeed|if the heroes do nothing/iu.test(unit.text)).map((unit) => unit.unitId) : []);
    const directUnits = units.filter((unit) => !contextualIds.has(unit.unitId));
    if (distant && !contextualIds.size) reasons.push("nonadjacent_evidence_review");
    if (directUnits.length && evidenceOverlap(original.statement, directUnits) < 0.32) reasons.push("semantic_support_unverified");
    const directText = directUnits.map((unit) => unit.text).join(" ").toLowerCase();
    const qualifierWords = ["only", "never", "none", "all", "every", "always"];
    const participantWords = terms(original.participants.join(" "));
    const longNovelWords = [...terms(original.statement)].filter((word) => word.length >= 9 &&
      !participantWords.has(word) && !directText.includes(word) && !(units[0]?.context.toLowerCase() ?? "").includes(word));
    if (qualifierWords.some((word) => new RegExp(`\\b${word}\\b`, "iu").test(original.statement) &&
      !new RegExp(`\\b${word}\\b`, "iu").test(directText)) || longNovelWords.length > 0) reasons.push("semantic_qualifier_unverified");
    const participants = original.participants.map((name) => resolveParticipant(request, name, units));
    if (participants.some((item) => !item.canonicalId)) reasons.push("identity_unresolved");
    const status = sourceStatus(original.statement, units);
    const wordStatus = statementStatus(original.statement);
    if ((status === "rumor" && wordStatus !== "rumor") ||
      (["conditional", "scheduled", "plan"].includes(status) && wordStatus === "established") ||
      (status === "gm_instruction" && wordStatus !== "gm_instruction")) reasons.push("source_status_unqualified");
    if (units.length && possibleSourceDiscrepancy(request, units)) reasons.push("possible_source_discrepancy");
    const state: Claims4Status = reasons.some((reason) => /evidence|source_mapping|semantic_|heading/.test(reason)) ? "pending_evidence"
      : reasons.includes("source_status_unqualified") ? "pending_source_status"
      : reasons.includes("identity_unresolved") ? "pending_identity"
      : reasons.includes("possible_source_discrepancy") ? "pending_gm_review" : "ready";
    return { requestId: request.requestId, proposalIndex, original, state, reasons, sourceStatus: status, participants,
      evidence: units.map((unit) => ({ unitId: unit.unitId, page: unit.page, start: unit.rawSource.start, end: unit.rawSource.end, text: unit.rawSource.text, direct: unit.kind === "sentence" && !contextualIds.has(unit.unitId) })),
      context: units[0]?.context ?? null, ...(units[0] && cleanSectionHeading(units[0].context) ? { sectionHeading: cleanSectionHeading(units[0].context) } : {}),
      sourceOrder: units[0]?.order ?? null, duplicateProposalIndexes: [] };
  });
  const merged: Claims4Claim[] = [];
  const seen = new Map<string, Claims4Claim>();
  for (const claim of claims) {
    const key = JSON.stringify([claim.original.statement.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim(), claim.context, claim.sourceStatus]);
    const prior = seen.get(key);
    if (!prior) { seen.set(key, claim); merged.push(claim); continue; }
    prior.duplicateProposalIndexes.push(claim.proposalIndex);
    prior.evidence.push(...claim.evidence.filter((item) => !prior.evidence.some((existing) => existing.unitId === item.unitId)));
    prior.participants.push(...claim.participants.filter((item) => !prior.participants.some((existing) => existing.name === item.name)));
    prior.reasons = [...new Set([...prior.reasons, ...claim.reasons])];
    if (prior.state === "ready" && claim.state !== "ready") prior.state = claim.state;
  }
  return { rawProposals: parsed, proposals: claims, claims: merged, diagnostics: { proposed: claims.length, retained: merged.length,
    byState: Object.fromEntries(["ready", "pending_identity", "pending_evidence", "pending_source_status", "pending_gm_review"].map((state) => [state, merged.filter((claim) => claim.state === state).length])),
    byReason: Object.fromEntries([...new Set(merged.flatMap((claim) => claim.reasons))].map((reason) => [reason, merged.filter((claim) => claim.reasons.includes(reason)).length])) } };
}

export function claims4CheckpointIdentity(args: { request: Claims4Request; fixtureHash: string; sourceHash: string; inventoryHash: string; manifestHash: string; modelId: string }): AIOperationIdentity {
  return { campaignId: "claims4-offline-benchmark", documentId: args.fixtureHash, sourceExtractionCacheId: null, providerId: "openai", modelId: args.modelId,
    processingMode: "claims_experiment", stage: "extraction", operationType: "claims_4_experiment", operationKey: args.request.requestId,
    inputHash: modelInputHash(CLAIMS_4_PROMPT, serializeClaims4Request(args.request).payload),
    upstreamFingerprint: semanticInputHash({ sourceHash: args.sourceHash, inventoryHash: args.inventoryHash, manifestHash: args.manifestHash,
      baselineRequestId: args.request.baselineRequestId, units: args.request.evidenceUnits, entities: args.request.entities }),
    behaviorVersion: CLAIMS_4_BEHAVIOR_VERSION, schemaVersion: CLAIMS_4_SCHEMA_VERSION };
}
