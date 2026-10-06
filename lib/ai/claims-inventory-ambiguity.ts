import type { Claims41Request } from "./claims-4-1-experiment";
import type { GraphInventory } from "./entity-reconciliation";
import { normalizeName } from "../graph/normalize";

type Entity = Claims41Request["entities"][number];
type Unit = Claims41Request["evidenceUnits"][number];
export type InventorySources = Map<string, GraphInventory["entities"][number]["sources"]>;
const key = (s: string) => normalizeName(s).replace(/^the\s+/u, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
export function matchingInventoryEntities(entities: Entity[], mention: string) {
  return [...new Map(entities.filter(e => [e.name, ...e.aliases].some(n => key(n) === key(mention)))
    .map(e => [e.canonicalId, e])).values()];
}

/** Only explicit referent grammar; capitalization and chapter titles supply no type. */
export function sourceMentionTypes(mention: string, direct: Unit[]) {
  const types = new Set<string>();
  const n = `(?<![\\p{L}\\p{N}])(?:the\\s+)?${escape(key(mention)).replace(/\s+/gu, "\\s+")}(?![\\p{L}\\p{N}])`;
  const classes: Record<string, string> = {
    location: "city|town|village|tower|spire|house|cave|district|place|site|complex|stronghold",
    faction: "guild|cult|organization|faction",
    deity: "god|goddess|deity",
    item: "artifact|weapon|relic|object|construct|item",
    quest: "adventure|scenario|objective",
    event: "event|incident|battle|occurrence",
    other: "disease|illness|fever",
  };
  for (const u of direct) {
    if (u.kind !== "sentence") continue;
    const text = u.rawSource.text;
    const test = (pattern: string) => new RegExp(pattern, "iu").test(text);
    const named = test(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`);
    const heading = key(u.context.replace(/_/gu, " ").split(" > ").at(-1) ?? "") === key(mention);
    for (const [type, labels] of Object.entries(classes)) {
      if (test(`${n}\\s*(?:,\\s*(?:an?\\s+)?|(?:is|was)\\s+(?:an?\\s+)?)(?:${labels})\\b`) ||
        test(`\\b(?:${labels})\\s+(?:(?:called|named|known as)\\s+)?${n}\\b`)) types.add(type);
    }
    if (test(`${n}\\s+(?:is|was)\\s+(?:an?\\s+)?(?:(?:massive|sprawling|stone|opalescent|white|ancient|ruined|spectral)[-\\s,]+){1,4}(?:tower|spire|house|cave|complex|stronghold)\\b`)) types.add("location");
    if (test(`\\b(?:enter(?:s|ed|ing)?|inside|beneath|at|into|site of|located in)\\s+${n}\\b`) ||
      test(`${n}\\s+(?:is|was)\\s+(?:located|situated)\\b`)) types.add("location");
    if (test(`\\b(?:complete(?:s|d)?|finish(?:es|ed)?)\\s+(?:the\\s+)?${n}\\s+adventure\\b`)) types.add("quest");
    if (test(`${n}['’]s?\\s+(?:lead\\s+)?(?:members?|officers?|engineers?|leader)\\b`) ||
      test(`${n}\\s+(?:employs?|commissioned|commands?|recruits?)\\b`) ||
      test(`\\bcommissioned\\s+${n}\\s+(?:in\\s+[^.!?]{1,60}\\s+)?to\\b`)) types.add("faction");
    if (test(`\\b(?:worships?|worshipped|worshiped)\\s+(?:(?:an?\\s+)?entity\\s+(?:he|she|they)\\s+calls?\\s+)?${n}\\b`)) types.add("deity");
    if (test(`\\b(?:carries|wields)\\s+${n}\\b`)) types.add("item");
    // A section anchor can identify a definite physical referent or disease in the
    // claim's own span. A title never supplies quest grammar by itself.
    if (heading && /\bthe (?:tower|house|cave|complex|stronghold)\b/iu.test(text)) types.add("location");
    if ((named || heading) && /\b(?:disease|diseased|infected|stricken|spreads through physical contact)\b/iu.test(text)) types.add("other");
  }
  return types;
}

/** Explicit classification of an inventory source record, including named statblocks. */
export function inventorySourceTypes(name: string, page: number, text: string) {
  const types = sourceMentionTypes(name, [{ unitId: "inventory-source", segmentId: "inventory-source", page, order: 0,
    kind: "sentence", text, context: "", rawSource: { page, start: 0, end: text.length, text } }]);
  const n = escape(key(name)).replace(/\s+/gu, "\\s+");
  if (new RegExp(`\\b${n}\\s+Difficulty\\s+\\d+\\s+Size\\s+\\d+\\s+construct\\b`, "iu").test(text)) types.add("item");
  return types;
}

export function resolveInventoryCollision(entities: Entity[], mention: string, direct: Unit[], sources: InventorySources = new Map()) {
  const matches = matchingInventoryEntities(entities, mention);
  if (matches.length < 2) return null;
  const types = sourceMentionTypes(mention, direct);
  const grammatical = matches.filter(e => types.has(e.type));
  const supported = matches.filter(e => direct.some(u => u.kind === "sentence" &&
    (sources.get(e.canonicalId) ?? []).some(s => s.page_number === u.page &&
      key(s.supporting_text).includes(key(mention)) &&
      (normalizeName(s.supporting_text).includes(normalizeName(u.rawSource.text)) ||
       normalizeName(u.rawSource.text).includes(normalizeName(s.supporting_text))))));
  // Contradictory signals never resolve by precedence. Shared source records are
  // type conflicts, not independent identities and not a reason to merge.
  if (grammatical.length === 1 && (!supported.length || supported.some(e => e.canonicalId === grammatical[0].canonicalId)))
    return { entity: grammatical[0], method: "type_grammar" as const, units: direct };
  if (!types.size && supported.length === 1)
    return { entity: supported[0], method: "direct_provenance" as const, units: direct };
  return null;
}
