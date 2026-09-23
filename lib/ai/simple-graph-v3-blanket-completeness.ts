import { z } from "zod";
import type { AIOperationIdentity } from "@/lib/ai/operation-checkpoint";
import { modelInputHash, semanticInputHash } from "@/lib/ai/operation-checkpoint";
import type { ExtractionContext } from "@/lib/ai/extraction-context";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { relationshipSemanticKey, normalizeRelationshipFact } from "@/lib/relationships/normalize";
import {
  type SimpleGraphV3Output,
  type SimpleGraphV3Request,
  type ValidSimpleGraphV3Relationship,
  simpleGraphV3OutputSchema,
  validateSimpleGraphV3,
} from "@/lib/ai/simple-graph-v3";

export const SIMPLE_GRAPH_V3_BLANKET_BEHAVIOR_VERSION = "v0.7.0-simple-graph-v3-blanket-1";
export const SIMPLE_GRAPH_V3_BLANKET_CONTRACT_VERSION = 1;
export const SIMPLE_GRAPH_V3_BLANKET_EXPECTED_OUTPUT_TOKENS = 3_000;

export const simpleGraphV3BlanketOutputSchema = simpleGraphV3OutputSchema.extend({
  relationships: z.array(simpleGraphV3OutputSchema.shape.relationships.element.extend({
    evidence_segment: simpleGraphV3OutputSchema.shape.relationships.element.shape.evidence_segment.describe(
      "Bare exact supplied segment ID, for example 13b; no brackets or copied source text.",
    ),
  })).max(200),
});

export const SIMPLE_GRAPH_V3_BLANKET_SYSTEM_PROMPT = `Find every explicit relationship supported by the supplied SOURCE that is missing from RELATIONSHIPS ALREADY FOUND.
Inspect the entire supplied source before finalizing. Consider command/control, membership, family, location/containment, ownership, creation, alliance/conflict, identity, and explicit quest/event participation.
Use only supplied entities and source evidence. Preserve direction. Do not invent relationships merely to connect low-degree entities. Co-occurrence alone is insufficient.
Adventure/event titles may be endpoints only when the source explicitly establishes that relationship; do not replace the actual actor with the adventure title.
Do not use outside lore. Do not repeat an existing relationship, including its inverse or equivalent wording. Return each missing semantic relationship once.
Return only source, relationship, target, page, and evidence_segment. The evidence_segment must be the bare exact supplied ID, such as 13b. No facts, quotes, IDs, new entities, summaries, or prose. Return an empty relationships array if nothing is missing.`;

export interface SimpleGraphV3BlanketRequest extends SimpleGraphV3Request {
  existingRelationships: ValidSimpleGraphV3Relationship[];
}

export function planSimpleGraphV3BlanketRequest(
  context: ExtractionContext,
  primaryRequest: SimpleGraphV3Request,
  acceptedFirstPass: ValidSimpleGraphV3Relationship[],
): SimpleGraphV3BlanketRequest {
  if (primaryRequest.sourceSegments.length !== context.sourceSegments.length
    || primaryRequest.sourceSegments.some((segment, index) => segment.segmentId !== context.sourceSegments[index]?.segmentId)) {
    throw new Error("Blanket completeness requires the full V3 primary semantic source in one request");
  }
  const entityIds = new Set(primaryRequest.entities.map((entity) => entity.canonicalId));
  if (acceptedFirstPass.some((edge) => !entityIds.has(edge.sourceCanonicalId) || !entityIds.has(edge.targetCanonicalId))) {
    throw new Error("Accepted first-pass relationship is outside the supplied entity context");
  }
  const unique = new Map<string, ValidSimpleGraphV3Relationship>();
  for (const edge of acceptedFirstPass) {
    const normalized = normalizeRelationshipFact(edge.sourceCanonicalId, edge.targetCanonicalId, edge.relationshipType);
    const key = relationshipSemanticKey(normalized);
    if (!unique.has(key)) unique.set(key, edge);
  }
  return {
    requestId: "simple-v3-blanket-completeness-01",
    sourceSegments: primaryRequest.sourceSegments,
    entities: primaryRequest.entities,
    existingRelationships: [...unique.values()],
  };
}

export function serializeSimpleGraphV3BlanketRequest(request: SimpleGraphV3BlanketRequest) {
  const source = request.sourceSegments.map((segment) => `[${segment.segmentId}] ${segment.semanticText}`).join("\n");
  const entityContext = request.entities.map((entity) => `${entity.name} | ${entity.type}`).join("\n");
  const existingRelationships = request.existingRelationships.map((edge) => `${edge.sourceName} | ${edge.relationship} | ${edge.targetName}`).join("\n");
  return {
    source, entityContext, existingRelationships,
    payload: `SOURCE\n${source}\n\nKNOWN ENTITIES\n${entityContext || "(none)"}\n\nRELATIONSHIPS ALREADY FOUND\n${existingRelationships || "(none)"}`,
  };
}

export function simpleGraphV3BlanketTokenDiagnostics(request: SimpleGraphV3BlanketRequest) {
  const serialized = serializeSimpleGraphV3BlanketRequest(request);
  const characters = {
    source: serialized.source.length,
    entityContext: serialized.entityContext.length,
    existingRelationships: serialized.existingRelationships.length,
    instructions: SIMPLE_GRAPH_V3_BLANKET_SYSTEM_PROMPT.length,
    schema: JSON.stringify(z.toJSONSchema(simpleGraphV3BlanketOutputSchema)).length,
  };
  const estimatedTokens = Object.fromEntries(Object.entries(characters).map(([name, count]) => [name, Math.ceil(count / 4)])) as Record<keyof typeof characters, number>;
  return { characters, estimatedTokens: { ...estimatedTokens, totalInput: Object.values(estimatedTokens).reduce((sum, value) => sum + value, 0), expectedOutputAllowance: SIMPLE_GRAPH_V3_BLANKET_EXPECTED_OUTPUT_TOKENS } };
}

export function validateSimpleGraphV3Blanket(output: SimpleGraphV3Output, request: SimpleGraphV3BlanketRequest) {
  const base = validateSimpleGraphV3(output, request);
  const existing = new Set(request.existingRelationships.map((edge) => edge.semanticKey));
  const relationships = base.relationships.filter((edge) => !existing.has(edge.semanticKey));
  return { ...base, relationships, existingRelationshipRejections: base.relationships.length - relationships.length };
}

export function simpleGraphV3BlanketCheckpointIdentity(args: {
  campaignId: string; documentId: string; sourceExtractionCacheId: string | null;
  providerId: string; modelId: string; request: SimpleGraphV3BlanketRequest;
  contextFingerprint: string;
}): AIOperationIdentity {
  return {
    campaignId: args.campaignId, documentId: args.documentId, sourceExtractionCacheId: args.sourceExtractionCacheId,
    providerId: args.providerId, modelId: args.modelId, processingMode: "simple_graph_v3_blanket",
    stage: "extraction", operationType: "simple_graph_v3_blanket", operationKey: args.request.requestId,
    inputHash: modelInputHash(SIMPLE_GRAPH_V3_BLANKET_SYSTEM_PROMPT, serializeSimpleGraphV3BlanketRequest(args.request).payload),
    upstreamFingerprint: semanticInputHash({ contextFingerprint: args.contextFingerprint, firstPassSemanticKeys: args.request.existingRelationships.map((edge) => edge.semanticKey) }),
    behaviorVersion: SIMPLE_GRAPH_V3_BLANKET_BEHAVIOR_VERSION, schemaVersion: SIMPLE_GRAPH_V3_BLANKET_CONTRACT_VERSION,
  };
}

export function runSimpleGraphV3Blanket(request: SimpleGraphV3BlanketRequest, provider: StructuredModelProvider) {
  return provider.parseStructured({ system: SIMPLE_GRAPH_V3_BLANKET_SYSTEM_PROMPT, payload: serializeSimpleGraphV3BlanketRequest(request).payload, schema: simpleGraphV3BlanketOutputSchema, schemaName: "simple_graph_v3_blanket_output" });
}
