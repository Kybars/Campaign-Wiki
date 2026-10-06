import type { replayAcceptanceBundle } from "../lib/ai/claims-offline-replay";
import { documentClaimsRequest } from "../lib/ai/claims-document-source";
import { matchingInventoryEntities, resolveInventoryCollision } from "../lib/ai/claims-inventory-ambiguity";
import { normalizeName } from "../lib/graph/normalize";
type Replay = ReturnType<typeof replayAcceptanceBundle>;
const key = (s: string) => normalizeName(s).replace(/^the\s+/u, "");

export function auditInventoryCollisions(replay: Replay) {
  const request = documentClaimsRequest(replay.structure.units, replay.normalized.inventory, "audit");
  const sources = new Map(replay.normalized.inventory.entities.map(e => [e.temporary_id, e.sources]));
  const groups = new Map<string, typeof request.entities>();
  for (const e of replay.originalInventory.entities) groups.set(key(e.name), [...(groups.get(key(e.name)) ?? []),
    { canonicalId: e.temporary_id, name: e.name, type: e.type, aliases: e.aliases ?? [] }]);
  return [...groups].filter(([, entities]) => entities.length > 1).map(([name, entities]) => {
    const originalIds = new Set(entities.map(e => e.canonicalId));
    const ids = new Set(replay.normalized.inventory.entities.filter(e => originalIds.has(e.temporary_id) ||
      e.memberIds?.some(id => originalIds.has(id))).map(e => e.temporary_id));
    const merges = replay.normalized.merges.filter(m => originalIds.has(m.originalId));
    const occurrences = replay.result.claims.filter(c => c.wikiDisposition === "present").flatMap(c => c.participants
      .filter(p => matchingInventoryEntities(request.entities, p.mention).some(e => ids.has(e.canonicalId)))
      .map(p => {
        const direct = request.evidenceUnits.filter(u => c.original.evidence_unit_ids.includes(u.unitId));
        const resolution = resolveInventoryCollision(request.entities, p.mention, direct, sources);
        if (p.kind === "canonical_entity" && matchingInventoryEntities(request.entities, p.mention).length > 1 &&
          resolution?.entity.canonicalId !== p.canonicalId) throw new Error("Collision audit differs from resolution");
        if (p.kind === "unresolved" && resolution) throw new Error("Saved unresolved collision differs from current resolver");
        return { proposalIndex: c.proposalIndex, mention: p.mention, kind: p.kind, selectedId: p.canonicalId,
          method: resolution?.method ?? (p.kind === "canonical_entity" && merges.some(m => m.canonicalId === p.canonicalId) ?
            merges.some(m => m.canonicalId === p.canonicalId && m.reason === "shared_source_explicit_specific_type_over_fallback") ? "safe_normalization" : "inventory_normalization" : null),
          reason: resolution ? "unique claim-local source support" : p.kind === "canonical_entity" ? "source-proven inventory normalization" : "source signals absent, nonunique or conflicting" };
      }));
    return { name, entities: entities.map(e => ({ id: e.canonicalId, name: e.name, type: e.type })),
      participantOccurrences: occurrences.length, directProvenance: occurrences.filter(o => o.method === "direct_provenance").length,
      typeGrammar: occurrences.filter(o => o.method === "type_grammar").length,
      safeNormalizationMerges: merges.filter(m => m.reason === "shared_source_explicit_specific_type_over_fallback").length,
      mergedOccurrences: occurrences.filter(o => o.method === "safe_normalization").length,
      stillUnresolved: occurrences.filter(o => o.kind === "unresolved").length,
      reason: merges.some(m => m.reason === "shared_source_explicit_specific_type_over_fallback") ? "all independent source records establish the same specific interpretation over fallback" :
        occurrences.length ? "claim-local selection; retained records have no safe cross-type merge proof" : "no frozen claim participant uses this group", occurrences };
  });
}

export function auditResidualParticipants(replay: Replay) {
  const request = documentClaimsRequest(replay.structure.units, replay.normalized.inventory, "audit");
  const groups = new Map<string, Array<{ proposalIndex: number; mention: string; category: string }>>();
  for (const c of replay.result.claims.filter(c => c.wikiDisposition === "present")) for (const p of c.participants.filter(p => p.kind === "unresolved")) {
    const matches = matchingInventoryEntities(request.entities, p.mention);
    const coreference = /^(?:he|she|it|they|him|her|them|his|its|their|(?:the|The)\s+\p{Ll})/u.test(p.mention);
    const generic = /^(?:(?:the|a|an|some|several|cursed|small|ordinary|unnamed)\s+)?(?:characters?|creatures?|people|guards?|soldiers?|servants?|members?|workers?|demons?|orcs|gremlins|boggarts|eyeballs?|priests?)$/iu.test(p.mention);
    const direct = c.directEvidence.map(e => key(e.text));
    const absentFromDirect = !direct.some(text => (` ${text} `).includes(` ${key(p.mention)} `));
    const independentNamedIdentities = matches.length > 1 && new Set(matches.map(e => key(e.name))).size === matches.length;
    const category = c.reviewReasons.some(r => ["unknown_evidence_unit", "invalid_source_mapping", "heading_is_context_only"].includes(r)) ? "source/provenance problem" :
      independentNamedIdentities ? "true inventory ambiguity" : coreference || matches.length > 1 && absentFromDirect ? "unresolved coreference" :
      generic ? "generic not recognized" : !matches.length && p.mention.trim() ? "unresolved unique identity" : "other";
    const name = key(p.mention);
    groups.set(name, [...(groups.get(name) ?? []), { proposalIndex: c.proposalIndex, mention: p.mention, category }]);
  }
  const mentions = [...groups].map(([name, occurrences]) => ({ name, frequency: occurrences.length,
    categories: [...new Set(occurrences.map(o => o.category))], occurrences })).sort((a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name));
  const categories: Record<string, number> = {};
  for (const m of mentions) for (const o of m.occurrences) categories[o.category] = (categories[o.category] ?? 0) + 1;
  return { categories, note: "Unresolved unique identity is an unmatched non-generic mention, not proof of uniqueness. Coreference includes collision mentions absent from the direct span. Same-label cross-type conflicts with no proof of independent identities are other; they are never declared true semantic homonyms merely from inventory types. Generic classifications are diagnostic suggestions only.", mentions };
}
