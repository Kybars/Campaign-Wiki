import { claims41OutputSchema, reconcileClaims41, type Claims41Output, type Claims41Request, type SourceStatus } from "./claims-4-1-experiment";
import { normalizeName } from "../graph/normalize";

export const CLAIMS_4_1_RECONCILIATION_VERSION = "claims-4-1-reconciliation-2";
type Entity = Claims41Request["entities"][number];
type Unit = Claims41Request["evidenceUnits"][number];
export type ParticipantResolution =
  | { mention: string; kind: "canonical_entity"; canonicalId: string; canonicalName: string }
  | { mention: string; kind: "descriptor"; canonicalId: string; canonicalName: string }
  | { mention: string; kind: "generic_non_entity"; canonicalId: null; canonicalName: null }
  | { mention: string; kind: "unresolved"; canonicalId: null; canonicalName: null; reason: string };
export interface TimelineAssociation {
  structure: "campaign_timeline";
  branch: "main_assuming_heroes_succeed" | "heroes_do_nothing";
  timeLabel: string | null;
  sourceOrder: number;
  evidenceUnitId: string;
  propositionStatus: "published_scheduled" | "plan" | "conditional";
}
export interface ReconciledClaimV2 {
  requestId: string;
  proposalIndex: number;
  original: Claims41Output["claims"][number];
  resolutionState: "resolved" | "needs_review";
  reviewReasons: string[];
  sourceStatus: SourceStatus;
  participants: ParticipantResolution[];
  entityAssociations: Array<{ canonicalId: string; canonicalName: string }>;
  timelineAssociation: TimelineAssociation | null;
  evidence: Array<{ unitId: string; page: number; start: number; end: number; text: string; direct: boolean }>;
  sourceOrder: number | null;
}

const months = ["November", "December", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October"];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizedText = (value: string) => normalizeName(value).replace(/[’]/gu, "'");

function uniqueEntity(request: Claims41Request, name: string): Entity | null {
  const key = normalizedText(name);
  const exact = request.entities.filter((entity) => normalizedText(entity.name) === key);
  const alias = request.entities.filter((entity) => entity.aliases.some((item) => normalizedText(item) === key));
  const candidates = exact.length ? exact : alias;
  return candidates.length === 1 ? candidates[0] : null;
}

function sourceSupportsDescriptor(mention: string, parent: Entity, units: Unit[]): boolean {
  const source = units.map((unit) => unit.text).join(" ").replace(/[’]/gu, "'");
  const label = parent.name.replace(/[’]/gu, "'");
  const name = mention.replace(/[’]/gu, "'");
  if (!source.trim()) return false;
  const role = name.match(/\b(diplomatic envoy|agents?|students?|bookkeepers?|messengers?|guards?|fleets?|armies|army|rooms?|storerooms?|gates?|envoys?|loyalists?|nobles?)\b/iu)?.[1];
  if (!role) return false;
  if (new RegExp(`\\b(?:first|second|third|fourth|\\d+(?:st|nd|rd|th))\\s+${escape(label)}\\b`, "iu").test(name) &&
      new RegExp(`\\b(?:first|second|third|fourth|\\d+(?:st|nd|rd|th))\\s+${escape(label)}\\b`, "iu").test(source)) return true;
  const rolePattern = role.toLowerCase() === "armies" ? "(?:army|armies)" : escape(role);
  // An explicit possessive, "of" phrase, or attributive organization name
  // establishes affiliation; mere shared tokens elsewhere do not.
  const possessive = new RegExp(`\\b${escape(label)}['’]s\\s+(?:\\w+\\s+){0,2}${rolePattern}\\b`, "iu");
  const ofParent = new RegExp(`\\b${rolePattern}\\s+of\\s+(?:the\\s+)?${escape(label)}\\b`, "iu");
  const prefix = new RegExp(`\\b${escape(label)}\\s+(?:\\w+\\s+){0,2}${rolePattern}\\b`, "iu");
  const anaphora = new RegExp(`\\b${escape(label)}\\s+(?:and|with)\\s+(?:his|her|their|its)\\s+${rolePattern}\\b`, "iu");
  if (possessive.test(source) || ofParent.test(source) || prefix.test(source) || anaphora.test(source)) return true;
  // The model can name "Seaquen agents" while the source says "agents of Seaquen".
  if (normalizedText(name).includes(normalizedText(label)) &&
      ofParent.test(source)) return true;
  return false;
}

function demonym(name: string): string | null {
  if (!/^[\p{L}]+$/u.test(name)) return null;
  if (/a$/iu.test(name)) return `${name}n`;
  if (/e$/iu.test(name)) return `${name.slice(0, -1)}ian`;
  return null;
}

function descriptorParent(request: Claims41Request, mention: string, units: Unit[]): Entity | null {
  const source = units.map((unit) => unit.text).join(" ").replace(/[’]/gu, "'");
  const name = mention.replace(/[’]/gu, "'");
  const literal = request.entities.filter((entity) => normalizedText(name).includes(normalizedText(entity.name)) &&
    sourceSupportsDescriptor(name, entity, units)).sort((a, b) => b.name.length - a.name.length);
  if (literal.length && (literal.length === 1 || literal[0].name.length > literal[1].name.length)) return literal[0];
  const national = request.entities.filter((entity) => {
    const adjective = demonym(entity.name);
    return adjective && new RegExp(`\\b${escape(adjective)}\\b`, "iu").test(name) &&
      new RegExp(`\\b${escape(adjective)}\\s+(?:imperial\\s+)?(?:army|armies|fleet|siege engines|diplomatic envoy)\\b`, "iu").test(source);
  });
  if (national.length === 1) return national[0];
  const candidates = request.entities.filter((entity) => {
    if (sourceSupportsDescriptor(name, entity, units)) return true;
    return false;
  });
  const sorted = candidates.sort((a, b) => b.name.length - a.name.length);
  return sorted.length === 1 || sorted.length > 1 && sorted[0].name.length > sorted[1].name.length ? sorted[0] : null;
}

function isSubdivision(mention: string): boolean {
  return /\b(?:first|second|third|fourth|\d+(?:st|nd|rd|th))\s+.*\b(?:army|armies|fleet|company|unit)\b|\b(?:army|armies|fleet|agents?|students?|bookkeepers?|messengers?|guards?|envoys?|loyalists?|storeroom|room)\b|\bgate\s+of\b/iu.test(mention);
}
function isGeneric(mention: string): boolean {
  return /^(?:a|an|the)?\s*(?:creature|monster|person|someone|something|group|people|others|enemy|enemies|foe|victims?|individuals?|soldiers?|troops?|drow assassins|captured orcs|captured half-orcs|sindairese|gm|game master|ragesian siege engines)$/iu.test(mention.trim()) ||
    /^(?:a|an|the|several|some|many|captured|generic)\s+(?:\w+\s+){0,2}(?:creatures?|soldiers?|victims?|enemies|orcs|half-orcs)$/iu.test(mention.trim());
}

function participant(request: Claims41Request, mention: string, units: Unit[], oldCanonicalId: string | null): ParticipantResolution {
  const exact = uniqueEntity(request, mention);
  const old = oldCanonicalId ? request.entities.find((entity) => entity.canonicalId === oldCanonicalId) : undefined;
  const articleName = normalizedText(mention).replace(/^the /u, "");
  const articleMatches = old && [old.name, ...old.aliases].some((value) => normalizedText(value).replace(/^the /u, "") === articleName);
  const partyMatches = old?.canonicalId === "system:heroes-party" && /^(?:heroes \/ party|heroes|the heroes|party|the party|characters|the characters|adventurers|the adventurers|pcs|player characters|the player characters|adventuring party)$/iu.test(mention);
  const canonical = exact ?? (articleMatches || partyMatches ? old : undefined);
  // A named grammatical subdivision stays a descriptor even when the frozen
  // inventory happened to have promoted it before this reconciliation.
  if (isSubdivision(mention)) {
    const parent = descriptorParent(request, mention, units);
    if (parent && parent.canonicalId !== canonical?.canonicalId)
      return { mention, kind: "descriptor", canonicalId: parent.canonicalId, canonicalName: parent.name };
    if (parent && !canonical)
      return { mention, kind: "descriptor", canonicalId: parent.canonicalId, canonicalName: parent.name };
  }
  if (canonical) return { mention, kind: "canonical_entity", canonicalId: canonical.canonicalId, canonicalName: canonical.name };
  if (isGeneric(mention)) return { mention, kind: "generic_non_entity", canonicalId: null, canonicalName: null };
  const parent = descriptorParent(request, mention, units);
  if (parent) return { mention, kind: "descriptor", canonicalId: parent.canonicalId, canonicalName: parent.name };
  // A lowercase role/group phrase without a distinctive proper name is not an
  // independent identity. Proper names and ambiguous aliases remain reviewable.
  if (!/\p{Lu}/u.test(mention) && /\b(?:assassins?|nobles?|loyalists?|forces?|soldiers?|envoys?|students?|fleet|army|armies)\b/iu.test(mention))
    return { mention, kind: "generic_non_entity", canonicalId: null, canonicalName: null };
  return { mention, kind: "unresolved", canonicalId: null, canonicalName: null, reason: "unmatched_meaningful_identity" };
}

function timelineByUnit(request: Claims41Request): Map<string, Omit<TimelineAssociation, "propositionStatus">> {
  const result = new Map<string, Omit<TimelineAssociation, "propositionStatus">>();
  let month: string | null = null;
  for (const unit of [...request.evidenceUnits].sort((a, b) => a.order - b.order)) {
    if (unit.context === "what_if_they_do_nothing") {
      if (unit.kind === "sentence") result.set(unit.unitId, { structure: "campaign_timeline", branch: "heroes_do_nothing", timeLabel: null,
        sourceOrder: unit.order, evidenceUnitId: unit.unitId });
      continue;
    }
    if (unit.context !== "full_campaign_timeline_assuming_heroes_succeed") continue;
    const marker = unit.text.match(/^\s*(November|December|January|February|March|April|May|June|July|August|September|October)\s*\*/iu)?.[1];
    if (marker && months.some((item) => item.toLowerCase() === marker.toLowerCase())) month = months.find((item) => item.toLowerCase() === marker.toLowerCase())!;
    if (month && unit.kind === "sentence") result.set(unit.unitId, { structure: "campaign_timeline", branch: "main_assuming_heroes_succeed", timeLabel: month,
      sourceOrder: unit.order, evidenceUnitId: unit.unitId });
  }
  return result;
}

export function reconcileClaims41V2(output: Claims41Output, request: Claims41Request) {
  const parsed = claims41OutputSchema.parse(output);
  const old = reconcileClaims41(parsed, request);
  const byId = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
  const timeline = timelineByUnit(request);
  const claims: ReconciledClaimV2[] = old.proposals.map((prior) => {
    const original = parsed.claims[prior.proposalIndex];
    const units = original.evidence_unit_ids.map((id) => byId.get(id)).filter((unit): unit is Unit => Boolean(unit));
    const first = units[0];
    const preceding = first && request.evidenceUnits.find((unit) => unit.order === first.order - 1 && unit.context === first.context && unit.kind === "sentence");
    const participantContext = preceding ? [preceding, ...units] : units;
    const participants = original.participants.map((mention, index) => {
      const military = mention.match(/\b(first|second|third|fourth|\d+(?:st|nd|rd|th))\s+([\p{L}]+)\s+(army|armies|fleet)\b/iu);
      const ordinal = military?.[1];
      const shorthandText = participantContext.map((unit) => unit.text).join(" ");
      const shorthand = ordinal && new RegExp(`\\b${ordinal}\\b`, "iu").test(shorthandText) &&
        /\barm(?:y|ies)\b/iu.test(shorthandText);
      const explicitAntecedent = shorthand && first ? [...request.evidenceUnits].reverse().find((unit) => unit.order < first.order &&
        new RegExp(`\\b${ordinal}\\s+${escape(military![2])}\\s+${escape(military![3])}\\b`, "iu").test(unit.text)) : undefined;
      return participant(request, mention, explicitAntecedent ? [explicitAntecedent, ...participantContext] : participantContext,
        prior.participants[index]?.canonicalId ?? null);
    });
    const entityAssociations = [...new Map(participants.filter((item) => item.canonicalId).map((item) =>
      [item.canonicalId, { canonicalId: item.canonicalId!, canonicalName: item.canonicalName! }])).values()];
    const sourceText = units.map((unit) => unit.text).join(" ");
    const gmInstruction = /\b(?:GM|game master|you should|have the players|award the players|read aloud)\b/iu.test(original.statement) ||
      /\b(?:you should|GM|game master)\b/iu.test(sourceText);
    const explicitPlan = /\b(?:plans? to|intends? to|intention of|seeks? to|hopes? to|aims? to)\b/iu.test(original.statement);
    const directTimeline = units.map((unit) => timeline.get(unit.unitId)).find((item) => item && unitIsDirect(prior, item.evidenceUnitId));
    const sourceStatus: SourceStatus = gmInstruction ? "gm_instruction" : explicitPlan ? "plan" : directTimeline?.branch === "heroes_do_nothing" ? "conditional"
      : directTimeline ? "scheduled" : prior.sourceStatus === "scheduled" ? "established" : prior.sourceStatus;
    const timelineAssociation: TimelineAssociation | null = !gmInstruction && directTimeline ? { ...directTimeline,
      propositionStatus: explicitPlan ? "plan" : directTimeline.branch === "heroes_do_nothing" ? "conditional" : "published_scheduled" } : null;
    const reviewReasons = prior.reasons.filter((reason) => reason !== "identity_unresolved" && reason !== "source_status_unqualified");
    const scenarioQualifies = timelineAssociation && (prior.sourceStatus === "scheduled" ||
      prior.sourceStatus === "conditional" && timelineAssociation.branch === "heroes_do_nothing");
    if (prior.reasons.includes("source_status_unqualified") && !scenarioQualifies && !gmInstruction)
      reviewReasons.push("source_status_unqualified");
    if (participants.some((item) => item.kind === "unresolved")) reviewReasons.push("unresolved_participant");
    if (!entityAssociations.length && !timelineAssociation) reviewReasons.push("no_useful_home");
    const resolutionState = reviewReasons.length ? "needs_review" : "resolved";
    return { requestId: request.requestId, proposalIndex: prior.proposalIndex, original, resolutionState, reviewReasons,
      sourceStatus, participants, entityAssociations, timelineAssociation, evidence: prior.evidence, sourceOrder: prior.sourceOrder };
  });
  return { version: CLAIMS_4_1_RECONCILIATION_VERSION, rawProposals: parsed, claims,
    gmReview: claims.filter((claim) => claim.resolutionState === "needs_review"), diagnostics: {
      proposed: claims.length, resolved: claims.filter((claim) => claim.resolutionState === "resolved").length,
      needsReview: claims.filter((claim) => claim.resolutionState === "needs_review").length } };
}

function unitIsDirect(prior: ReturnType<typeof reconcileClaims41>["proposals"][number], unitId: string) {
  return prior.evidence.some((item) => item.unitId === unitId && item.direct);
}
