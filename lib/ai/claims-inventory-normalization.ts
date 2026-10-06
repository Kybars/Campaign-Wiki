import type { GraphInventory } from "./entity-reconciliation";
import { normalizeName } from "../graph/normalize";
import type { EvidenceUnit } from "./claims-2-experiment";
import { inventorySourceTypes } from "./claims-inventory-ambiguity";

const norm = (s: string) => normalizeName(s).replace(/^the\s+/u, "");
/** A conservative source-backed union; never invokes graph adjudication or a provider. */
export function normalizeClaimsInventory(input: GraphInventory, units: EvidenceUnit[] = []) {
  const inventory = structuredClone(input);
  const merges: Array<{ canonicalId: string; originalId: string; reason: string; evidence: GraphInventory["entities"][number]["sources"] }> = [];
  const removed = new Set<string>();
  for (const full of inventory.entities) for (const short of inventory.entities) {
    if (full === short || removed.has(full.temporary_id) || removed.has(short.temporary_id) || full.type !== short.type) continue;
    const same = norm(full.name) === norm(short.name);
    const suffix = full.type === "npc" && full.name.split(/\s+/u).length > 1 && short.name.split(/\s+/u).length === 1 &&
      norm(full.name).endsWith(` ${norm(short.name)}`);
    const competitors = inventory.entities.filter(e => e.type === short.type && norm(e.name).endsWith(` ${norm(short.name)}`));
    const escapedShort = short.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const evidence = full.sources.filter(s => short.sources.some(t => t.page_number === s.page_number) &&
      s.supporting_text.includes(full.name) && new RegExp(`(?:[.;]\\s*|,\\s*)${escapedShort}\\s+(?:has|is|was|works|sets|leads|returns)\\b`, "u").test(s.supporting_text));
    if (suffix && competitors.length === 1) {
      const escaped = short.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      for (const [i, u] of units.entries()) {
        if (!u.text.includes(full.name)) continue;
        const following = units.slice(i + 1, i + 4).find(v => v.page === u.page && v.context === u.context &&
          new RegExp(`(?:^|,\\s*)${escaped}\\s+(?:has|is|was|works|sets|leads|returns)\\b`, "u").test(v.text));
        if (following) evidence.push(...[u, following].map(v => ({ page_number: v.page, supporting_text: v.rawSource.text })));
      }
    }
    if (!same && !(suffix && competitors.length === 1 && evidence.length)) continue;
    if (same && inventory.entities.indexOf(full) > inventory.entities.indexOf(short)) continue;
    full.aliases = [...new Set([...(full.aliases ?? []), short.name, ...(short.aliases ?? [])])].filter(a => a !== full.name);
    full.memberIds = [...new Set([full.temporary_id, ...(full.memberIds ?? []), short.temporary_id, ...(short.memberIds ?? [])])];
    full.sources = [...full.sources, ...short.sources];
    removed.add(short.temporary_id);
    merges.push({ canonicalId: full.temporary_id, originalId: short.temporary_id,
      reason: same ? normalizeName(full.name) === normalizeName(short.name) ? "exact_same_name_compatible_type" : "article_only_compatible_type" :
        "unique_source_supported_proper_name_shortening", evidence: evidence.length ? evidence : short.sources });
  }
  inventory.entities = inventory.entities.filter(e => !removed.has(e.temporary_id));
  return { inventory, merges };
}

/** 2.3.1 opt-in: fallback records merge only with explicit, shared referent proof.
 * Historical normalization remains available unchanged above. */
export function normalizeClaimsInventoryV231(input: GraphInventory, units: EvidenceUnit[] = []) {
  const result = normalizeClaimsInventory(input, units);
  const removed = new Set<string>();
  for (const fallback of result.inventory.entities.filter(e => e.type === "other")) {
    const specific = result.inventory.entities.filter(e => e.type !== "other" && norm(e.name) === norm(fallback.name));
    if (specific.length !== 1 || !fallback.sources.length) continue;
    const target = specific[0];
    const shared = fallback.sources.filter(s => target.sources.some(t => t.page_number === s.page_number &&
      normalizeName(t.supporting_text) === normalizeName(s.supporting_text)));
    const establishes = (s: typeof fallback.sources[number]) => {
      const types = inventorySourceTypes(fallback.name, s.page_number, s.supporting_text);
      return types.size === 1 && types.has(target.type);
    };
    // Every independent record must support the same specific interpretation.
    // An unexplained source, conflicting class or merely identical label blocks merging.
    if (!shared.some(establishes) || ![...fallback.sources, ...target.sources].every(establishes)) continue;
    target.aliases = [...new Set([...(target.aliases ?? []), fallback.name, ...(fallback.aliases ?? [])])].filter(a => a !== target.name);
    target.memberIds = [...new Set([target.temporary_id, ...(target.memberIds ?? []), fallback.temporary_id, ...(fallback.memberIds ?? [])])];
    target.sources = [...target.sources, ...fallback.sources];
    removed.add(fallback.temporary_id);
    result.merges.push({ canonicalId: target.temporary_id, originalId: fallback.temporary_id,
      reason: "shared_source_explicit_specific_type_over_fallback", evidence: [...fallback.sources] });
  }
  result.inventory.entities = result.inventory.entities.filter(e => !removed.has(e.temporary_id));
  return result;
}
