import { normalizeRelationshipType } from "@/lib/graph/normalize";

interface InverseDefinition {
  semanticType: string;
  canonicalType: string;
  canonicalLabel: string;
  inverseLabel: string;
  reverse: boolean;
}

const inverseDefinitions: Record<string, InverseDefinition> = {
  "parent of": { semanticType: "parent of", canonicalType: "parent of", canonicalLabel: "parent of", inverseLabel: "child of", reverse: false },
  "child of": { semanticType: "parent of", canonicalType: "parent of", canonicalLabel: "parent of", inverseLabel: "child of", reverse: true },
  owns: { semanticType: "owns", canonicalType: "owns", canonicalLabel: "owns", inverseLabel: "owned by", reverse: false },
  "owned by": { semanticType: "owns", canonicalType: "owns", canonicalLabel: "owns", inverseLabel: "owned by", reverse: true },
  "member of": { semanticType: "membership", canonicalType: "member of", canonicalLabel: "member of", inverseLabel: "has member", reverse: false },
  "serves on": { semanticType: "membership", canonicalType: "member of", canonicalLabel: "member of", inverseLabel: "has member", reverse: false },
  "has member": { semanticType: "membership", canonicalType: "member of", canonicalLabel: "member of", inverseLabel: "has member", reverse: true },
  "located in": { semanticType: "located in", canonicalType: "located in", canonicalLabel: "located in", inverseLabel: "contains", reverse: false },
  contains: { semanticType: "located in", canonicalType: "located in", canonicalLabel: "located in", inverseLabel: "contains", reverse: true },
  "uncle of": { semanticType: "avuncular", canonicalType: "uncle of", canonicalLabel: "uncle of", inverseLabel: "nephew of", reverse: false },
  "aunt of": { semanticType: "avuncular", canonicalType: "aunt of", canonicalLabel: "aunt of", inverseLabel: "niece of", reverse: false },
  "nephew of": { semanticType: "avuncular", canonicalType: "aunt or uncle of", canonicalLabel: "aunt or uncle of", inverseLabel: "nephew of", reverse: true },
  "niece of": { semanticType: "avuncular", canonicalType: "aunt or uncle of", canonicalLabel: "aunt or uncle of", inverseLabel: "niece of", reverse: true },
  "sibling of": { semanticType: "sibling of", canonicalType: "sibling of", canonicalLabel: "sibling of", inverseLabel: "sibling of", reverse: false },
  "created by": { semanticType: "created by", canonicalType: "created by", canonicalLabel: "created by", inverseLabel: "created", reverse: false },
  serves: { semanticType: "serves", canonicalType: "serves", canonicalLabel: "serves", inverseLabel: "served by", reverse: false },
  needs: { semanticType: "needs", canonicalType: "needs", canonicalLabel: "needs", inverseLabel: "needed by", reverse: false },
  kills: { semanticType: "kills", canonicalType: "kills", canonicalLabel: "kills", inverseLabel: "killed by", reverse: false },
  teaches: { semanticType: "teaches", canonicalType: "teaches", canonicalLabel: "teaches", inverseLabel: "taught by", reverse: false },
  advises: { semanticType: "advises", canonicalType: "advises", canonicalLabel: "advises", inverseLabel: "advised by", reverse: false },
  "bodyguard of": { semanticType: "bodyguard of", canonicalType: "bodyguard of", canonicalLabel: "bodyguard of", inverseLabel: "guarded by", reverse: false },
  "personal guard of": { semanticType: "personal guard of", canonicalType: "personal guard of", canonicalLabel: "personal guard of", inverseLabel: "has personal guard", reverse: false },
  "emperor of": { semanticType: "emperor of", canonicalType: "emperor of", canonicalLabel: "emperor of", inverseLabel: "has emperor", reverse: false },
  "is emperor of": { semanticType: "emperor of", canonicalType: "emperor of", canonicalLabel: "emperor of", inverseLabel: "has emperor", reverse: false },
  rules: { semanticType: "rules", canonicalType: "rules", canonicalLabel: "rules", inverseLabel: "ruled by", reverse: false },
  conquered: { semanticType: "conquered", canonicalType: "conquered", canonicalLabel: "conquered", inverseLabel: "conquered by", reverse: false },
  commands: { semanticType: "commands", canonicalType: "commands", canonicalLabel: "commands", inverseLabel: "commanded by", reverse: false },
  leads: { semanticType: "leads", canonicalType: "leads", canonicalLabel: "leads", inverseLabel: "led by", reverse: false },
  attacks: { semanticType: "attacks", canonicalType: "attacks", canonicalLabel: "attacks", inverseLabel: "attacked by", reverse: false },
  created: { semanticType: "created", canonicalType: "created", canonicalLabel: "created", inverseLabel: "created by", reverse: false },
};

const obviousGrammarVariants: Record<string, string> = {
  kill: "kills",
  killed: "kills",
  teach: "teaches",
  taught: "teaches",
};

export interface NormalizedRelationshipFact {
  sourceId: string;
  targetId: string;
  semanticType: string;
  canonicalType: string;
  forwardLabel: string;
  inverseLabel: string;
  normalizedInputType: string;
  knownInverse: boolean;
  reversed: boolean;
}

export interface RelationshipPresentation {
  relationshipType: string;
  forwardLabel: string;
  inverseLabel: string;
}

export function normalizeRelationshipFact(sourceId: string, targetId: string, relationshipType: string): NormalizedRelationshipFact {
  const normalizedInputType = normalizeRelationshipType(relationshipType);
  const definition = inverseDefinitions[obviousGrammarVariants[normalizedInputType] ?? normalizedInputType];
  if (!definition) {
    const trimmedType = relationshipType.trim();
    return {
      sourceId,
      targetId,
      semanticType: `freeform:${normalizedInputType}`,
      canonicalType: trimmedType,
      forwardLabel: trimmedType,
      inverseLabel: trimmedType,
      normalizedInputType,
      knownInverse: false,
      reversed: false,
    };
  }

  return {
    sourceId: definition.reverse ? targetId : sourceId,
    targetId: definition.reverse ? sourceId : targetId,
    semanticType: definition.semanticType,
    canonicalType: definition.canonicalType,
    forwardLabel: definition.canonicalLabel,
    inverseLabel: definition.inverseLabel,
    normalizedInputType,
    knownInverse: true,
    reversed: definition.reverse,
  };
}

export function relationshipPresentation(facts: NormalizedRelationshipFact[]): RelationshipPresentation {
  const first = facts[0];
  if (!first) throw new Error("At least one relationship fact is required");
  if (first.semanticType !== "avuncular") {
    return {
      relationshipType: first.canonicalType,
      forwardLabel: first.forwardLabel,
      inverseLabel: first.inverseLabel,
    };
  }

  const inputTypes = new Set(facts.map((fact) => fact.normalizedInputType));
  const adultLabels = ["uncle of", "aunt of"].filter((type) => inputTypes.has(type));
  const youngerLabels = ["nephew of", "niece of"].filter((type) => inputTypes.has(type));
  const inverseLabel = youngerLabels.length === 1
    ? youngerLabels[0]
    : adultLabels[0] === "uncle of"
      ? "nephew of"
      : adultLabels[0] === "aunt of"
        ? "niece of"
        : "niece or nephew of";
  return {
    relationshipType: adultLabels.length === 1 ? adultLabels[0] : "aunt or uncle of",
    forwardLabel: adultLabels.length === 1 ? adultLabels[0] : "aunt or uncle of",
    inverseLabel,
  };
}

export function relationshipSemanticKey(fact: NormalizedRelationshipFact): string {
  return `${fact.sourceId}|${fact.targetId}|${fact.semanticType}`;
}
