import { z } from "zod";
import type { AIOperationIdentity } from "@/lib/ai/operation-checkpoint";
import { modelInputHash, semanticInputHash } from "@/lib/ai/operation-checkpoint";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import type { ExtractionContext, ExtractionContextEntity, RawSourceMapping, SourceSegment } from "@/lib/ai/extraction-context";
import { boundedEntityContextInSemanticText } from "@/lib/graph/occurrence-index";
import { normalizeName } from "@/lib/graph/normalize";
import { normalizeRelationshipFact, relationshipSemanticKey } from "@/lib/relationships/normalize";

export const SIMPLE_GRAPH_V3_BEHAVIOR_VERSION = "v0.7.0-simple-graph-v3-2";
export const SIMPLE_GRAPH_V3_CONTRACT_VERSION = 1;
export const SIMPLE_GRAPH_V3_TARGET_CHARACTERS = 45_000;

export const simpleGraphV3OutputSchema = z.object({
  relationships: z.array(z.object({
    source: z.string().trim().min(1).max(200),
    relationship: z.string().trim().min(1).max(100),
    target: z.string().trim().min(1).max(200),
    page: z.number().int().positive(),
    evidence_segment: z.string().trim().min(1).max(40),
  }).strict()).max(200),
}).strict();

export type SimpleGraphV3Output = z.infer<typeof simpleGraphV3OutputSchema>;

export const SIMPLE_GRAPH_V3_SYSTEM_PROMPT = `Extract high-recall, explicit campaign relationships among the supplied known entities.
Inspect the entire source. Use only supplied endpoint names or their unambiguous source aliases and only source-supported relationships.
Preserve direction and use concise natural relationship labels. Cite the supporting page and source segment ID.
Omit weak narrative associations, co-occurrence, guesses, and outside lore.
Use the entity that actually performs each action. Do not assign actions by heroes, armies, followers, agents, or other actors to a nearby adventure or event title.
Do not turn conditional or alternative language such as may, might, could, either/or, or hypothetical outcomes into unconditional relationships.
Do not map a generic phenomenon or object to a similarly named entity unless the source clearly identifies them as the same thing.
Return only the fixed relationship schema; no quotes, facts, summaries, confidence, new entities, or prose.`;

export interface SimpleGraphV3Request {
  requestId: string;
  sourceSegments: SourceSegment[];
  entities: ExtractionContextEntity[];
}

export interface SimpleGraphV3Provenance extends RawSourceMapping {
  segmentId: string;
}

export interface ValidSimpleGraphV3Relationship {
  sourceCanonicalId: string;
  targetCanonicalId: string;
  sourceName: string;
  targetName: string;
  relationship: string;
  relationshipType: string;
  semanticKey: string;
  provenance: SimpleGraphV3Provenance[];
}

export interface SimpleGraphV3Validation {
  proposed: number;
  relationships: ValidSimpleGraphV3Relationship[];
  unknownEndpointRejections: number;
  ambiguousEndpointRejections: number;
  selfEdgeRejections: number;
  invalidSegmentRejections: number;
  invalidPageSegmentRejections: number;
  duplicateRelationships: number;
}

export interface SimpleGraphV3CoverageAudit {
  suppliedEntities: number;
  touchedEntities: number;
  zeroDegreeEntityIds: string[];
  zeroDegreeEntityNames: string[];
  relationships: number;
  sourceSegments: number;
  pages: number[];
}

function relevantEntities(context: ExtractionContext, segments: SourceSegment[]) {
  const semanticText = segments.map((segment) => segment.semanticText).join("\n");
  const candidates = context.entities.map((entity) => ({ temporary_id: entity.canonicalId, name: entity.name, type: entity.type, aliases: entity.aliases }));
  const ids = new Set(boundedEntityContextInSemanticText(candidates, semanticText).entityIds);
  return context.entities.filter((entity) => ids.has(entity.canonicalId));
}

export function planSimpleGraphV3Requests(context: ExtractionContext, targetCharacters = SIMPLE_GRAPH_V3_TARGET_CHARACTERS): SimpleGraphV3Request[] {
  const groups: SourceSegment[][] = [];
  let current: SourceSegment[] = [];
  let characters = 0;
  for (const segment of context.sourceSegments) {
    const addition = segment.semanticText.length + segment.segmentId.length + 4;
    if (current.length && characters + addition > targetCharacters) { groups.push(current); current = []; characters = 0; }
    current.push(segment); characters += addition;
  }
  if (current.length) groups.push(current);
  return groups.map((sourceSegments, index) => ({ requestId: `simple-v3-${String(index + 1).padStart(2, "0")}`, sourceSegments, entities: relevantEntities(context, sourceSegments) }));
}

export function serializeSimpleGraphV3Request(request: SimpleGraphV3Request) {
  const entityContext = request.entities.map((entity) => `${entity.name} | ${entity.type}`).join("\n");
  const source = request.sourceSegments.map((segment) => `[${segment.segmentId}] ${segment.semanticText}`).join("\n");
  return { entityContext, source, payload: `KNOWN ENTITIES\n${entityContext || "(none)"}\n\nSOURCE\n${source}` };
}

export function simpleGraphV3TokenDiagnostics(request: SimpleGraphV3Request) {
  const serialized = serializeSimpleGraphV3Request(request);
  const schema = JSON.stringify(z.toJSONSchema(simpleGraphV3OutputSchema));
  const characters = { source: serialized.source.length, entityContext: serialized.entityContext.length, prompt: SIMPLE_GRAPH_V3_SYSTEM_PROMPT.length, schema: schema.length };
  const tokens = Object.fromEntries(Object.entries(characters).map(([key, value]) => [key, Math.ceil(value / 4)])) as Record<keyof typeof characters, number>;
  return { characters, estimatedTokens: { ...tokens, totalInput: Object.values(tokens).reduce((sum, value) => sum + value, 0) } };
}

function endpointMatches(entities: ExtractionContextEntity[], value: string) {
  const normalized = normalizeName(value);
  const canonicalMatches = entities.filter((entity) => normalizeName(entity.name) === normalized);
  if (canonicalMatches.length) return canonicalMatches;
  const aliasMatches = entities.filter((entity) => entity.aliases.some((alias) => normalizeName(alias) === normalized));
  if (aliasMatches.length) return aliasMatches;
  const toggledArticle = normalized.startsWith("the ") ? normalized.slice(4) : `the ${normalized}`;
  return entities.filter((entity) => [entity.name, ...entity.aliases].some((name) => normalizeName(name) === toggledArticle));
}

/** Accepts the exact supplied ID, or the exact ID copied from a leading [ID]. */
export function normalizeSimpleGraphV3EvidenceSegmentId(value: string, suppliedSegmentIds: ReadonlySet<string>): string | null {
  if (suppliedSegmentIds.has(value)) return value;
  const leading = value.match(/^\[([^\]\r\n]+)\]/u)?.[1] ?? null;
  return leading && suppliedSegmentIds.has(leading) ? leading : null;
}

export function validateSimpleGraphV3(output: SimpleGraphV3Output, request: SimpleGraphV3Request): SimpleGraphV3Validation {
  const parsed = simpleGraphV3OutputSchema.parse(output);
  const segments = new Map(request.sourceSegments.map((segment) => [segment.segmentId, segment]));
  const suppliedSegmentIds = new Set(segments.keys());
  const retained = new Map<string, ValidSimpleGraphV3Relationship>();
  const result: SimpleGraphV3Validation = { proposed: parsed.relationships.length, relationships: [], unknownEndpointRejections: 0, ambiguousEndpointRejections: 0, selfEdgeRejections: 0, invalidSegmentRejections: 0, invalidPageSegmentRejections: 0, duplicateRelationships: 0 };
  for (const candidate of parsed.relationships) {
    const segmentId = normalizeSimpleGraphV3EvidenceSegmentId(candidate.evidence_segment, suppliedSegmentIds);
    const segment = segmentId ? segments.get(segmentId) : undefined;
    if (!segment) { result.invalidSegmentRejections += 1; continue; }
    if (segment.page !== candidate.page) { result.invalidPageSegmentRejections += 1; continue; }
    const sources = endpointMatches(request.entities, candidate.source);
    const targets = endpointMatches(request.entities, candidate.target);
    if (!sources.length || !targets.length) { result.unknownEndpointRejections += 1; continue; }
    if (sources.length !== 1 || targets.length !== 1) { result.ambiguousEndpointRejections += 1; continue; }
    if (sources[0].canonicalId === targets[0].canonicalId) { result.selfEdgeRejections += 1; continue; }
    const normalized = normalizeRelationshipFact(sources[0].canonicalId, targets[0].canonicalId, candidate.relationship);
    const semanticKey = relationshipSemanticKey(normalized);
    const provenance: SimpleGraphV3Provenance = { segmentId: segment.segmentId, ...segment.rawSource };
    const prior = retained.get(semanticKey);
    if (prior) {
      result.duplicateRelationships += 1;
      if (!prior.provenance.some((item) => item.segmentId === provenance.segmentId)) prior.provenance.push(provenance);
      continue;
    }
    retained.set(semanticKey, { sourceCanonicalId: normalized.sourceId, targetCanonicalId: normalized.targetId, sourceName: sources[0].name, targetName: targets[0].name, relationship: normalized.canonicalType, relationshipType: normalized.canonicalType, semanticKey, provenance: [provenance] });
  }
  result.relationships = [...retained.values()];
  return result;
}

export function auditSimpleGraphV3Coverage(requests: SimpleGraphV3Request[], relationships: ValidSimpleGraphV3Relationship[]): SimpleGraphV3CoverageAudit {
  const entities = new Map(requests.flatMap((request) => request.entities).map((entity) => [entity.canonicalId, entity]));
  const touched = new Set(relationships.flatMap((relationship) => [relationship.sourceCanonicalId, relationship.targetCanonicalId]));
  const zeroDegree = [...entities.values()].filter((entity) => !touched.has(entity.canonicalId));
  return {
    suppliedEntities: entities.size,
    touchedEntities: [...entities].filter(([id]) => touched.has(id)).length,
    zeroDegreeEntityIds: zeroDegree.map((entity) => entity.canonicalId),
    zeroDegreeEntityNames: zeroDegree.map((entity) => entity.name),
    relationships: relationships.length,
    sourceSegments: new Set(requests.flatMap((request) => request.sourceSegments.map((segment) => segment.segmentId))).size,
    pages: [...new Set(requests.flatMap((request) => request.sourceSegments.map((segment) => segment.page)))].sort((left, right) => left - right),
  };
}

export function simpleGraphV3CheckpointIdentity(args: {
  campaignId: string;
  documentId: string;
  sourceExtractionCacheId: string | null;
  providerId: string;
  modelId: string;
  request: SimpleGraphV3Request;
  contextFingerprint: string;
}): AIOperationIdentity {
  const serialized = serializeSimpleGraphV3Request(args.request);
  return {
    campaignId: args.campaignId,
    documentId: args.documentId,
    sourceExtractionCacheId: args.sourceExtractionCacheId,
    providerId: args.providerId,
    modelId: args.modelId,
    processingMode: "simple_graph_v3",
    stage: "extraction",
    operationType: "simple_graph_v3",
    operationKey: args.request.requestId,
    inputHash: modelInputHash(SIMPLE_GRAPH_V3_SYSTEM_PROMPT, serialized.payload),
    upstreamFingerprint: semanticInputHash({ contextFingerprint: args.contextFingerprint, entityIds: args.request.entities.map((entity) => entity.canonicalId), segmentIds: args.request.sourceSegments.map((segment) => segment.segmentId) }),
    behaviorVersion: SIMPLE_GRAPH_V3_BEHAVIOR_VERSION,
    schemaVersion: SIMPLE_GRAPH_V3_CONTRACT_VERSION,
  };
}

export function runSimpleGraphV3(request: SimpleGraphV3Request, provider: StructuredModelProvider) {
  return provider.parseStructured({ system: SIMPLE_GRAPH_V3_SYSTEM_PROMPT, payload: serializeSimpleGraphV3Request(request).payload, schema: simpleGraphV3OutputSchema, schemaName: "simple_graph_v3_output" });
}
