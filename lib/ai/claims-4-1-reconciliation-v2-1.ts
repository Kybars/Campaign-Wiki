import { claims41OutputSchema, type Claims41Output, type Claims41Request } from "./claims-4-1-experiment";
import { reconcileClaims41V2, type ReconciledClaimV2 } from "./claims-4-1-reconciliation-v2";
import { normalizeName } from "../graph/normalize";

export const CLAIMS_4_1_RECONCILIATION_V2_1_VERSION = "claims-4-1-reconciliation-2.1";
type Entity = Claims41Request["entities"][number];
type Unit = Claims41Request["evidenceUnits"][number];
type Evidence = ReconciledClaimV2["evidence"][number];
type IdentityKind = "alias" | "former_identity" | "renamed_identity" | "transformed_identity" | "designation" | "local_reference";

export interface IdentityRelationship {
  canonicalId: string;
  canonicalName: string;
  presentationName: string;
  alternateName: string;
  kind: IdentityKind;
  sourceUnitId: string;
  sourceSegmentId: string;
}
export interface CanonicalPresentation {
  canonicalId: string;
  canonicalName: string;
  presentationName: string;
  alternateNames: string[];
  relationships: IdentityRelationship[];
}
export type ParticipantResolutionV21 =
  | { mention: string; kind: "canonical_entity" | "descriptor"; canonicalId: string; canonicalName: string; identitySourceUnitId: string | null }
  | { mention: string; kind: "generic_non_entity"; canonicalId: null; canonicalName: null; identitySourceUnitId: null }
  | { mention: string; kind: "unresolved"; canonicalId: null; canonicalName: null; identitySourceUnitId: null; reason: "unmatched_meaningful_identity" | "ambiguous_identity" };
export interface ReconciledClaimV21 extends Omit<ReconciledClaimV2, "resolutionState" | "participants" | "entityAssociations" | "reviewReasons"> {
  wikiDisposition: "present" | "mechanical_only";
  resolutionState: "resolved" | "needs_review" | null;
  reviewReasons: string[];
  participants: ParticipantResolutionV21[];
  entityAssociations: Array<{ canonicalId: string; canonicalName: string }>;
  directEvidence: Evidence[];
  contextEvidence: Array<Evidence & { purpose: "identity" | "local_scope" }>;
  identityRelationships: IdentityRelationship[];
}

const norm = (value: string) => normalizeName(value).replace(/[’]/gu, "'");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripArticle = (value: string) => norm(value).replace(/^the /u, "");
const partyForms = /^(?:heroes \/ party|(?:the )?(?:heroes|party|characters|adventurers|pcs|player characters|adventuring party))$/iu;
const mechanicalTerms = /\b(?:ability check|skill check|saving throw|attack roll|initiative roll|spell slot|hit points?|armor class|difficulty class|\bDC\s*\d+|roll\s+(?:a|an|\d+d\d+)|\d+d\d+\s+damage|bonus action|movement speed|experience points?|make(?:s)?\s+(?:a|an)\s+(?:\w+\s+){0,3}(?:check|save|attack))\b/iu;
const worldPredicate = /\b(?:becomes?|became|founded|rules?|governs?|lives?|located|contains?|commands?|attacks?|destroys?|travels?|arrives?|discovers?|reveals?|belongs?|serves?|captures?|collapses?|opens?|closes?|dies|died|created|built)\b/iu;
const commonNonEntities = /^(?:\w+\s+){0,3}(?:creatures?|monsters?|people|persons?|someone|something|soldiers?|guards?|villagers?|assassins?|victims?|enemies|foes|troops?|agents?|students?|bookkeepers?|objects?|items?|doors?|walls?|weapons?|swords?|storms?|hurricanes?|spells?|effects?|magic|teleportation|damage|checks?|saves?|attacks?|players?|game masters?|gm|light|darkness|weather|time|water|fire|supplies|treasure|gold|rooms?)$/iu;

function evidence(unit: Unit, direct: boolean): Evidence {
  return { unitId: unit.unitId, page: unit.page, start: unit.rawSource.start, end: unit.rawSource.end, text: unit.rawSource.text, direct };
}
function localUnits(request: Claims41Request, direct: Unit[]): Unit[] {
  if (!direct.length) return [];
  const first = direct[0];
  const low = Math.min(...direct.map((unit) => unit.order)) - 4;
  const high = Math.max(...direct.map((unit) => unit.order)) + 2;
  return request.evidenceUnits.filter((unit) => unit.segmentId === first.segmentId && unit.context === first.context &&
    unit.order >= low && unit.order <= high).sort((a, b) => a.order - b.order);
}
function uniqueEntity(entities: Entity[], name: string): Entity | null {
  const matches = entities.filter((entity) => [entity.name, ...entity.aliases].some((value) => stripArticle(value) === stripArticle(name)));
  return matches.length === 1 ? matches[0] : null;
}
function nameCandidates(text: string): string[] {
  // A candidate is source text, never a generated entity. Existing inventory
  // anchors the relationship before any alternate name is accepted.
  const names = text.match(/\b(?:[\p{Lu}][\p{L}'’-]*)(?:\s+(?:of|the|[\p{Lu}][\p{L}'’-]*)){0,4}\b/gu) ?? [];
  return names.map((name) => name.trim()).filter((name) => !/^(?:The|A|An|And|But|If|When)$/u.test(name));
}
function explicitRelations(unit: Unit, entities: Entity[]): IdentityRelationship[] {
  const text = unit.text.replace(/[’]/gu, "'");
  const relations: IdentityRelationship[] = [];
  for (const entity of entities) {
    const names = [entity.name, ...entity.aliases];
    for (const anchor of names) {
      const a = escape(anchor);
      const patterns: Array<[RegExp, IdentityKind, boolean]> = [
        [new RegExp(`\\b${a}\\s*,?\\s*(?:also )?(?:known as|called|named)\\s+(?:the )?([^,.;]+)`, "iu"), "alias", false],
        [new RegExp(`\\b${a}\\s*\\(formerly\\s+([^)]+)\\)`, "iu"), "former_identity", false],
        [new RegExp(`\\b${a}\\s*,?\\s*formerly\\s+(?:known as\\s+)?([^,.;]+)`, "iu"), "former_identity", false],
        [new RegExp(`\\b${a}\\s+(?:was renamed|is now called|became known as)\\s+(?:the )?([^,.;]+)`, "iu"), "renamed_identity", true],
        [new RegExp(`\\b${a}\\s+(?:became|transformed into)\\s+(?:the )?([^,.;]+)`, "iu"), "transformed_identity", true],
        [new RegExp(`\\b([\\p{Lu}][\\p{L}'’-]*(?:\\s+[\\p{Lu}][\\p{L}'’-]*){0,4})\\s+(?:was renamed|is now called|became known as)\\s+(?:the )?${a}\\b`, "u"), "renamed_identity", false],
        [new RegExp(`\\b([\\p{Lu}][\\p{L}'’-]*(?:\\s+[\\p{Lu}][\\p{L}'’-]*){0,4})\\s+(?:became|transformed into)\\s+(?:the )?${a}\\b`, "u"), "transformed_identity", false],
        [new RegExp(`\\b${a}\\s+(?:is|was)\\s+(?:the same (?:person|being|place|organization|thing) as|identical to)\\s+(?:the )?([^,.;]+)`, "iu"), "alias", false],
        [new RegExp(`\\b${a}\\s*,\\s+the\\s+([^,.;]+)`, "iu"), "designation", false],
      ];
      for (const [pattern, kind, preferNew] of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const tail = match[1].trim().replace(/\s+(?:who|which|that)\b.*$/iu, "");
        const alternate = nameCandidates(tail).find((candidate) => stripArticle(candidate) !== stripArticle(anchor));
        if (!alternate) continue;
        const existing = uniqueEntity(entities, alternate);
        if (existing && existing.canonicalId !== entity.canonicalId) continue;
        relations.push({ canonicalId: entity.canonicalId, canonicalName: entity.name,
          presentationName: preferNew ? alternate : entity.name, alternateName: alternate,
          kind, sourceUnitId: unit.unitId, sourceSegmentId: unit.segmentId });
      }
    }
  }
  return relations;
}
function localReference(mention: string, units: Unit[], entities: Entity[]): IdentityRelationship | null {
  if (!/^the\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2}$/iu.test(mention)) return null;
  const label = stripArticle(mention);
  const matches: IdentityRelationship[] = [];
  for (const unit of units) {
    for (const entity of entities) {
      if (new RegExp(`\\b${escape(entity.name)}\\s*,?\\s+(?:an? |the )?${escape(label)}\\b`, "iu").test(unit.text) ||
        new RegExp(`\\b${escape(entity.name)}\\s+(?:is|was)\\s+(?:an? |the )?${escape(label)}\\b`, "iu").test(unit.text))
        matches.push({ canonicalId: entity.canonicalId, canonicalName: entity.name, presentationName: entity.name,
          alternateName: mention, kind: "local_reference", sourceUnitId: unit.unitId, sourceSegmentId: unit.segmentId });
    }
  }
  const unique = [...new Map(matches.map((item) => [item.canonicalId, item])).values()];
  return unique.length === 1 ? unique[0] : null;
}
function generic(mention: string): boolean {
  const value = mention.trim();
  const withoutQualifier = value.replace(/^(?:a|an|the|some|several|many|ordinary|unnamed|unknown|other|captured)\s+/iu, "");
  if (commonNonEntities.test(withoutQualifier)) return true;
  if (/^(?:a|an|some|several|many|ordinary|unnamed|other)\s+/iu.test(value) &&
    !/\b[\p{Lu}][\p{Ll}]{2,}\b/u.test(withoutQualifier)) return true;
  return !/[\p{Lu}]/u.test(value) && /s$/u.test(value) && !/\b(?:of|from)\b/iu.test(value);
}
function sourceDescriptorParent(mention: string, direct: Unit[], entities: Entity[]): Entity | null {
  const source = direct.map((unit) => unit.text).join(" ").replace(/[’]/gu, "'");
  const words = norm(mention).split(/\s+/u).filter((word) => word.length > 3 && !/^(?:the|from|with|western|eastern|northern|southern)$/u.test(word));
  const found = entities.filter((entity) => {
    const parent = escape(entity.name.replace(/[’]/gu, "'"));
    return words.some((word) => {
      if (norm(entity.name).split(/\s+/u).includes(word)) return false;
      const role = escape(word);
      return new RegExp(`\\b(?:${parent}'s\\s+(?:\\w+\\s+){0,2}${role}|${role}\\s+of\\s+(?:the\\s+)?${parent}|${parent}\\s+(?:\\w+\\s+){0,2}${role})\\b`, "iu").test(source);
    });
  });
  return found.length === 1 ? found[0] : null;
}
function mechanicalOnly(statement: string): boolean {
  if (!mechanicalTerms.test(statement)) return false;
  const lead = statement.split(/\b(?:when|if|after|before)\b/iu)[0];
  if (worldPredicate.test(lead) && !mechanicalTerms.test(lead)) return false;
  const clauses = statement.split(/[,;] |\s+(?:and|but|while)\s+/iu);
  return clauses.every((clause) => mechanicalTerms.test(clause) && (!worldPredicate.test(clause) ||
    /\b(?:must|may|can|should|requires?|needs?|roll|make|makes|gain|gains|takes?|deals?|has|have)\b/iu.test(clause)));
}
function possibleSourceError(direct: Unit[], local: Unit[]): boolean {
  // Only an explicit nearby assertion and its explicit negation are treated as
  // an inconsistency. Broader narrative contradictions require GM judgment.
  for (const unit of direct) {
    const assertion = unit.text.match(/\b([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*)?)\s+(is|was|are|were)\s+(not\s+)?([^.!?]{3,60})/u);
    if (!assertion) continue;
    const subject = escape(assertion[1]);
    const predicate = escape(assertion[4].trim().replace(/\s+/gu, " "));
    const opposite = assertion[3] ? "" : "not\\s+";
    if (local.some((other) => other.unitId !== unit.unitId &&
      new RegExp(`\\b${subject}\\s+${assertion[2]}\\s+${opposite}${predicate}(?:[.!?]|$)`, "iu").test(other.text))) return true;
  }
  return false;
}

export function reconcileClaims41V21(output: Claims41Output, request: Claims41Request) {
  const parsed = claims41OutputSchema.parse(output);
  const v2 = reconcileClaims41V2(parsed, request);
  const byId = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
  const claims: ReconciledClaimV21[] = v2.claims.map((prior) => {
    const direct = prior.original.evidence_unit_ids.map((id) => byId.get(id)).filter((unit): unit is Unit => Boolean(unit));
    const nearby = localUnits(request, direct);
    const relationships = nearby.flatMap((unit) => explicitRelations(unit, request.entities));
    const disposition = mechanicalOnly(prior.original.statement) ? "mechanical_only" : "present";
    const usedContext = new Map<string, { unit: Unit; purpose: "identity" | "local_scope" }>();
    const localRelationships: IdentityRelationship[] = [];
    const participants: ParticipantResolutionV21[] = disposition === "mechanical_only" ?
      prior.original.participants.map((mention) => ({ mention, kind: "generic_non_entity", canonicalId: null, canonicalName: null, identitySourceUnitId: null })) :
      prior.original.participants.map((mention, index) => {
        const relationMatches = relationships.filter((item) => stripArticle(item.alternateName) === stripArticle(mention));
        const relation = [...new Map(relationMatches.map((item) => [item.canonicalId, item])).values()];
        const local = localReference(mention, nearby, request.entities);
        const exact = uniqueEntity(request.entities, mention);
        const priorParticipant = prior.participants[index];
        const descriptor = sourceDescriptorParent(mention, direct, request.entities);
        const resolved = exact ?? (relation.length === 1 ? request.entities.find((item) => item.canonicalId === relation[0].canonicalId) : undefined) ??
          (local ? request.entities.find((item) => item.canonicalId === local.canonicalId) : undefined);
        if (relation.length > 1) return { mention, kind: "unresolved", canonicalId: null, canonicalName: null, identitySourceUnitId: null,
          reason: "ambiguous_identity" };
        const chosenRelation = !exact ? relation[0] ?? local : undefined;
        if (chosenRelation) {
          if (chosenRelation.kind === "local_reference") localRelationships.push(chosenRelation);
          const unit = byId.get(chosenRelation.sourceUnitId);
          if (unit && !prior.original.evidence_unit_ids.includes(unit.unitId)) usedContext.set(unit.unitId, { unit, purpose: "identity" });
        }
        if (descriptor) return { mention, kind: "descriptor", canonicalId: descriptor.canonicalId, canonicalName: descriptor.name, identitySourceUnitId: null };
        if (priorParticipant.kind === "descriptor" && priorParticipant.canonicalId)
          return { mention, kind: "descriptor", canonicalId: priorParticipant.canonicalId, canonicalName: priorParticipant.canonicalName!, identitySourceUnitId: null };
        if (resolved) return { mention, kind: "canonical_entity", canonicalId: resolved.canonicalId, canonicalName: resolved.name,
          identitySourceUnitId: chosenRelation?.sourceUnitId ?? null };
        if (partyForms.test(mention) && (priorParticipant.canonicalId === "system:heroes-party" ||
          /\b(?:the heroes|the adventurers|the characters|the party|player characters|pcs)\b/iu.test(direct.map((unit) => unit.text).join(" ")) &&
          !/\b(?:npc|monster|villager|creature)\s+(?:heroes|party|adventurers)\b/iu.test(direct.map((unit) => unit.text).join(" "))))
          return { mention, kind: "canonical_entity", canonicalId: "system:heroes-party", canonicalName: "Heroes / Party", identitySourceUnitId: null };
        if (generic(mention) || priorParticipant.kind === "generic_non_entity")
          return { mention, kind: "generic_non_entity", canonicalId: null, canonicalName: null, identitySourceUnitId: null };
        return { mention, kind: "unresolved", canonicalId: null, canonicalName: null, identitySourceUnitId: null,
          reason: "unmatched_meaningful_identity" };
      });
    const associations = [...new Map(participants.filter((item) => item.canonicalId).map((item) =>
      [item.canonicalId, { canonicalId: item.canonicalId!, canonicalName: item.canonicalName! }])).values()];
    const directEvidence = prior.evidence.filter((item) => item.direct);
    const reviewReasons = prior.reviewReasons.filter((reason) => reason !== "unresolved_participant" && reason !== "no_useful_home" &&
      reason !== "possible_source_discrepancy");
    if (prior.reviewReasons.includes("possible_source_discrepancy") || possibleSourceError(direct, nearby)) reviewReasons.push("possible_source_error");
    if (participants.some((item) => item.kind === "unresolved")) reviewReasons.push("unresolved_participant");
    if (!associations.length && !prior.timelineAssociation) reviewReasons.push("no_useful_home");
    const sourceRelationships = [...new Map([...relationships.filter((item) => participants.some((participant) =>
      participant.canonicalId === item.canonicalId)), ...localRelationships].map((item) =>
      [JSON.stringify([item.canonicalId, item.alternateName, item.sourceUnitId, item.kind]), item])).values()];
    for (const relation of sourceRelationships) {
      const unit = byId.get(relation.sourceUnitId);
      if (unit && !prior.original.evidence_unit_ids.includes(unit.unitId) && !usedContext.has(unit.unitId))
        usedContext.set(unit.unitId, { unit, purpose: "identity" });
    }
    const completeContextEvidence = [...prior.evidence.filter((item) => !item.direct).map((item) => ({ ...item, purpose: "local_scope" as const })),
      ...[...usedContext.values()].map(({ unit, purpose }) => ({ ...evidence(unit, false), purpose }))];
    return { ...prior, wikiDisposition: disposition, resolutionState: disposition === "mechanical_only" ? null :
      reviewReasons.length ? "needs_review" : "resolved", reviewReasons: disposition === "mechanical_only" ? [] : [...new Set(reviewReasons)],
      participants, entityAssociations: disposition === "mechanical_only" ? [] : associations,
      timelineAssociation: disposition === "mechanical_only" ? null : prior.timelineAssociation,
      directEvidence, contextEvidence: disposition === "mechanical_only" ? [] : completeContextEvidence,
      identityRelationships: disposition === "mechanical_only" ? [] : sourceRelationships };
  });
  const identityRelationships = [...new Map(claims.flatMap((claim) => claim.identityRelationships).map((item) =>
    [JSON.stringify([item.canonicalId, item.alternateName, item.sourceUnitId, item.kind]), item])).values()];
  const canonicalPresentations: CanonicalPresentation[] = request.entities.filter((entity) =>
    identityRelationships.some((item) => item.canonicalId === entity.canonicalId)).map((entity) => {
    const own = identityRelationships.filter((item) => item.canonicalId === entity.canonicalId);
    const preferred = [...new Set(own.filter((item) => item.presentationName !== entity.name).map((item) => item.presentationName))];
    return { canonicalId: entity.canonicalId, canonicalName: entity.name,
      presentationName: preferred.length === 1 ? preferred[0] : entity.name,
      alternateNames: [...new Set(own.map((item) => item.alternateName))], relationships: own };
  });
  return { version: CLAIMS_4_1_RECONCILIATION_V2_1_VERSION, rawProposals: parsed, claims,
    canonicalPresentations,
    gmReview: claims.filter((claim) => claim.resolutionState === "needs_review"), diagnostics: {
      proposed: claims.length, resolved: claims.filter((claim) => claim.resolutionState === "resolved").length,
      needsReview: claims.filter((claim) => claim.resolutionState === "needs_review").length,
      mechanicalOnly: claims.filter((claim) => claim.wikiDisposition === "mechanical_only").length } };
}
