import type { Claims41Request } from "./claims-4-1-experiment";
import { matchingInventoryEntities, sourceMentionTypes } from "./claims-inventory-ambiguity";
import { normalizeName } from "../graph/normalize";

type Unit = Claims41Request["evidenceUnits"][number];
type Entity = Claims41Request["entities"][number];
const key = (s: string) => normalizeName(s).replace(/^the\s+/u, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pattern = (s: string) => esc(key(s)).replace(/\s+/gu, "\\s+");
const contains = (text: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:the\\s+)?${pattern(name)}(?![\\p{L}\\p{N}])`, "iu").test(text);
const compatible = (parent: string, child: string) => parent === child || child.startsWith(parent + " > ");

/** Contiguous semantic scope, never a document-wide context-string lookup. */
export function precedingSourceScope(units: Unit[], anchor: Unit) {
  const ordered = [...units].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex(u => u.unitId === anchor.unitId);
  let start = at;
  while (start > 0 && compatible(ordered[start - 1].context, anchor.context)) start--;
  return ordered.slice(start, at + 1).filter(u => u.kind === "sentence");
}

/** Morphology and actual source determiners, not a campaign/species vocabulary. */
export function sourceFormGeneric(mention: string, direct: Unit[], units: Unit[], entities: Entity[]) {
  if (matchingInventoryEntities(entities, mention).length || /^(?:it|they|he|she|him|her|them)$/iu.test(mention)) return null;
  const words = key(mention).split(" ");
  const head = words.at(-1)!;
  if (!head || head.length < 3) return null;
  const singular = head.endsWith("ies") ? head.slice(0, -3) + "y" : head.endsWith("s") && !/(?:ss|us|is)$/u.test(head) ? head.slice(0, -1) : head;
  const plural = singular.endsWith("y") ? singular.slice(0, -1) + "ies" : singular + "s";
  const noun = `(?:${esc(head)}|${esc(singular)}|${esc(plural)})`;
  const scope = [...new Map(direct.flatMap(u => precedingSourceScope(units, u)).map(u => [u.unitId, u])).values()];
  if (scope.some(u => new RegExp(`\\b(?:named|called|known as|calls? (?:himself|herself|itself|themselves))\\s+(?:the\\s+)?${pattern(mention)}\\b`, "iu").test(u.text) ||
    new RegExp(`\\b${noun}\\s+(?:[\\p{Ll}-]+\\s+){0,2}(?:named|called|known as|call themselves)\\b`, "iu").test(u.text))) return null;
  const usages = scope.flatMap(u => [...u.text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${noun}(?![\\p{L}\\p{N}])`, "giu"))].map(m => ({ u, m })));
  // Qualified singular labels can denote a stable set-piece or institution.
  // Require the modifiers in the direct source and class/conditional grammar.
  const modifiers = words.slice(0, -1);
  if (entities.some(e => [e.name, ...e.aliases].some(n => key(mention).startsWith(key(n) + " ")))) return null;
  const descriptive = modifiers.length > 0 && modifiers.every(w => /ed$/u.test(w) || /^(?:small|large|ordinary|unnamed)$/u.test(w));
  if (words.length > 1 && head === singular && (!descriptive || !scope.some(u => modifiers.every(w => contains(u.text, w))))) return null;
  // Internal title case establishes a possible designation and blocks generic guesses.
  if (usages.some(({ u, m }) => /\p{Lu}/u.test(m[0]) && m.index! > 0 && !/[.!?]\s*$/u.test(u.text.slice(0, m.index)))) return null;
  const proof = usages.find(({ u, m }) => {
    const prefix = u.text.slice(0, m.index);
    return /\p{Ll}/u.test(m[0]) && (/\b(?:a|an|any|each|every|some|several|many|few|all|both|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[\p{Ll}-]+\s+){0,2}$/iu.test(prefix) ||
      m[0].toLowerCase() === plural && (usages.filter(x => x.m[0] === plural).length >= 2 || /\b(?:by|of|with|from|against)\s*$/u.test(prefix)) ||
      new RegExp(`^${esc(singular)}$`, "u").test(m[0]) && /^\s+[\p{Ll}-]+s\b/u.test(u.text.slice(m.index! + m[0].length)));
  });
  if (!proof) return null;
  const relevant = direct.find(u => usages.some(x => x.u.unitId === u.unitId) ||
    /\b(?:it|they|its|their)\b/iu.test(u.text) && scope.length <= 4);
  if (!relevant) return null;
  return { method: "source_form_generic" as const, reason: "source determiner, quantity or lowercase plural class; no inventory/designation", units: [relevant, proof.u] };
}

const heads: Record<string, string[]> = {
  tower: ["location"], spire: ["location"], house: ["location"], cave: ["location"], stronghold: ["location"],
  island: ["location"], complex: ["location"], site: ["location"], disease: ["other"], fever: ["other"],
  academy: ["faction", "location"], guild: ["faction"], council: ["faction"], organization: ["faction"],
  ritual: ["event", "other"], artifact: ["item"], relic: ["item"], object: ["item"], construct: ["item"],
};
function references(unit: Unit) {
  const phrases = [...unit.text.matchAll(/(?=\b(the\s+(?:[\p{Ll}-]+\s+){0,2}[\p{Ll}-]+(?:['’]s)?\b))/giu)]
    .flatMap(m => {
      const tokens = m[1].replace(/['’]s$/u, "").toLowerCase().split(/\s+/u).slice(1);
      const noun = tokens.find(t => heads[t]);
      return noun ? [{ text: `the ${noun}`, head: noun, types: heads[noun] }] : [];
    });
  if (/\b(?:it|they|its|their)\b/iu.test(unit.text)) phrases.push({ text: "source pronoun", head: "pronoun", types: [] });
  if (/\bdiseased\b/iu.test(unit.text)) phrases.push({ text: "diseased", head: "disease", types: ["other"] });
  return phrases;
}
function referentTypes(unit: Unit, name: string, headed: boolean) {
  const types = sourceMentionTypes(name, [{ ...unit, context: "" }]);
  if (headed && /\b(?:the disease|the fever)\b/iu.test(unit.text)) types.add("other");
  if (headed && /\bthe (?:tower|spire|complex|stronghold)\b/iu.test(unit.text) &&
    /\b(?:is|has|inside|enter|walls|diameter|ceiling|height|yards|feet|stone)\b/iu.test(unit.text)) types.add("location");
  if (headed && /\b(?:the academy|the guild|the council)\b/iu.test(unit.text) &&
    /\b(?:employs|commissioned|members|officers|recruits|engineers)\b/iu.test(unit.text)) types.add("faction");
  return types;
}

/** Only existing inventory identities, with a proposition anchor and bounded scope. */
export function sourceFormReference(mention: string, direct: Unit[], units: Unit[], entities: Entity[],
  anchorCache = new Map<Unit, Array<{ entity: Entity; unit: Unit }>>()) {
  const namedMatches = matchingInventoryEntities(entities, mention);
  const literalReference = /^(?:the\s+\p{Ll}|it$|they$|its$|their$)/iu.test(mention) ||
    key(mention).split(" ").length === 1 && !!heads[key(mention)];
  if (!namedMatches.length && !literalReference) return null;
  const decisions: Array<{ entity: Entity; anchor: Unit; direct: Unit; reference: string }> = [];
  for (const target of direct) {
    const scope = precedingSourceScope(units, target);
    const refs = references(target);
    for (const ref of refs) {
      if (!namedMatches.length && ref.head !== key(mention).replace(/^the /u, "") && ref.head !== "pronoun") continue;
      const anchors: Array<{ entity: Entity; unit: Unit }> = [];
      let blocked = false;
      for (const u of scope) {
        // Explicit competing introductions stop persistence, including unnamed subjects.
        if (anchors.length && new RegExp(`\\b(?:another|a different|a second|a new)\\s+(?:${esc(ref.head)})\\b`, "iu").test(u.text)) blocked = true;
        if (!anchorCache.has(u)) {
          const established: Array<{ entity: Entity; unit: Unit }> = [];
          for (const e of entities) {
          const heading = u.context.replace(/_/gu, " ").split(" > ").some(p => key(p) === key(e.name));
          const explicitName = [e.name, ...e.aliases].some(n => contains(u.text, n));
          if (!heading && !explicitName) continue;
          // A definite noun in subsequent prose cannot bootstrap its own heading
          // antecedent. The anchor must establish the named subject in source.
          if (!explicitName) continue;
          const types = referentTypes(u, e.name, heading);
          if (!types.has(e.type)) continue;
            established.push({ entity: e, unit: u });
          }
          anchorCache.set(u, established);
        }
        // A competing same-class named subject remains a competitor; never nearest-wins.
        anchors.push(...anchorCache.get(u)!.filter(a => {
          if (ref.types.length && !ref.types.includes(a.entity.type)) return false;
          if (ref.head === "pronoun") return true;
          const headed = u.context.replace(/_/gu, " ").split(" > ").some(p => key(p) === key(a.entity.name));
          const namedHead = key(a.entity.name).split(" ").includes(ref.head);
          const n = `(?:the\\s+)?${pattern(a.entity.name)}`;
          const paired = new RegExp(`${n}\\s+(?:is|was)\\s+(?:an?\\s+)?(?:[\\p{Ll}-]+[\\s,]+){0,3}${esc(ref.head)}\\b|\\b${esc(ref.head)}\\s+(?:called|named|known as)\\s+${n}\\b`, "iu").test(u.text);
          return paired || namedHead || headed && contains(u.text, ref.head);
        }));
      }
      if (blocked) continue;
      const ids = new Set(anchors.map(a => a.entity.canonicalId));
      if (ids.size !== 1) continue;
      const anchor = anchors[0];
      if (namedMatches.length && !namedMatches.some(e => e.canonicalId === anchor.entity.canonicalId)) continue;
      if (ref.head === "pronoun") {
        // Pronouns require a local unique explicit subject; no gender/type guesses.
        if (target.order - anchor.unit.order > 2 || entities.some(e => e.canonicalId !== anchor.entity.canonicalId && key(e.name) !== key(anchor.entity.name) &&
          scope.filter(u => u.order >= anchor.unit.order).some(u => contains(u.text, e.name)))) continue;
        const unknownSubject = scope.filter(u => u.order > anchor.unit.order).some(u => {
          const subject = u.text.match(/^\s*(?:The\s+)?(\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*)*)\s+\p{Ll}/u)?.[1];
          return !!subject && !/^(?:It|They|Its|Their|The|A|An)$/u.test(subject) &&
            !entities.some(e => [e.name, ...e.aliases].some(n => key(n) === key(subject)));
        });
        if (unknownSubject) continue;
      }
      // Definite academy references cannot choose a site for an organizational action.
      if (ref.types.length > 1 && /\b(?:guidance|employs|commissioned|members|engineers|planned|established itself)\b/iu.test(target.text) && anchor.entity.type !== "faction") continue;
      // An explicit contradictory type for the intended name blocks inheritance.
      if (scope.some(u => {
        const types = referentTypes(u, anchor.entity.name, u.context.replace(/_/gu, " ").split(" > ").some(p => key(p) === key(anchor.entity.name)));
        return types.size > 0 && !types.has(anchor.entity.type) && (contains(u.text, anchor.entity.name) || refs.some(r => contains(u.text, r.text)));
      })) continue;
      decisions.push({ entity: anchor.entity, anchor: anchor.unit, direct: target, reference: ref.text });
    }
  }
  if (new Set(decisions.map(d => d.entity.canonicalId)).size !== 1) return null;
  const decision = decisions[0];
  return { ...decision, method: "source_form_coreference" as const, reason: "unique proposition-backed antecedent in contiguous compatible structural scope",
    units: [...new Map([decision.direct, decision.anchor].map(u => [u.unitId, u])).values()] };
}

/** Cache only within one immutable reconciliation invocation. */
export function createSourceFormResolver(units: Unit[], entities: Entity[]) {
  const anchors = new Map<Unit, Array<{ entity: Entity; unit: Unit }>>();
  return { reference: (mention: string, direct: Unit[]) => sourceFormReference(mention, direct, units, entities, anchors),
    generic: (mention: string, direct: Unit[]) => sourceFormGeneric(mention, direct, units, entities) };
}
