import { createHash } from "node:crypto";
import { claims41OutputSchema, type Claims41Output, type Claims41Request, type SourceStatus } from "./claims-4-1-experiment";
import type { ReconciledClaimV2, TimelineAssociation } from "./claims-4-1-reconciliation-v2";
import type { CandidateEntity, ParticipantResolutionV22, IdentityRelationV22, ReconciledClaimV22 } from "./claims-4-1-reconciliation-v2-2";
import { normalizeName as norm } from "../graph/normalize";

export const CLAIMS_4_1_RECONCILIATION_V2_2_1_VERSION = "claims-4-1-reconciliation-2.2.1";
type Unit = Claims41Request["evidenceUnits"][number];
type Entity = Claims41Request["entities"][number];
type Evidence = ReconciledClaimV2["evidence"][number];
export type ParticipantResolutionV221 = ParticipantResolutionV22;
export type CandidateEntityV221 = CandidateEntity;
export type IdentityRelationV221 =
  | Exclude<IdentityRelationV22, { kind: "same_identity_alias" }>
  | (Extract<IdentityRelationV22, { kind: "same_identity_alias" }> & { sourceClaimIndex: number });
export interface ReconciledClaimV221 extends Omit<ReconciledClaimV22, "identityRelations"> {
  identityRelations: IdentityRelationV221[];
}
const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namePattern = (name: string) => esc(name).replace(/['’]/gu, "['’]").replace(/\s+/gu, "\\s+");
const has = (text: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${namePattern(name)}(?![\\p{L}\\p{N}])`, "iu").test(text);
const evidence = (unit: Unit, direct: boolean): Evidence => ({ unitId: unit.unitId, page: unit.page,
  start: unit.rawSource.start, end: unit.rawSource.end, text: unit.rawSource.text, direct });
const common = /^(?:(?:a|an|some|several|many|ordinary|unnamed|the)\s+)?(?:creatures?|monsters?|people|persons?|guards?|soldiers?|agents?|students?|bookkeepers?|swords?|objects?|doors?|walls?|water|fire|damage|effects?|spells?|supplies|treasure|gold|stone|wood|iron|steel|glass|copper|sand|soil|dirt|ice|snow|light|darkness|magic)$/iu;
const rolePatterns = ["diplomatic envoys?", "guards?", "agents?", "students?", "staff", "arm(?:y|ies)", "fleets?", "envoys?", "messengers?", "priests?", "clergy", "servants?", "followers?", "nobles?", "loyalists?", "forces?", "citizens?", "inhabitants?", "bookkeepers?", "rooms?", "chambers?", "storerooms?", "gates?", "siege engines?"];
const subordinate = new RegExp(`\\b(?:${rolePatterns.join("|")})\\b`, "iu");
const pronoun = /^(?:he|she|it|they|him|her|them|his|its|their)$/iu;
const partyForm = /^(?:Heroes \/ Party|(?:the )?(?:heroes|party|characters|adventurers|pcs|player characters))$/iu;
// Lowercase definite references are considered before generic classification.
const reference = (name: string) => pronoun.test(name) || /^(?:the|The)\s+\p{Ll}/u.test(name);
const proper = (name: string) => !subordinate.test(name) && !common.test(name) && !reference(name) &&
  !/^(?:a|an|native|local|some|several|many|ordinary|unnamed|captured|generic)\s+/iu.test(name) &&
  /^(?:The\s+)?\p{Lu}[\p{L}'’-]*(?:\s+(?:of|the|\p{Lu}[\p{L}'’-]*))*$/u.test(name);

function mechanicalOnly(statement: string): boolean {
  // Recognize complete procedural clauses. An unrecognized clause keeps the whole claim present.
  const mechanic = /\b(?:DC\s*\d+|\d+d\d+|(?:skill|ability|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) checks?|saving throws?|(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saves?|attack rolls?|attack bonus|to.hit|reach \d+ (?:ft|feet)|armo[u]?r class|AC\s*\d+|hit points?|HP\s*\d+|movement|speed|initiative|immune|immunit(?:y|ies)|resistant|resistances?|vulnerable|vulnerabilit(?:y|ies)|repeat.{0,15}(?:save|check)|damage|(?:gains?|loses?|appl(?:y|ies)|removes?)\s+(?:the\s+)?\w+\s+condition)\b/iu;
  const narrative = /\b(?:guards|rules|governs|lives|located|contains|commands|travels|arrives|discovers|reveals|belongs|serves|captures|collapses|attacks|kills|destroys|opens|built|founded|born|created|became|returned|transformed|reincarnated|dies|died|fled|ruled|lived|served|owned|stole|stolen|because)\b/iu;
  // A threshold-triggered encounter instruction is procedure even when its action sounds narrative.
  const threshold = /^(?:when|if|once)\s+(?:.+?\s+)?(?:reduced to|below|at|has fewer than|drops? to)\s*\d+\s*(?:hit points?|HP)\s*,\s*(?:the\s+)?[\p{L}\s'-]+?\s+(?:flees?|retreats?|attacks?|uses?|makes?|moves?)\b[^;.!?]*(?:[.!?])?$/iu;
  if (threshold.test(statement) && !/\b(?:and|but|because|after|before|founded|built|born|died)\b/iu.test(statement)) return true;
  const fields = "(?:AC|armo[u]?r class|HP|hit points?|immune|immunit(?:y|ies)|resistant|resistances?|vulnerable|vulnerabilit(?:y|ies)|attack bonus|to.hit|damage|saving throws?|(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) (?:saves?|checks?)|ability checks?|skill checks?|DC|movement|speed|initiative|reach|(?:melee|ranged) (?:weapon |spell )?attack|hit)";
  const statClause = new RegExp(`^(?:(?:.+?\\s+(?:has|have|is|are|gains?|loses?)\\s+)(?:an?\\s+)?)?${fields}\\b`, "iu");
  const procedure = /^(?:repeat|roll|make|attempt|apply|remove)\b|\b(?:must|can|may)?\s*(?:makes?|rolls?|attempts?|repeats?|deals?|takes?|gains?|loses?|applies|removes?)\b/iu;
  const clauses = statement.split(/[;.!?]|\s+(?:and|but|while|when|if|after|before)\s+/iu).filter((clause) => clause.trim());
  return clauses.every((clause, index) => {
    if (index > 0 && /\b(?:immune|immunit(?:y|ies)|resistant|resistances?|vulnerable|vulnerabilit(?:y|ies)|damage)\b/iu.test(clauses[index - 1]) &&
      /^\s*(?:fire|cold|poison|acid|lightning|thunder|necrotic|radiant|psychic|force|bludgeoning|piercing|slashing)\s*$/iu.test(clause)) return true;
    if (/^(?:Multiattack|Actions|Bonus Actions|Reactions)\s*:?$/iu.test(clause.trim())) return clauses.length > 1;
    if (/^(?:the\s+)?[\p{L}\s'-]+?\s+(?:makes?|uses?)\s+(?:one|two|three|\d+)\s+(?:attacks?|actions?)\s+(?:each|per|on (?:each|its))\s+(?:turn|round)\s*$/iu.test(clause.trim())) return true;
    return mechanic.test(clause) && (statClause.test(clause.trim()) || procedure.test(clause)) && !narrative.test(clause) &&
      !/\b(?:is|was|are|were)\s+(?:a|an|the)\s+(?!DC\b|AC\b|HP\b|hit points?\b|armor class\b|damage\b|movement\b|speed\b|initiative\b|\d)\p{L}/iu.test(clause);
  });
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
function descriptorMatches(mention: string, units: Unit[], entities: Entity[]): Array<{ entity: Entity; unit: Unit }> {
  if (!subordinate.test(mention)) return [];
  const role = rolePatterns.find((pattern) => new RegExp(`\\b${pattern}\\b`, "iu").test(mention))!;
  return entities.flatMap((entity) => {
    const relations = [entity.name, ...entity.aliases].map((name) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc(name)}['’]s\\s+${role}|${role}\\s+of\\s+(?:the\\s+)?${esc(name)}|${esc(name)}\\s+${role})(?![\\p{L}\\p{N}])`, "iu"));
    const sourceRelations = [entity.name, ...entity.aliases].map((name) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc(name)}['’]s\\s+${role}|${role}\\s+of\\s+(?:the\\s+)?${esc(name)}|${esc(name)}\\s+${role}(?=\\s+(?:is|are|was|were|has|have|had|waits?|rests?|stands?|patrols?|serves?|remains?|entered|enters?|opens?)\\b))(?![\\p{L}\\p{N}])`, "iu"));
    // Retain v2's narrow, mechanically derived adjective; never supply campaign demonyms.
    const adjective = /^[\p{L}]+$/u.test(entity.name) ? /a$/iu.test(entity.name) ? `${entity.name}n` :
      /e$/iu.test(entity.name) ? `${entity.name.slice(0, -1)}ian` : null : null;
    if (adjective) {
      const national = new RegExp(`(?<![\\p{L}])${esc(adjective)}\\s+(?:imperial\\s+)?${role}\\b`, "iu");
      relations.push(national); sourceRelations.push(national);
    }
    const roleOnly = new RegExp(`^(?:the\\s+)?${role}$`, "iu").test(mention);
    return units.filter((unit) => (roleOnly || relations.some((relation) => relation.test(mention))) &&
      sourceRelations.some((relation) => relation.test(unit.text))).map((unit) => ({ entity, unit }));
  });
}
function parentFor(mention: string, units: Unit[], entities: Entity[]): { entity: Entity; unit: Unit } | null {
  const matches = descriptorMatches(mention, units, entities);
  return new Set(matches.map((match) => match.entity.canonicalId)).size === 1 ? matches[0] : null;
}

const transitionVerb = "(?:was transformed into|was reincarnated as|transformed into|reincarnated as|returned as|turned into|became)";
const withoutArticle = (name: string) => name.replace(/^(?:the|a|an)\s+/iu, "");
// This one parser is used for both source and proposal statements. No cross-clause bridging.
function transitions(text: string): Array<{ from: string; to: string }> {
  return text.split(/[.;?!]/u).flatMap((clause) => {
    const match = clause.trim().match(new RegExp(`^(.+?)\\s+${transitionVerb}\\s+(.+?)\\s*$`, "iu"));
    if (!match) return [];
    const from = match[1].trim();
    const tail = match[2].trim();
    // A naming change has no independently persistent second form.
    if (/^(?:known as|called|named)\s+/iu.test(tail)) return [];
    const bridge = tail.match(/^(.+?)\s+(?:known as|called|named)\s+(.+)$/iu);
    if (bridge && bridge[1].trim().split(/\s+/u).length > 12) return [];
    const to = withoutArticle(bridge ? bridge[2].trim() : tail);
    // Unparsed trailing clauses cannot establish an endpoint designation.
    if (/[,]/u.test(from + to) || !/^[\p{L}\p{N}'’ -]+$/u.test(to)) return [];
    return [{ from, to }];
  });
}
function aliasPattern(from: string, to: string) {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc(from)}\\s*,?\\s+(?:(?:is|was)\\s+)?(?:also called|also known as|formerly known as|known as|called|became known as|renamed|now called|another name for|an alias of|a nickname for)\\s+${esc(to)}|${esc(from)}['’]s\\s+(?:alias|nickname)\\s+is\\s+${esc(to)})(?=[,.;?!]|$)`, "iu");
}
const classifying = "(?:native|local|several|many|some|ordinary|captured|generic)";
function referential(text: string, name: string): boolean {
  const matches = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, "giu"))];
  return matches.some((match) => !new RegExp(`\\b${classifying}\\s+(?:[\\p{L}-]+\\s+){0,2}$`, "iu").test(text.slice(0, match.index)));
}
function bareReferential(text: string, name: string): boolean {
  const predicates = [...text.matchAll(new RegExp(`(?:^|[.;?!]\\s*)${namePattern(name)}\\s+([^.;?!]+)`, "giu"))];
  return predicates.some((match) => {
    const predicate = match[1].trim();
    if (/^(?:is|was)\s+(?:a|an|some|several|many|generic|ordinary|class|type|species)\b/iu.test(predicate)) return false;
    // A bare subject plus a finite verb, with an explicit complement boundary. This avoids
    // mistaking compound classes such as "wraith guards are ..." for entity references.
    return /^(?:is|was|has|had)\s+(?!are\b|were\b)/iu.test(predicate) ||
      /^[\p{Ll}]+(?:s|ed)\s*(?:$|,|\s+(?:the|a|an|his|her|its|their|at|in|on|by|to|from|with|without|through|under|over|near|outside|inside|away|again|here|there)\b)/u.test(predicate);
  });
}
function generic(mention: string): boolean {
  if (reference(mention) || /\p{Lu}/u.test(mention) || /^the\s+/iu.test(mention)) return false;
  if (/^(?:a|an|some|several|many|ordinary|unnamed|captured|generic)\s+[\p{Ll}\s'-]+$/u.test(mention)) return true;
  // Inflection and known common collective/object heads are evidence of non-unique noun phrases.
  // Unknown singular phrases remain unresolved rather than being guessed from capitalization.
  const head = mention.trim().split(/\s+/u).at(-1)!;
  return /^[\p{Ll}\s'-]+$/u.test(mention) &&
    (/^[\p{Ll}]+(?:s|men|women)$/u.test(head) && !/(?:ness|ous|is|us|ss)$/u.test(head) ||
      /^(?:people|staff|clergy|army|fleet|water|fire|gold|stone|wood|iron|steel|glass|copper|sand|soil|dirt|ice|snow|light|darkness|magic|damage|treasure)$/u.test(head) || common.test(mention));
}

function antecedent(referenceName: string, nearby: Unit[], direct: Unit[], entities: Entity[]): { anchor: Entity; unit: Unit } | null {
  const matches = nearby.flatMap((unit) => entities.flatMap((anchor) => {
    const names = [anchor.name, ...anchor.aliases];
    const explicit = !pronoun.test(referenceName) && names.some((name) => new RegExp(`${esc(name)}\\s*,?\\s+(?:is |was )?(?:a |an |the )?${esc(withoutArticle(referenceName))}(?=[,.;?!]|$)`, "iu").test(unit.text));
    const soleSubject = pronoun.test(referenceName) && unit.order < Math.min(...direct.map((entry) => entry.order)) &&
      names.some((name) => new RegExp(`^${esc(name)}\\s+(?:rests?|waits?|sleeps?|slept|died|dies|left|arrived|entered|enters|opened|opens)\\b`, "iu").test(unit.text) &&
        !/\p{Lu}/u.test(unit.text.slice(name.length))) &&
      !entities.some((other) => other.canonicalId !== anchor.canonicalId && [other.name, ...other.aliases].some((name) => has(unit.text, name)));
    return explicit || soleSubject ? [{ anchor, unit }] : [];
  }));
  return new Set(matches.map((match) => match.anchor.canonicalId)).size === 1 ? matches.sort((a, b) => b.unit.order - a.unit.order)[0] : null;
}

const skeleton = (text: string) => text.toLocaleLowerCase("en-US").normalize("NFKC")
  .replace(/['’]/gu, "'").replace(/\b(?:the|a|an)\s+(?=<entity>)/gu, "")
  .replace(/[^\p{L}\p{N}<>]+/gu, " ").trim().replace(/\s+/gu, " ");
function substitution(statement: string, participants: ParticipantResolutionV22[], direct: Unit[], entities: Entity[], relations: IdentityRelationV22[]): boolean {
  const named = participants.filter((item) => item.kind === "canonical_entity" || item.kind === "candidate_entity");
  const spans = (text: string, entity: Entity) => [entity.name, ...entity.aliases].flatMap((name) =>
    [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${namePattern(name)}(?![\\p{L}\\p{N}])`, "giu"))]);
  for (const participant of named) {
    const a = entities.find((entity) => entity.canonicalId === participant.canonicalId)!;
    const claimSpans = spans(statement, a);
    if (claimSpans.length !== 1) continue;
    for (const unit of direct) for (const b of entities) {
      if (a.canonicalId === b.canonicalId) continue;
      if (relations.some((relation) => relation.kind === "identity_transition" &&
        [relation.fromEntityId, relation.toEntityId].includes(a.canonicalId) && [relation.fromEntityId, relation.toEntityId].includes(b.canonicalId))) continue;
      const sourceSpans = spans(unit.text, b);
      if (sourceSpans.length !== 1) continue;
      const replace = (text: string, span: RegExpMatchArray) => text.slice(0, span.index!) + "<ENTITY>" + text.slice(span.index! + span[0].length);
      const claimSkeleton = skeleton(replace(statement, claimSpans[0]));
      // A may appear elsewhere in the evidence unit; only its matching proposition position matters.
      if (spans(unit.text, a).some((span) => ` ${skeleton(replace(unit.text, span))} `.includes(` ${claimSkeleton} `))) continue;
      const sourceSkeleton = skeleton(replace(unit.text, sourceSpans[0]));
      if (` ${sourceSkeleton} `.includes(` ${claimSkeleton} `)) return true;
    }
  }
  return false;
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

export function reconcileClaims41V221(output: Claims41Output, request: Claims41Request) {
  claims41OutputSchema.parse(output); // Validate without replacing or trimming the frozen proposals.
  const rawProposals = structuredClone(output);
  // Stage 1 precedes identity precomputation and all entity creation/attachment.
  const dispositions = output.claims.map((claim) => mechanicalOnly(claim.statement) ? "mechanical_only" as const : "present" as const);
  const timeline = timelineByUnit(request);
  const byId = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
  const candidates: CandidateEntity[] = [];
  const aliasMetadata: Array<{ entityId: string; alias: string; evidence: Evidence; sourceClaimIndex: number }> = [];
  const allEntities = () => [...request.entities, ...candidates];
  const lookup = (name: string) => exact(allEntities(), name);
  const ordered = [...request.evidenceUnits].sort((a, b) => a.order - b.order);
  const parsedClaims = output.claims.map((claim, index) => dispositions[index] === "present" ? transitions(claim.statement) : []);
  const endpointNames = new Set(parsedClaims.flatMap((pairs) => pairs.map((pair) => norm(pair.to))));
  const candidate = (name: string, units: Unit[], transitionUnit?: Unit): Entity | null => {
    const existing = lookup(name);
    if (existing) return existing;
    const occurrences = units.filter((unit) => has(unit.text, name));
    const repeated = /^the\s+/iu.test(name) && !subordinate.test(name) && !common.test(name) && occurrences.length >= 2;
    const later = transitionUnit ? ordered.filter((unit) => unit.order > transitionUnit.order) : [];
    const definite = later.find((unit) => new RegExp(`\\bthe\\s+${esc(withoutArticle(name))}(?![\\p{L}\\p{N}])`, "iu").test(unit.text));
    const bare = later.filter((unit) => bareReferential(unit.text, withoutArticle(name)));
    const persistent = definite ? [definite] : bare.length >= 2 ? bare.slice(0, 2) : [];
    const explicitlyNamed = occurrences.find((unit) => explicitType(name, [unit]) !== "other" &&
      new RegExp(`\\b(?:named|called|known as)\\s+${esc(name)}(?=[,.;?!]|$)`, "iu").test(unit.text));
    const properOccurrence = proper(name) && occurrences.find((unit) => referential(unit.text, name));
    if (!occurrences.length || (!properOccurrence && !repeated && !explicitlyNamed && !persistent.length)) return null;
    if (endpointNames.has(norm(name)) && !proper(name) && !persistent.length) return null;
    const first = request.evidenceUnits.filter((unit) => has(unit.text, name)).sort((a, b) => a.order - b.order)[0];
    const canonicalId = `candidate:${createHash("sha256").update(JSON.stringify([request.requestId, norm(name), first.unitId])).digest("hex")}`;
    const grounding = transitionUnit && persistent.length ? [transitionUnit, ...persistent] : explicitlyNamed ? [explicitlyNamed] :
      properOccurrence ? [properOccurrence] : occurrences.slice(0, 2);
    const record: CandidateEntity = { canonicalId, name, type: explicitType(name, grounding), aliases: [], origin: "reconciliation_candidate",
      evidence: grounding.map((unit) => evidence(unit, true)), firstSourceOccurrence: {
        unitId: first.unitId, sourceOrder: first.order, page: first.page, start: first.rawSource.start } };
    candidates.push(record);
    return record;
  };
  const names = [...new Set([...request.entities.flatMap((entity) => [entity.name, ...entity.aliases]),
    ...output.claims.flatMap((claim) => claim.participants), ...parsedClaims.flatMap((pairs) => pairs.flatMap((pair) => [pair.from, pair.to]))])];
  // Explicit identity relations are source assertions, not a search for nearby antecedents.
  // Index them once; only Stage 7 coreference uses the bounded local context window.
  const relations = ordered.flatMap((unit) => {
    const presentNames = names.filter((name) => has(unit.text, name) || has(unit.text, name.replace(/^(?:the|a|an) /iu, "")));
    return presentNames.flatMap((from) => presentNames.flatMap((to) => {
      if (norm(from) === norm(to)) return [];
      const alias = aliasPattern(from, to);
      const transition = { test: (text: string) => transitions(text).some((pair) => norm(pair.from) === norm(from) && norm(pair.to) === norm(withoutArticle(to))) };
      // Transition endpoint spelling comes from the shared parser, not article variants in participants.
      if (transition.test(unit.text) && !transitions(unit.text).some((pair) => norm(pair.from) === norm(from) && norm(pair.to) === norm(to))) return [];
      const sourceClaimIndex = output.claims.findIndex((claim, index) => dispositions[index] === "present" && claim.evidence_unit_ids.includes(unit.unitId) &&
        (alias.test(unit.text) && alias.test(claim.statement) || transition.test(unit.text) && transition.test(claim.statement)));
      return sourceClaimIndex >= 0 ? [{ unit, from, to, alias, transition, sourceClaimIndex }] : [];
    }));
  });
  const aliasComponent = (name: string) => {
    const connected = new Set([norm(name)]);
    for (let pass = 0; pass < names.length; pass++) for (const relation of relations) {
      if (!relation.alias.test(relation.unit.text)) continue;
      if (connected.has(norm(relation.from)) || connected.has(norm(relation.to))) {
        connected.add(norm(relation.from)); connected.add(norm(relation.to));
      }
    }
    return names.filter((label) => connected.has(norm(label)));
  };
  const componentAnchors = (name: string) => [...new Map(aliasComponent(name).flatMap((label) => {
    const entity = exact(request.entities, label);
    return entity ? [[entity.canonicalId, entity] as const] : [];
  })).values()];
  const ambiguousAliases = new Set(names.filter((name) => componentAnchors(name).length > 1).map(norm));
  const identityEntities = new Map<string, { entity: Entity; unit: Unit }>();
  const precomputed: IdentityRelationV221[] = [];
  for (let pass = 0; pass <= relations.length; pass++) {
    let progress = false;
    for (const { unit, from, to, alias, transition, sourceClaimIndex } of relations) {
      if (precomputed.some((item) => item.sourceUnitId === unit.unitId && item.sourceClaimIndex === sourceClaimIndex &&
        (item.kind === "same_identity_alias" ? item.alternateName === to || item.alternateName === from :
          identityEntities.get(norm(from))?.entity.canonicalId === item.fromEntityId && identityEntities.get(norm(to))?.entity.canonicalId === item.toEntityId))) continue;
      if (alias.test(unit.text)) {
        if (ambiguousAliases.has(norm(from)) || ambiguousAliases.has(norm(to))) continue;
        const left = identityEntities.get(norm(from))?.entity ?? lookup(from), right = identityEntities.get(norm(to))?.entity ?? lookup(to);
        if (left && right && left.canonicalId !== right.canonicalId) continue;
        const entity = componentAnchors(from)[0] ?? left ?? right ?? candidate(from, [unit]);
        if (!entity) continue;
        const alternateName = norm(entity.name) === norm(from) ? to : from;
        identityEntities.set(norm(from), { entity, unit });
        identityEntities.set(norm(to), { entity, unit });
        if (candidates.includes(entity as CandidateEntity) && !entity.aliases.includes(alternateName)) entity.aliases.push(alternateName);
        aliasMetadata.push({ entityId: entity.canonicalId, alias: alternateName, evidence: evidence(unit, true), sourceClaimIndex });
        precomputed.push({ kind: "same_identity_alias", entityId: entity.canonicalId, alternateName, sourceUnitId: unit.unitId, sourceClaimIndex });
      } else if (transition.test(unit.text)) {
        const left = identityEntities.get(norm(from))?.entity ?? lookup(from) ?? candidate(from, [unit]);
        const right = lookup(to) ?? candidate(to, [unit], unit);
        if (!left || !right || left.canonicalId === right.canonicalId) continue;
        identityEntities.set(norm(from), { entity: left, unit });
        identityEntities.set(norm(to), { entity: right, unit });
        precomputed.push({ kind: "identity_transition", fromEntityId: left.canonicalId, toEntityId: right.canonicalId, sourceUnitId: unit.unitId, sourceClaimIndex });
      } else continue;
      progress = true;
    }
    if (!progress) break;
  }
  const claims: ReconciledClaimV221[] = output.claims.map((original, proposalIndex) => {
    const direct = original.evidence_unit_ids.map((id) => byId.get(id)).filter((unit): unit is Unit => !!unit);
    const nearby = localUnits(request, direct);
    const used = new Map<string, Unit>();
    const use = (unit: Unit) => { if (!direct.includes(unit)) used.set(unit.unitId, unit); };
    const resolve = (mention: string, entity: Entity, units: Unit[] = []): ParticipantResolutionV22 => {
      units.forEach(use);
      return { mention, kind: request.entities.some((item) => item.canonicalId === entity.canonicalId) ? "canonical_entity" : "candidate_entity",
        canonicalId: entity.canonicalId, canonicalName: entity.name, supportingEvidence: units.map((unit) => evidence(unit, direct.includes(unit))) };
    };
    const wikiDisposition = dispositions[proposalIndex];
    const source = sourceMetadata(original.statement, direct, timeline);
    // Stage 2 locks inventory matches before any identity, candidate or descriptor rule.
    const participants: ParticipantResolutionV22[] = original.participants.map((mention) => {
      const entity = wikiDisposition === "present" ? exact(request.entities, mention) : null;
      return entity ? resolve(mention, entity) : { mention, kind: "unresolved", canonicalId: null, canonicalName: null, supportingEvidence: [] };
    });
    const identityRelations: IdentityRelationV221[] = [];
    if (wikiDisposition === "present") {
      // Stage 3 applies the prepass only to participants not locked by exact matching.
      for (const [index, item] of participants.entries()) {
        if (item.kind !== "unresolved" || ambiguousAliases.has(norm(item.mention))) continue;
        const established = identityEntities.get(norm(item.mention)) ?? identityEntities.get(norm(withoutArticle(item.mention)));
        if (established) participants[index] = resolve(item.mention, established.entity, [established.unit]);
      }
      identityRelations.push(...precomputed.filter((relation) => relation.sourceClaimIndex === proposalIndex ||
        participants.some((item) => relation.kind === "identity_transition" ?
          [relation.fromEntityId, relation.toEntityId].includes(item.canonicalId ?? "") : item.canonicalId === relation.entityId)));
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
        if (!endpointNames.has(norm(withoutArticle(item.mention))) &&
          !descriptorMatches(item.mention, direct, allEntities()).length && generic(item.mention)) {
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
        const match = antecedent(item.mention, nearby, direct, allEntities());
        if (match) participants[index] = resolve(item.mention, match.anchor, [match.unit]);
      }
      // Stage 7B adds provenance without demoting or re-resolving locked entities.
      for (const item of participants) {
        if (item.kind !== "canonical_entity" && item.kind !== "candidate_entity") continue;
        const entity = allEntities().find((entry) => entry.canonicalId === item.canonicalId)!;
        if (![entity.name, ...entity.aliases, item.mention].some((name) => has(original.statement, name))) continue;
        for (const unit of direct) {
          if ([entity.name, ...entity.aliases].some((name) => has(unit.text, name))) continue;
          const localReferences: string[] = unit.text.match(/\b(?:he|she|it|they|him|her|them|his|its|their)\b/giu) ?? [];
          for (const phrase of unit.text.match(/\b(?:the|The)\s+[\p{Ll}-]+(?:\s+[\p{Ll}-]+)*/gu) ?? []) {
            const words = phrase.split(/\s+/u);
            for (let length = 2; length <= words.length; length++) localReferences.push(words.slice(0, length).join(" "));
          }
          for (const localReference of localReferences) {
            const match = antecedent(localReference, localUnits(request, [unit]), [unit], allEntities());
            if (!match || match.anchor.canonicalId !== entity.canonicalId || direct.includes(match.unit)) continue;
            use(match.unit);
            if (!item.supportingEvidence.some((entry) => entry.unitId === match.unit.unitId)) item.supportingEvidence.push(evidence(match.unit, false));
          }
        }

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
    if (discrepancy(original.statement, [...direct, ...used.values()]) || substitution(original.statement, participants, direct, allEntities(), precomputed)) reviewReasons.push("source_discrepancy");
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
  return { version: CLAIMS_4_1_RECONCILIATION_V2_2_1_VERSION, rawProposals, claims, candidateEntities: candidates, aliasMetadata,
    gmReview: claims.filter((claim) => claim.resolutionState === "needs_review"), diagnostics: {
      proposed: claims.length, resolved: claims.filter((claim) => claim.resolutionState === "resolved").length,
      needsReview: claims.filter((claim) => claim.resolutionState === "needs_review").length,
      mechanicalOnly: claims.filter((claim) => claim.wikiDisposition === "mechanical_only").length } };
}
