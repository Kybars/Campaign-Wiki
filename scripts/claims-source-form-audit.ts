import { isDeepStrictEqual } from "node:util";
import type { replayAcceptanceBundle } from "../lib/ai/claims-offline-replay";
import type { reconcileClaims41DocumentV231 } from "../lib/ai/claims-4-1-reconciliation-v2-3-1";
import type { reconcileClaims41DocumentV232 } from "../lib/ai/claims-4-1-reconciliation-v2-3-2";
import { documentClaimsRequest } from "../lib/ai/claims-document-source";
import { matchingInventoryEntities } from "../lib/ai/claims-inventory-ambiguity";
import { createSourceFormResolver, precedingSourceScope } from "../lib/ai/claims-source-form";
import { normalizeName } from "../lib/graph/normalize";

type Replay = ReturnType<typeof replayAcceptanceBundle>;
type Old = ReturnType<typeof reconcileClaims41DocumentV231>;
type Current = ReturnType<typeof reconcileClaims41DocumentV232>;
const key = (s: string) => normalizeName(s).replace(/^the\s+/u, "");
export function auditSourceFormReplay(replay: Replay, before: Old) {
  const result = replay.result as Current;
  const byId = new Map(replay.structure.units.map(u => [u.unitId, u]));
  const request = documentClaimsRequest(replay.structure.units, replay.normalized.inventory, "audit");
  const forms = createSourceFormResolver(request.evidenceUnits, request.entities);
  const changes: Array<Record<string, unknown>> = [];
  const residual: Array<{ proposalIndex: number; mention: string; category: string; reason: string }> = [];
  const categories = Object.fromEntries(["genuine inventory ambiguity", "missing stable unique identity", "unresolved structural/coreference", "generic not recognized", "source/provenance problem", "other"].map(k => [k, 0]));
  for (const [i, c] of result.claims.entries()) {
    const old = before.claims[i];
    for (const field of ["original", "proposalIndex", "wikiDisposition", "sourceStatus", "timelineAssociation", "directEvidence", "identityRelations"] as const)
      if (!isDeepStrictEqual(c[field], old[field])) throw new Error(`Frozen claim field changed: ${i}/${field}`);
    for (const [j, p] of c.participants.entries()) {
      const previous = old.participants[j];
      if (previous.kind === "canonical_entity" && (p.kind !== previous.kind || p.canonicalId !== previous.canonicalId)) throw new Error(`Lost validated canonical resolution: ${i}/${j}`);
      const decision = result.sourceFormDecisions.find(d => d.proposalIndex === i && d.participantIndex === j);
      if (!isDeepStrictEqual(previous, p)) changes.push({ proposalIndex: i, participantIndex: j, participant: p.mention,
        before: previous, after: p, reason: decision?.reason ?? "preserved 2.3.1 stage behavior after source-form processing",
        method: decision?.method ?? "existing_resolution_stage", sourceEvidence: c.directEvidence,
        supportingEvidence: p.supportingEvidence, structuralAnchor: decision?.anchorUnitId ? byId.get(decision.anchorUnitId) : null });
      if (c.wikiDisposition !== "present" || p.kind !== "unresolved") continue;
      const direct = c.directEvidence.map(e => byId.get(e.unitId)!).filter(Boolean);
      const matches = matchingInventoryEntities(request.entities, p.mention);
      const sourceReference = direct.some(u => /\b(?:the\s+[\p{Ll}-]+|it|they|its|their)\b/iu.test(u.text));
      const absent = !direct.some(u => (` ${key(u.text)} `).includes(` ${key(p.mention)} `));
      const independent = matches.length > 1 && new Set(matches.map(e => key(e.name))).size === matches.length;
      let category = "other", reason = "insufficient source evidence to establish a semantic class";
      if (c.reviewReasons.some(r => ["unknown_evidence_unit", "invalid_source_mapping", "heading_is_context_only"].includes(r))) {
        category = "source/provenance problem"; reason = "invalid or context-only direct evidence";
      } else if (forms.generic(p.mention, direct)) {
        category = "generic not recognized"; reason = "source-form class proof exists but a prior identity/descriptor stage blocks classification";
      } else if (independent) {
        category = "genuine inventory ambiguity"; reason = "competing independently named inventory identities match the mention";
      } else if (sourceReference && (matches.length > 0 && absent || matches.length > 1 || /^(?:the |it$|they$)/iu.test(p.mention) ||
        key(p.mention).split(" ").length === 1 && direct.some(u => new RegExp(`\\bthe\\s+${key(p.mention)}\\b`, "iu").test(u.text)))) {
        category = "unresolved structural/coreference"; reason = "no unique compatible proposition anchor, competing subject, or scope boundary";
      } else if (!matches.length) {
        category = "missing stable unique identity"; reason = "unmatched non-class designation; not proof that source establishes uniqueness";
      }
      categories[category]++;
      residual.push({ proposalIndex: i, mention: p.mention, category, reason });
    }
  }
  const mentions = [...new Set(residual.map(r => key(r.mention)))].map(name => {
    const occurrences = residual.filter(r => key(r.mention) === name);
    return { name, frequency: occurrences.length, categories: [...new Set(occurrences.map(o => o.category))], occurrences };
  }).sort((a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name));
  const occurrencesFor = (name: string) => result.claims.filter(c => c.wikiDisposition === "present").flatMap(c => c.participants
    .map((p, j) => ({ c, p, previous: before.claims[c.proposalIndex].participants[j] })).filter(o => key(o.p.mention) === key(name)));
  const collisions = ["Moon Spire", "Gibbering Fever", "Academy of Engineers", "Void"].map(name => {
    const rows = occurrencesFor(name);
    return { name, occurrences: rows.length, previouslyUnresolved: rows.filter(r => r.previous.kind === "unresolved").length,
      newlyCanonical: rows.filter(r => r.previous.kind === "unresolved" && r.p.kind === "canonical_entity").length,
      stillUnresolved: rows.filter(r => r.p.kind === "unresolved").length,
      residual: rows.filter(r => r.p.kind === "unresolved").map(({ c, p }) => ({ proposalIndex: c.proposalIndex, participant: p.mention,
        directEvidence: c.directEvidence, contexts: c.directEvidence.map(e => byId.get(e.unitId)?.context),
        precedingScopeUnitIds: c.directEvidence.flatMap(e => precedingSourceScope(request.evidenceUnits, byId.get(e.unitId)!).map(u => u.unitId)),
        reason: "bounded source form has no unique compatible anchored interpretation" })) };
  });
  const genericAudit = ["Cursed creature", "Character", "Orcs", "Gremlins", "Boggarts", "miners", "ghouls", "demons", "cultists", "guards"].map(name => {
    const rows = occurrencesFor(name);
    const count = (kind: string, old: boolean) => rows.filter(r => (old ? r.previous.kind : r.p.kind) === kind).length;
    return { name, occurrences: rows.length, beforeGeneric: count("generic_non_entity", true), afterGeneric: count("generic_non_entity", false),
      unresolved: count("unresolved", false), candidates: count("candidate_entity", false), canonical: count("canonical_entity", false),
      changes: changes.filter(d => key(d.participant as string) === key(name)) };
  });
  if (result.candidateEntities.some(e => !before.candidateEntities.some(b => b.canonicalId === e.canonicalId))) throw new Error("Source-form revision created a new candidate identity");
  return { changes, collisions, genericAudit, residual: { total: residual.length, categories, mentions,
    note: "Diagnostic categories do not establish missing identity uniqueness or semantic homonymy from same-label type collisions." } };
}
