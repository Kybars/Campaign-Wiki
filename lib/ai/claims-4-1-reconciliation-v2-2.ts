import { createHash } from "node:crypto";
import { claims41OutputSchema, type Claims41Output, type Claims41Request, type SourceStatus } from "./claims-4-1-experiment";
import type { ReconciledClaimV2, TimelineAssociation } from "./claims-4-1-reconciliation-v2";
import { normalizeName as norm } from "../graph/normalize";

export const CLAIMS_4_1_RECONCILIATION_V2_2_VERSION = "claims-4-1-reconciliation-2.2";
type Unit = Claims41Request["evidenceUnits"][number];
type Entity = Claims41Request["entities"][number];
type Evidence = ReconciledClaimV2["evidence"][number];
export interface CandidateEntity extends Entity {
  origin: "reconciliation_candidate";
  evidence: Evidence[];
  firstSourceOccurrence: { unitId: string; sourceOrder: number; page: number; start: number };
}
export type ParticipantResolutionV22 =
  | { mention: string; kind: "canonical_entity" | "candidate_entity"; canonicalId: string; canonicalName: string; supportingEvidence: Evidence[] }
  | { mention: string; kind: "descriptor"; canonicalId: string; canonicalName: string; supportingEvidence: Evidence[] }
  | { mention: string; kind: "generic_non_entity" | "unresolved"; canonicalId: null; canonicalName: null; supportingEvidence: Evidence[] };
export type IdentityRelationV22 =
  | { kind: "same_identity_alias"; entityId: string; alternateName: string; sourceUnitId: string; sourceClaimIndex: number | null }
  | { kind: "identity_transition"; fromEntityId: string; toEntityId: string; sourceUnitId: string; sourceClaimIndex: number };
export interface ReconciledClaimV22 extends Omit<ReconciledClaimV2, "participants" | "resolutionState"> {
  wikiDisposition: "present" | "mechanical_only";
  resolutionState: "resolved" | "needs_review" | null;
  participants: ParticipantResolutionV22[];
  directEvidence: Evidence[];
  contextEvidence: Evidence[];
  identityRelations: IdentityRelationV22[];
}
const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, "iu").test(text);
const evidence = (unit: Unit, direct: boolean): Evidence => ({ unitId: unit.unitId, page: unit.page,
  start: unit.rawSource.start, end: unit.rawSource.end, text: unit.rawSource.text, direct });
const common = /^(?:(?:a|an|some|several|many|ordinary|unnamed|the)\s+)?(?:creatures?|monsters?|people|persons?|guards?|soldiers?|agents?|students?|bookkeepers?|swords?|objects?|doors?|walls?|water|fire|damage|effects?|spells?|supplies|treasure|gold|stone|wood|iron|steel|glass|copper|sand|soil|dirt|ice|snow|light|darkness|magic)$/iu;
const subordinate = /\b(?:guards?|agents?|students?|bookkeepers?|staff|army|armies|fleet|rooms?|chambers?|storerooms?|envoys?|messengers?)\b/iu;
const pronoun = /^(?:he|she|it|they|him|her|them|his|its|their)$/iu;
const partyForm = /^(?:Heroes \/ Party|(?:the )?(?:heroes|party|characters|adventurers|pcs|player characters))$/iu;
// Lowercase definite references are considered before generic classification.
const reference = (name: string) => pronoun.test(name) || /^the\s+\p{Ll}/u.test(name);
const proper = (name: string) => !subordinate.test(name) && !common.test(name) && !reference(name) &&
  /^(?:The\s+)?\p{Lu}[\p{L}'’-]*(?:\s+(?:of|the|\p{Lu}[\p{L}'’-]*))*$/u.test(name);

function mechanicalOnly(statement: string): boolean {
  // Recognize complete procedural clauses. An unrecognized clause keeps the whole claim present.
  const mechanic = /\b(?:DC\s*\d+|\d+d\d+|(?:skill|ability) check|saving throw|(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) save|attack roll|[+-]\d+ to hit|reach \d+ (?:ft|feet)|armor class|AC\s*\d+|hit points?|HP\s*\d+|movement speed|initiative|repeat.{0,15}save|(?:damage|speed)\s+(?:is|of)\s*\d+|(?:gains?|loses?|appl(?:y|ies)|removes?)\s+(?:the\s+)?\w+\s+condition)\b/iu;
  const narrative = /\b(?:guards|rules|governs|lives|located|contains|commands|travels|arrives|discovers|reveals|belongs|serves|captures|collapses|attacks|kills|destroys|opens|built|founded|became|returned|transformed|reincarnated|dies|died)\b/iu;
  return statement.split(/[;]|\s+(?:and|but|while|when|if|after|before)\s+/iu)
    .every((clause) => mechanic.test(clause) && !narrative.test(clause) &&
      !/\b(?:is|was|are|were)\s+(?:a|an|the)\s+(?!DC\b|AC\b|HP\b|hit points?\b|armor class\b|damage\b|movement\b|speed\b|initiative\b|\d)\p{L}/iu.test(clause));
}
function exact(entities: Entity[], name: string): Entity | null {
  const named = entities.filter((entity) => norm(entity.name) === norm(name));
  const aliases = entities.filter((entity) => entity.aliases.some((alias) => norm(alias) === norm(name)));
  const article = norm(name).startsWith("the ") ? norm(name).slice(4) : `the ${norm(name)}`;
  const matches = named.length ? named : aliases.length ? aliases : entities.filter((entity) =>
    [entity.name, ...entity.aliases].some((value) => norm(value) === article));
  const unique = [...new Map(matches.map((entity) => [entity.canonicalId, entity])).values()];
  return unique.length === 1 ? unique[0] : null;
}
function explicitType(name: string, units: Unit[]): string {
  const types: Record<string, string> = { npc: "person|man|woman|npc|character", deity: "deity|god|goddess",
    faction: "organization|faction|guild", location: "place|city|village|castle|citadel|town", item: "item|artifact|weapon" };
  const supported = Object.entries(types).filter(([, labels]) => units.some((unit) =>
    new RegExp(`(?<![\\p{L}])(?:${esc(name)}(?:\\s*,\\s*|\\s+is\\s+)(?:a|an)\\s+(?:${labels})\\b|(?:${labels})\\s+(?:is\\s+)?(?:named|called|known as)\\s+${esc(name)}(?=[,.;]|$))`, "iu").test(unit.text)));
  return supported.length === 1 ? supported[0][0] : "other";
}
function localUnits(request: Claims41Request, direct: Unit[]): Unit[] {
  const ordered = [...request.evidenceUnits].sort((a, b) => a.order - b.order);
  return ordered.filter((unit, index) => direct.some((anchor) => {
    const at = ordered.indexOf(anchor);
    // Context is the structural section in the current evidence contract; segmentId can be a page.
    return index >= at - 2 && index <= at + 1 &&
      ordered.slice(Math.min(at, index), Math.max(at, index) + 1).every((entry) => entry.context === anchor.context);
  }));
}
function parentFor(mention: string, units: Unit[], entities: Entity[]): { entity: Entity; unit: Unit } | null {
  if (!subordinate.test(mention)) return null;
  const role = mention.match(subordinate)![0];
  const matches = entities.flatMap((entity) => {
    const relation = new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc(entity.name)}['’]s\\s+(?:\\w+\\s+){0,2}${esc(role)}|${esc(role)}\\s+of\\s+(?:the\\s+)?${esc(entity.name)})(?![\\p{L}\\p{N}])`, "iu");
    // Both the original phrase and source must establish this specific dependent relationship.
    return units.filter((unit) => relation.test(mention) && relation.test(unit.text)).map((unit) => ({ entity, unit }));
  });
  return new Set(matches.map((match) => match.entity.canonicalId)).size === 1 ? matches[0] : null;
}
function discrepancy(statement: string, units: Unit[]): boolean {
  // Compare this proposition only, using an exact subject/copula/predicate and explicit negation.
  const assertion = statement.match(/^(.+?)\s+(is|was|are|were)\s+(not\s+)?([^.!?]+)[.!?]?$/iu);
  if (!assertion) return false;
  const [, subject, copula, negative, predicate] = assertion;
  const opposite = new RegExp(`(?<![\\p{L}])${esc(subject)}\\s+${copula}\\s+${negative ? "" : "not\\s+"}${esc(predicate.trim())}(?=[.!?]|$)`, "iu");
  return units.some((unit) => opposite.test(unit.text));
}

// Retain v2's timeline branches, month propagation, plans and GM-instruction exclusion.
// This helper has no participant resolution or entity attachment side effects.
function timelineByUnit(request: Claims41Request) {
  const result = new Map<string, Omit<TimelineAssociation, "propositionStatus">>();
  const months = ["November", "December", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October"];
  let month: string | null = null;
  for (const unit of [...request.evidenceUnits].sort((a, b) => a.order - b.order)) {
    if (unit.context === "what_if_they_do_nothing") {
      if (unit.kind === "sentence") result.set(unit.unitId, { structure: "campaign_timeline", branch: "heroes_do_nothing",
        timeLabel: null, sourceOrder: unit.order, evidenceUnitId: unit.unitId });
      continue;
    }
    if (unit.context !== "full_campaign_timeline_assuming_heroes_succeed") continue;
    const marker = unit.text.match(/^\s*(November|December|January|February|March|April|May|June|July|August|September|October)\s*\*/iu)?.[1];
    if (marker) month = months.find((value) => value.toLowerCase() === marker.toLowerCase())!;
    if (month && unit.kind === "sentence") result.set(unit.unitId, { structure: "campaign_timeline", branch: "main_assuming_heroes_succeed",
      timeLabel: month, sourceOrder: unit.order, evidenceUnitId: unit.unitId });
  }
  return result;
}

function sourceMetadata(statement: string, direct: Unit[], timeline: ReturnType<typeof timelineByUnit>) {
  const gmInstruction = /\b(?:GM|game master|you should|have the players|award the players|read aloud)\b/iu.test(statement) ||
    direct.some((unit) => /\b(?:you should|GM|game master)\b/iu.test(unit.text));
  const explicitPlan = /\b(?:plans? to|intends? to|intention of|seeks? to|hopes? to|aims? to)\b/iu.test(statement);
  const placement = direct.map((unit) => timeline.get(unit.unitId)).find((item) => !!item);
  const timelineAssociation: TimelineAssociation | null = !gmInstruction && placement ? { ...placement,
    propositionStatus: explicitPlan ? "plan" : placement.branch === "heroes_do_nothing" ? "conditional" : "published_scheduled" } : null;
  const sourceStatus: SourceStatus = gmInstruction ? "gm_instruction" : explicitPlan ? "plan" : placement?.branch === "heroes_do_nothing" ? "conditional" :
    placement ? "scheduled" : /\b(?:rumou?red?|is said to|reportedly|some say|believed to|residents report)\b/iu.test(statement) ||
    /rumou?r/iu.test(direct[0]?.context ?? "") ? "rumor" :
    /\b(?:if|unless|would|could|might|should|when the heroes|on a successful|on a failed)\b/iu.test(statement) ? "conditional" : "established";
  return { sourceStatus, timelineAssociation };
}

export function reconcileClaims41V22(output: Claims41Output, request: Claims41Request) {
  claims41OutputSchema.parse(output); // Validate without replacing or trimming the frozen proposals.
  const rawProposals = structuredClone(output);
  const timeline = timelineByUnit(request);
  const byId = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
  const candidates: CandidateEntity[] = [];
  const aliasMetadata: Array<{ entityId: string; alias: string; evidence: Evidence }> = [];
  const allEntities = () => [...request.entities, ...candidates];
  const lookup = (name: string) => exact(allEntities(), name);
  const candidate = (name: string, units: Unit[], transitionUnit?: Unit): Entity | null => {
    const existing = lookup(name);
    if (existing) return existing;
    const occurrences = units.filter((unit) => has(unit.text, name));
    const repeated = /^the\s+/iu.test(name) && !subordinate.test(name) && !common.test(name) && occurrences.length >= 2;
    const persistentEndpoint = transitionUnit && units.find((unit) => unit.order > transitionUnit.order &&
      new RegExp(`\\bthe\\s+${esc(name.replace(/^(?:the|a|an) /iu, ""))}\\s+`, "iu").test(unit.text));
    const explicitlyNamed = /\p{Lu}/u.test(name) ? occurrences.find((unit) => new RegExp(`\\b(?:named|called)\\s+${esc(name)}(?=[,.;]|$)`, "u").test(unit.text)) : undefined;
    if ((!proper(name) && !repeated && !explicitlyNamed && !persistentEndpoint) || !occurrences.length) return null;
    const first = request.evidenceUnits.filter((unit) => has(unit.text, name)).sort((a, b) => a.order - b.order)[0];
    const canonicalId = `candidate:${createHash("sha256").update(JSON.stringify([request.requestId, norm(name), first.unitId])).digest("hex")}`;
    const grounding = proper(name) ? [occurrences[0]] : explicitlyNamed ? [explicitlyNamed] :
      persistentEndpoint && transitionUnit ? [transitionUnit, persistentEndpoint] : occurrences.slice(0, 2);
    const record: CandidateEntity = { canonicalId, name, type: explicitType(name, grounding), aliases: [], origin: "reconciliation_candidate",
      evidence: grounding.map((unit) => evidence(unit, true)), firstSourceOccurrence: {
        unitId: first.unitId, sourceOrder: first.order, page: first.page, start: first.rawSource.start } };
    candidates.push(record);
    return record;
  };
  const names = [...new Set([...request.entities.flatMap((entity) => [entity.name, ...entity.aliases]),
    ...output.claims.flatMap((claim) => claim.participants)])];
  // Explicit identity relations are source assertions, not a search for nearby antecedents.
  // Index them once; only Stage 7 coreference uses the bounded local context window.
  const relations = request.evidenceUnits.flatMap((unit) => {
    const presentNames = names.filter((name) => has(unit.text, name) || has(unit.text, name.replace(/^(?:the|a|an) /iu, "")));
    return presentNames.flatMap((from) => presentNames.flatMap((to) => {
      if (norm(from) === norm(to)) return [];
      const alias = new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc(from)}\\s*,?\\s+(?:(?:is|was)\\s+)?(?:also called|also known as|formerly known as|known as|called|became known as|renamed|now called|another name for|an alias of|a nickname for)\\s+${esc(to)}|${esc(from)}['’]s\\s+(?:alias|nickname)\\s+is\\s+${esc(to)})(?=[,.;]|$)`, "iu");
      const transition = new RegExp(`(?<![\\p{L}\\p{N}])${esc(from)}\\s+(?:became|returned as|transformed into|turned into|was transformed into|was reincarnated as|reincarnated as)\\s+(?:(?:a|an|the)\\s+)?${esc(to.replace(/^(?:the|a|an) /iu, ""))}(?=[,.;]|$)`, "iu");
      return alias.test(unit.text) || transition.test(unit.text) ? [{ unit, from, to, alias, transition }] : [];
    }));
  });
  const ambiguousAliases = new Set(names.filter((name) => {
    const targets = relations.filter((relation) => relation.alias.test(relation.unit.text) &&
      [norm(relation.from), norm(relation.to)].includes(norm(name))).flatMap((relation) => {
      const opposite = norm(relation.from) === norm(name) ? relation.to : relation.from;
      const entity = exact(request.entities, opposite);
      return entity ? [entity.canonicalId] : [];
    });
    return new Set(targets).size > 1;
  }).map(norm));
  const claims: ReconciledClaimV22[] = output.claims.map((original, proposalIndex) => {
    const direct = original.evidence_unit_ids.map((id) => byId.get(id)).filter((unit): unit is Unit => !!unit);
    const nearby = localUnits(request, direct);
    const used = new Map<string, Unit>();
    const use = (unit: Unit) => { if (!direct.includes(unit)) used.set(unit.unitId, unit); };
    const resolve = (mention: string, entity: Entity, units: Unit[] = []): ParticipantResolutionV22 => {
      units.forEach(use);
      return { mention, kind: request.entities.some((item) => item.canonicalId === entity.canonicalId) ? "canonical_entity" : "candidate_entity",
        canonicalId: entity.canonicalId, canonicalName: entity.name, supportingEvidence: units.map((unit) => evidence(unit, direct.includes(unit))) };
    };
    const wikiDisposition = mechanicalOnly(original.statement) ? "mechanical_only" : "present";
    const source = sourceMetadata(original.statement, direct, timeline);
    // Stage 2 locks inventory matches before any identity, candidate or descriptor rule.
    const participants: ParticipantResolutionV22[] = original.participants.map((mention) => {
      const entity = wikiDisposition === "present" ? exact(request.entities, mention) : null;
      return entity ? resolve(mention, entity) : { mention, kind: "unresolved", canonicalId: null, canonicalName: null, supportingEvidence: [] };
    });
    const identityRelations: IdentityRelationV22[] = [];
    if (wikiDisposition === "present") {
      // Stage 3: explicit source relations only; no co-occurrence or lexical identity inference.
      for (const { unit, from, to, alias, transition } of relations) {
        if (!participants.some((item) => item.kind === "unresolved" && [norm(from), norm(to)].includes(norm(item.mention))) &&
          !transition.test(original.statement)) continue;
        if (alias.test(unit.text)) {
          const left = lookup(from), right = lookup(to);
          if (left && right && left.canonicalId !== right.canonicalId) continue;
          const entity = left ?? right ?? candidate(from, [unit]) ?? candidate(from, request.evidenceUnits);
          if (!entity) continue;
          const alternateName = norm(entity.name) === norm(from) ? to : from;
          if (candidates.includes(entity as CandidateEntity) && !entity.aliases.includes(alternateName)) entity.aliases.push(alternateName);
          aliasMetadata.push({ entityId: entity.canonicalId, alias: alternateName, evidence: evidence(unit, direct.includes(unit)) });
          for (const [index, item] of participants.entries()) if (item.kind === "unresolved" && !ambiguousAliases.has(norm(item.mention)) && [norm(from), norm(to)].includes(norm(item.mention)))
            participants[index] = resolve(item.mention, entity, [unit]);
          identityRelations.push({ kind: "same_identity_alias", entityId: entity.canonicalId, alternateName, sourceUnitId: unit.unitId,
            sourceClaimIndex: output.claims.findIndex((claim) => claim.evidence_unit_ids.includes(unit.unitId) && alias.test(claim.statement)) >= 0 ?
              output.claims.findIndex((claim) => claim.evidence_unit_ids.includes(unit.unitId) && alias.test(claim.statement)) : null });
        } else {
          const sourceClaimIndex = original.evidence_unit_ids.includes(unit.unitId) && transition.test(original.statement) ? proposalIndex :
            output.claims.findIndex((claim) => claim.evidence_unit_ids.includes(unit.unitId) && transition.test(claim.statement));
          // A transition requires an already extracted relationship and two independently grounded endpoints.
          if (sourceClaimIndex < 0) continue;
          const left = lookup(from) ?? candidate(from, [unit]) ?? candidate(from, nearby);
          const right = lookup(to) ?? candidate(to, [unit], unit) ?? candidate(to, nearby, unit);
          if (!left || !right || left.canonicalId === right.canonicalId) continue;
          for (const [index, item] of participants.entries()) if (item.kind === "unresolved") {
            if (norm(item.mention) === norm(from)) participants[index] = resolve(item.mention, left, [unit]);
            if (norm(item.mention) === norm(to)) participants[index] = resolve(item.mention, right, [unit]);
          }
          identityRelations.push({ kind: "identity_transition", fromEntityId: left.canonicalId, toEntityId: right.canonicalId, sourceUnitId: unit.unitId, sourceClaimIndex });
        }
      }
      // Stage 4 completes for all participants before descriptors can inspect candidates.
      for (const [index, item] of participants.entries()) {
        if (item.kind !== "unresolved") continue;
        if (partyForm.test(item.mention) || ambiguousAliases.has(norm(item.mention))) continue;
        const entity = candidate(item.mention, direct) ?? candidate(item.mention, nearby);
        if (entity) {
          const grounding = candidates.find((entry) => entry.canonicalId === entity.canonicalId)?.evidence ?? [];
          const units = grounding.map((entry) => byId.get(entry.unitId)).filter((unit): unit is Unit => !!unit && nearby.includes(unit));
          participants[index] = resolve(item.mention, entity, units);
        }
      }
      // Stage 5: explicit dependent relationships only.
      for (const [index, item] of participants.entries()) {
        if (item.kind !== "unresolved") continue;
        if (ambiguousAliases.has(norm(item.mention))) continue;
        const parent = parentFor(item.mention, direct, allEntities());
        if (parent) { participants[index] = { mention: item.mention, kind: "descriptor", canonicalId: parent.entity.canonicalId,
          canonicalName: parent.entity.name, supportingEvidence: [evidence(parent.unit, true)] }; continue; }
      }
      // Stage 6 leaves potentially unique definite references for bounded coreference.
      for (const [index, item] of participants.entries()) {
        if (item.kind !== "unresolved") continue;
        if (ambiguousAliases.has(norm(item.mention))) continue;
        if (!reference(item.mention) && common.test(item.mention)) {
          participants[index] = { ...item, kind: "generic_non_entity" }; continue;
        }
      }
      // Stage 7: only evidence actually establishing the reference is recorded.
      for (const [index, item] of participants.entries()) {
        if (item.kind !== "unresolved") continue;
        if (ambiguousAliases.has(norm(item.mention))) continue;
        const party = request.entities.find((entity) => entity.canonicalId === "system:heroes-party");
        if (party && partyForm.test(item.mention) &&
          direct.some((unit) => /\b(?:the heroes|the party|the characters|player characters|pcs|the adventurers)\b/iu.test(unit.text)) &&
          !direct.some((unit) => /\b(?:hero role|(?:npc|monster|creature|villager) (?:party|heroes|adventurers)|(?:thousands|hundreds|dozens) of (?:heroes|adventurers))\b/iu.test(unit.text))) {
          participants[index] = resolve(item.mention, party, direct);
          continue;
        }
        if (!reference(item.mention)) continue;
        const matches = nearby.flatMap((unit) => allEntities().flatMap((anchor) => {
          const explicit = !pronoun.test(item.mention) && new RegExp(`${esc(anchor.name)}\\s*,?\\s+(?:is |was )?(?:a |an |the )?${esc(item.mention.replace(/^the /iu, ""))}(?=[,.;]|$)`, "iu").test(unit.text);
          const onlySubject = pronoun.test(item.mention) && unit.order < Math.min(...direct.map((entry) => entry.order)) &&
            new RegExp(`^${esc(anchor.name)}\\s+(?:rests?|waits?|sleeps?|slept|died|dies|left|arrived)\\s*[.!?]?$`, "iu").test(unit.text);
          return explicit || onlySubject ? [{ anchor, unit }] : [];
        }));
        if (new Set(matches.map((match) => match.anchor.canonicalId)).size === 1) participants[index] = resolve(item.mention, matches[0].anchor, [matches[0].unit]);
      }
    }
    // Stage 8: many-to-many associations, including both endpoints of the existing transition claim.
    const associations = participants.filter((item) => item.canonicalId).map((item) => ({ canonicalId: item.canonicalId!, canonicalName: item.canonicalName! }));
    for (const relation of identityRelations) if (relation.kind === "identity_transition" && relation.sourceClaimIndex === proposalIndex)
      for (const id of [relation.fromEntityId, relation.toEntityId]) {
        const entity = allEntities().find((item) => item.canonicalId === id)!;
        associations.push({ canonicalId: id, canonicalName: entity.name });
      }
    const entityAssociations = [...new Map(associations.map((item) => [item.canonicalId, item])).values()];
    // Stages 9–10: structural provenance and claim-specific discrepancies; no inherited lexical guesses.
    const reviewReasons: string[] = [];
    if (direct.length !== original.evidence_unit_ids.length) reviewReasons.push("unknown_evidence_unit");
    if (new Set(original.evidence_unit_ids).size !== original.evidence_unit_ids.length) reviewReasons.push("duplicate_evidence_unit");
    if (direct.some((unit) => unit.kind !== "sentence")) reviewReasons.push("heading_is_context_only");
    if ([...direct, ...used.values()].some((unit) => unit.rawSource.page !== unit.page || unit.rawSource.start < 0 || !unit.rawSource.text.trim() ||
      unit.rawSource.end - unit.rawSource.start !== unit.rawSource.text.length)) reviewReasons.push("invalid_source_mapping");
    if (discrepancy(original.statement, [...direct, ...used.values()])) reviewReasons.push("source_discrepancy");
    if (participants.some((item) => item.kind === "unresolved")) reviewReasons.push("unresolved_participant");
    if (!entityAssociations.length && !source.timelineAssociation) reviewReasons.push("no_useful_home");
    const directEvidence = direct.map((unit) => evidence(unit, true));
    const contextEvidence = [...used.values()].sort((a, b) => a.order - b.order).map((unit) => evidence(unit, false));
    return { requestId: request.requestId, proposalIndex, original: structuredClone(original), wikiDisposition,
      resolutionState: wikiDisposition === "mechanical_only" ? null : reviewReasons.length ? "needs_review" : "resolved",
      reviewReasons: wikiDisposition === "mechanical_only" ? [] : reviewReasons, sourceStatus: source.sourceStatus,
      participants, entityAssociations, timelineAssociation: wikiDisposition === "mechanical_only" ? null : source.timelineAssociation,
      evidence: [...directEvidence, ...contextEvidence], directEvidence, contextEvidence, identityRelations,
      sourceOrder: direct.length ? Math.min(...direct.map((unit) => unit.order)) : null };
  });
  return { version: CLAIMS_4_1_RECONCILIATION_V2_2_VERSION, rawProposals, claims, candidateEntities: candidates, aliasMetadata,
    gmReview: claims.filter((claim) => claim.resolutionState === "needs_review"), diagnostics: {
      proposed: claims.length, resolved: claims.filter((claim) => claim.resolutionState === "resolved").length,
      needsReview: claims.filter((claim) => claim.resolutionState === "needs_review").length,
      mechanicalOnly: claims.filter((claim) => claim.wikiDisposition === "mechanical_only").length } };
}
