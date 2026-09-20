import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { buildInventoryInput, buildRichExtractionInput } from "../lib/ai/prompts";
import type { CandidateRelationship, ChunkExtraction, ValidatedExtractionInventoryOutput } from "../lib/ai/schemas";
import { normalizeName } from "../lib/graph/normalize";
import { normalizeRelationshipFact, type NormalizedRelationshipFact } from "../lib/relationships/normalize";
import { chunkPages } from "../lib/pdf/chunk-pages";
import { extractPdfPages } from "../lib/pdf/extract-text";
import type { DocumentPage, PageChunk } from "../lib/pdf/types";

export const WOTBS_STAGE1_EXPECTED_PDF_SHA256 = "509f81457b95b03a5871ee1ff4faa0e0216da3790c4d57e3a2d7fcf653a8b990";
export const WOTBS_STAGE1_EXPECTED_NORMALIZED_TEXT_SHA256 = "b55c21c75accc6a3c0fba563d5eba4f0396ddc23cf3dce14c59150f283273281";
export const WOTBS_STAGE1_PDF_PAGES = [10, 11, 12] as const;
export const WOTBS_STAGE1_EXPECTED_MODEL = "qwen3.5:9b";
export const WOTBS_STAGE1_EXPECTED_DIGEST = "6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7";
export const WOTBS_STAGE1_CONTEXT = 32_768;

export interface WotbsGoldEntity {
  name: string;
  accepted_types: string[];
  aliases?: string[];
}

export interface WotbsGoldRelationship {
  source: string;
  relation: string;
  target: string;
}

export interface WotbsGoldReference {
  fixture: string;
  source: { document: string; pdf_pages: number[]; purpose: string };
  hard_entities: WotbsGoldEntity[];
  soft_entities: WotbsGoldEntity[];
  core_relationships: WotbsGoldRelationship[];
  core_facts: Array<{ entity: string; fact: string }>;
}

export interface WotbsFixture {
  pdfSha256: string;
  normalizedTextSha256: string;
  normalizedCharacterCount: number;
  sourceCharacterCount: number;
  estimatedSourceTokens: number;
  pages: DocumentPage[];
  chunks: PageChunk[];
}

export interface InventoryScore {
  matched: number;
  expected: number;
  supportedEntityRecall: number;
  referenceBoundedPrecision: number;
  f1: number;
  perTypeRecall: Record<string, { matched: number; expected: number; recall: number }>;
  fixtureMisses: Array<{ name: string; acceptedTypes: string[] }>;
  matchedGoldNames: string[];
  supportedExtractedCount: number;
  adventureTitles: { matched: number; expected: 12; recall: number; misses: string[] };
  questRecall: number;
  itemRecall: number;
  anchorNames: { matched: string[]; missing: string[] };
  duplicateGoldMatches: Array<{ goldName: string; inventoryIds: string[]; extractedNames: string[] }>;
}

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function normalizedFixtureText(pages: DocumentPage[]): string {
  return pages.map((page) => page.text).join("\n\f\n");
}

export async function loadWotbsStage1Fixture(pdfPath: string): Promise<WotbsFixture> {
  const pdf = readFileSync(pdfPath);
  const extracted = await extractPdfPages(pdf);
  if (extracted.length !== WOTBS_STAGE1_PDF_PAGES.length) throw new Error(`WotBS Stage 1 PDF page count changed: ${extracted.length}`);
  const pages = extracted.map((page, index) => ({ ...page, pageNumber: WOTBS_STAGE1_PDF_PAGES[index] }));
  const normalizedText = normalizedFixtureText(pages);
  const chunks = chunkPages(pages);
  const fixture = {
    pdfSha256: sha256(pdf),
    normalizedTextSha256: sha256(normalizedText),
    normalizedCharacterCount: normalizedText.length,
    sourceCharacterCount: pages.reduce((sum, page) => sum + page.text.length, 0),
    estimatedSourceTokens: Math.ceil(pages.reduce((sum, page) => sum + page.text.length, 0) / 4),
    pages,
    chunks,
  };
  if (fixture.pdfSha256 !== WOTBS_STAGE1_EXPECTED_PDF_SHA256) throw new Error(`WotBS Stage 1 PDF hash changed: ${fixture.pdfSha256}`);
  if (fixture.normalizedTextSha256 !== WOTBS_STAGE1_EXPECTED_NORMALIZED_TEXT_SHA256) throw new Error(`WotBS Stage 1 normalized text hash changed: ${fixture.normalizedTextSha256}`);
  if (pages.map((page) => page.pageNumber).join(",") !== WOTBS_STAGE1_PDF_PAGES.join(",")) throw new Error("WotBS Stage 1 page provenance changed");
  return fixture;
}

export function loadWotbsGoldReference(path: string): { reference: WotbsGoldReference; raw: string } {
  const raw = readFileSync(path, "utf8");
  return { reference: JSON.parse(raw) as WotbsGoldReference, raw };
}

function serializeModelInput(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function assertGoldReferenceIsolation(
  modelInputs: unknown[],
  goldArtifacts: Array<{ path: string; raw: string }>,
): void {
  const input = modelInputs.map(serializeModelInput).join("\n");
  const fixedMarkers = ["WOTBS_STAGE1_GOLD_REFERENCE", "accepted_types", "hard_entities", "core_relationships", "Evaluation only. Never place this gold reference"];
  const leaked = [
    ...fixedMarkers.filter((marker) => input.includes(marker)),
    ...goldArtifacts.flatMap(({ path, raw }) => [basename(path), raw.trim()].filter((marker) => marker.length >= 16 && input.includes(marker))),
  ];
  if (leaked.length) throw new Error(`Gold reference leaked into model input: ${leaked[0]}`);
}

function aliases(entity: WotbsGoldEntity): string[] {
  return [entity.name, ...(entity.aliases ?? [])].map(normalizeName);
}

function acceptedType(entity: WotbsGoldEntity, type: string): boolean {
  return entity.accepted_types.some((accepted) => accepted.toLocaleLowerCase("en-US") === type);
}

function goldIndexFor(entity: { name: string; type: string }, gold: WotbsGoldEntity[]): number | null {
  const name = normalizeName(entity.name);
  const matches = gold.map((item, index) => ({ item, index })).filter(({ item }) => aliases(item).includes(name) && acceptedType(item, entity.type));
  return matches.length === 1 ? matches[0].index : null;
}

const namedAnchors = [
  "Drakus Coaltongue", "Supreme Inquisitor Leska", "Shaaladel", "Shalosha", "Pilus",
  "Torch of the Burning Sky", "Gate Pass", "Seaquen", "Lyceum",
];

export function scoreWotbsInventory(inventory: ValidatedExtractionInventoryOutput, reference: WotbsGoldReference): InventoryScore {
  const expected = reference.hard_entities;
  const matchedIndices = new Set<number>();
  const extractedMatches = new Map<number, typeof inventory.entities>();
  for (const entity of inventory.entities) {
    const index = goldIndexFor(entity, expected);
    if (index === null) continue;
    matchedIndices.add(index);
    extractedMatches.set(index, [...(extractedMatches.get(index) ?? []), entity]);
  }
  const perTypeRecall = Object.fromEntries([...new Set(expected.map((entity) => entity.accepted_types[0].toLocaleLowerCase("en-US")))].sort().map((type) => {
    const indices = expected.map((entity, index) => ({ entity, index })).filter(({ entity }) => entity.accepted_types[0].toLocaleLowerCase("en-US") === type).map(({ index }) => index);
    const matched = indices.filter((index) => matchedIndices.has(index)).length;
    return [type, { matched, expected: indices.length, recall: indices.length ? matched / indices.length : 1 }];
  }));
  const questIndices = expected.map((entity, index) => ({ entity, index })).filter(({ entity }) => entity.accepted_types[0] === "Quest");
  const itemIndices = expected.map((entity, index) => ({ entity, index })).filter(({ entity }) => entity.accepted_types[0] === "Item");
  const supportedExtractedCount = inventory.entities.filter((entity) => goldIndexFor(entity, expected) !== null).length;
  const recall = expected.length ? matchedIndices.size / expected.length : 1;
  const precision = inventory.entities.length ? supportedExtractedCount / inventory.entities.length : 0;
  const anchorNames = namedAnchors.reduce((result, name) => {
    const index = expected.findIndex((entity) => entity.name === name);
    result[matchedIndices.has(index) ? "matched" : "missing"].push(name);
    return result;
  }, { matched: [] as string[], missing: [] as string[] });
  const questMisses = questIndices.filter(({ index }) => !matchedIndices.has(index)).map(({ entity }) => entity.name);
  return {
    matched: matchedIndices.size,
    expected: expected.length,
    supportedEntityRecall: recall,
    referenceBoundedPrecision: precision,
    f1: recall + precision ? (2 * recall * precision) / (recall + precision) : 0,
    perTypeRecall,
    fixtureMisses: expected.filter((_, index) => !matchedIndices.has(index)).map((entity) => ({ name: entity.name, acceptedTypes: entity.accepted_types })),
    matchedGoldNames: [...matchedIndices].sort((a, b) => a - b).map((index) => expected[index].name),
    supportedExtractedCount,
    adventureTitles: { matched: 12 - questMisses.length, expected: 12, recall: (12 - questMisses.length) / 12, misses: questMisses },
    questRecall: questIndices.length ? questIndices.filter(({ index }) => matchedIndices.has(index)).length / questIndices.length : 1,
    itemRecall: itemIndices.length ? itemIndices.filter(({ index }) => matchedIndices.has(index)).length / itemIndices.length : 1,
    anchorNames,
    duplicateGoldMatches: [...extractedMatches.entries()].filter(([, entities]) => entities.length > 1).map(([index, entities]) => ({ goldName: expected[index].name, inventoryIds: entities.map((entity) => entity.temporary_id), extractedNames: entities.map((entity) => entity.name) })),
  };
}

type RelationshipScoringFamily =
  | "advisory"
  | "association"
  | "classification"
  | "command"
  | "knowledge"
  | "location"
  | "membership"
  | "ownership"
  | "parenthood"
  | "possession_or_use"
  | "rule"
  | "sibling"
  | "slain_location";

const exactScoringFamilies: Record<string, RelationshipScoringFamily[]> = {
  "parent of": ["parenthood"],
  owns: ["ownership", "possession_or_use"],
  "member of": ["membership", "association"],
  "located in": ["location", "association"],
  command: ["command"],
  commands: ["command"],
  "advisor to": ["advisory"],
  advises: ["advisory"],
  "is advisor to": ["advisory"],
  rules: ["rule"],
  ruled: ["rule"],
  "rules or ruled": ["rule"],
  "ruler of": ["rule"],
  governs: ["rule"],
  "is emperor of": ["rule"],
  "associated with": ["association"],
  leads: ["association"],
  "head of": ["association"],
  "based in": ["association"],
  "brother of": ["sibling"],
  "wielded or acquired": ["possession_or_use"],
  wielded: ["possession_or_use"],
  acquired: ["possession_or_use"],
  possesses: ["possession_or_use"],
  uses: ["possession_or_use"],
  "slain at": ["slain_location"],
  "was slain in": ["slain_location"],
  "knows weaknesses of": ["knowledge"],
  "located at": ["location"],
  "lies in": ["location", "association"],
  within: ["location", "association"],
  "is a": ["classification"],
};

// Evaluator-only direction aliases. Production reconciliation never consumes
// this table; it exists solely to preserve historical benchmark comparability.
const inverseScoringLabels: Record<string, string> = {
  contains: "located in",
  "child of": "parent of",
  "owned by": "owns",
  "has member": "member of",
  "used by": "uses",
};

const productionSemanticFamilies: Record<string, RelationshipScoringFamily[]> = {
  "parent of": ["parenthood"],
  family_parent: ["parenthood"],
  owns: ["ownership", "possession_or_use"],
  ownership: ["ownership", "possession_or_use"],
  acquisition: ["possession_or_use"],
  membership: ["membership", "association"],
  "located in": ["location", "association"],
  location_containment: ["location", "association"],
  "sibling of": ["sibling"],
  family_sibling: ["sibling"],
  command: ["command"],
  advice: ["advisory"],
  rulership: ["rule"],
  rulership_emperor: ["rule"],
  leadership: ["association"],
};

export interface CanonicalScoringRelationship {
  sourceId: string;
  targetId: string;
  primaryFamily: string;
  acceptedFamilies: string[];
  productionSemanticType: string;
  normalizedInputType: string;
}

function scoringFamilies(fact: NormalizedRelationshipFact): string[] {
  return productionSemanticFamilies[fact.semanticType]
    ?? exactScoringFamilies[fact.normalizedInputType]
    ?? [fact.semanticType];
}

/**
 * Canonicalizes evaluator edges with a frozen evaluator-only equivalence layer.
 * Production relationship semantics are model-reconciled and do not consume it.
 */
export function canonicalizeRelationshipForScoring(
  sourceId: string,
  targetId: string,
  relationshipType: string,
): CanonicalScoringRelationship {
  const initiallyNormalized = normalizeRelationshipFact(sourceId, targetId, relationshipType);
  const inverseLabel = inverseScoringLabels[initiallyNormalized.normalizedInputType];
  const fact = inverseLabel ? normalizeRelationshipFact(targetId, sourceId, inverseLabel) : initiallyNormalized;
  const acceptedFamilies = scoringFamilies(fact);
  const [canonicalSource, canonicalTarget] = acceptedFamilies.includes("sibling")
    ? [fact.sourceId, fact.targetId].sort()
    : [fact.sourceId, fact.targetId];
  return {
    sourceId: canonicalSource,
    targetId: canonicalTarget,
    primaryFamily: acceptedFamilies[0],
    acceptedFamilies,
    productionSemanticType: fact.semanticType,
    normalizedInputType: fact.normalizedInputType,
  };
}

export function relationshipsMatchForScoring(
  actual: { sourceId: string; targetId: string; relationshipType: string },
  expected: { sourceId: string; targetId: string; relationshipType: string },
): boolean {
  const candidate = canonicalizeRelationshipForScoring(actual.sourceId, actual.targetId, actual.relationshipType);
  const gold = canonicalizeRelationshipForScoring(expected.sourceId, expected.targetId, expected.relationshipType);
  return candidate.sourceId === gold.sourceId
    && candidate.targetId === gold.targetId
    && candidate.acceptedFamilies.includes(gold.primaryFamily);
}

function resolveGoldName(name: string, reference: WotbsGoldReference): string | null {
  const normalized = normalizeName(name);
  const match = [...reference.hard_entities, ...reference.soft_entities].find((entity) => aliases(entity).includes(normalized));
  return match?.name ?? null;
}

export function scoreWotbsRelationships(
  relationships: CandidateRelationship[],
  inventory: ValidatedExtractionInventoryOutput,
  reference: WotbsGoldReference,
) {
  const names = new Map(inventory.entities.map((entity) => [entity.temporary_id, resolveGoldName(entity.name, reference) ?? entity.name]));
  const recovered = reference.core_relationships.filter((gold) => relationships.some((relationship) => {
    const source = names.get(relationship.source_temporary_id);
    const target = names.get(relationship.target_temporary_id);
    if (!source || !target) return false;
    return relationshipsMatchForScoring(
      { sourceId: normalizeName(source), targetId: normalizeName(target), relationshipType: relationship.relationship_type },
      { sourceId: normalizeName(gold.source), targetId: normalizeName(gold.target), relationshipType: gold.relation },
    );
  }));
  return { recovered: recovered.map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`), missed: reference.core_relationships.filter((relationship) => !recovered.includes(relationship)).map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`) };
}

export function candidateAssemblySafety(inventory: ValidatedExtractionInventoryOutput, candidate: ChunkExtraction) {
  const inventoryIds = new Set(inventory.entities.map((entity) => entity.temporary_id));
  const candidateIds = new Set(candidate.entities.map((entity) => entity.temporary_id));
  const missingInventoryIds = [...inventoryIds].filter((id) => !candidateIds.has(id));
  const unknownFactOwners = candidate.entities.filter((entity) => !inventoryIds.has(entity.temporary_id)).map((entity) => entity.temporary_id);
  const unknownRelationshipEndpoints = candidate.relationships.flatMap((relationship) => [relationship.source_temporary_id, relationship.target_temporary_id]).filter((id) => !inventoryIds.has(id));
  return {
    inventorySurvives: missingInventoryIds.length === 0,
    missingInventoryIds,
    aliasesKnownIdsOnly: unknownFactOwners.length === 0,
    factsKnownIdsOnly: unknownFactOwners.length === 0,
    unknownFactOwners,
    relationshipEndpointsKnownIdsOnly: unknownRelationshipEndpoints.length === 0,
    unknownRelationshipEndpoints,
  };
}

export function wotbsModelInputs(chunk: PageChunk, inventory?: ValidatedExtractionInventoryOutput): unknown[] {
  return inventory ? [buildRichExtractionInput(chunk, inventory)] : [buildInventoryInput(chunk)];
}
