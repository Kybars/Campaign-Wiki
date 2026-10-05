import type { GraphInventory } from "./entity-reconciliation";
import { normalizeName } from "../graph/normalize";
import type { EvidenceUnit } from "./claims-2-experiment";

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
