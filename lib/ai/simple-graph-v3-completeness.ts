import { z } from "zod";
import type { ExtractionContext, ExtractionContextEntity, SourceSegment } from "@/lib/ai/extraction-context";
import { boundedEntityContextInSemanticText } from "@/lib/graph/occurrence-index";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import {
  type SimpleGraphV3Output,
  type SimpleGraphV3Request,
  type ValidSimpleGraphV3Relationship,
  simpleGraphV3OutputSchema,
  validateSimpleGraphV3,
} from "@/lib/ai/simple-graph-v3";

export const SIMPLE_GRAPH_V3_COMPLETENESS_BEHAVIOR_VERSION = "v0.7.0-simple-graph-v3-completeness-2";
export const SIMPLE_GRAPH_V3_COMPLETENESS_CONTRACT_VERSION = 2;
export const SIMPLE_GRAPH_V3_COMPLETENESS_MAX_TARGETS = 24;
export const SIMPLE_GRAPH_V3_COMPLETENESS_MAX_SEGMENTS = 12;
export const SIMPLE_GRAPH_V3_COMPLETENESS_EXPECTED_OUTPUT_TOKENS = 3_000;
export const simpleGraphV3CompletenessOutputSchema = simpleGraphV3OutputSchema.extend({
  relationships: z.array(simpleGraphV3OutputSchema.shape.relationships.element.extend({
    evidence_segment: simpleGraphV3OutputSchema.shape.relationships.element.shape.evidence_segment.describe(
      "Bare exact ID of a supplied source segment, for example 13b. Do not include brackets, quotes, or source text.",
    ),
  })).max(200),
});

export const SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT = `Find every missing explicit, campaign-relevant relationship between the supplied known entities where at least one endpoint is marked TARGET.
Inspect every supplied source segment before finalizing. Do not stop after finding one relationship.
Consider command/control, membership, family, location/containment, ownership, creation, alliance/conflict, identity, and explicit quest/event participation when supported by the source.
Use only supplied entities and source; no outside lore. Co-occurrence alone is not a relationship. Do not repeat a relationship already found, including an obvious inverse or equivalent wording.
Preserve direction and use a concise natural label. Return each missing semantic relationship once with its supporting page and evidence_segment as the bare exact segment ID only (for example, 13b): no brackets, quote, or other text.
Return an empty relationships array only if none exist across the full supplied source. Return no facts, summaries, confidence, new entities, or prose.`;

export type CompletenessSignal = "zero_degree" | "repeated_low_degree" | "uncovered_occurrences";

export interface SimpleGraphV3CompletenessTarget {
  entity: ExtractionContextEntity;
  degree: number;
  occurrenceSegmentIds: string[];
  uncoveredSegmentIds: string[];
  signals: CompletenessSignal[];
}

export interface SimpleGraphV3CompletenessRequest extends SimpleGraphV3Request {
  targets: SimpleGraphV3CompletenessTarget[];
  existingRelationships: ValidSimpleGraphV3Relationship[];
}

export interface SimpleGraphV3CompletenessPlan {
  requests: SimpleGraphV3CompletenessRequest[];
  targets: SimpleGraphV3CompletenessTarget[];
  selectedSegmentIds: string[];
}

function segmentEntityIds(context: ExtractionContext, segment: SourceSegment): string[] {
  const candidates = context.entities.map((entity) => ({
    temporary_id: entity.canonicalId,
    name: entity.name,
    type: entity.type,
    aliases: entity.aliases,
  }));
  const bounded = boundedEntityContextInSemanticText(candidates, segment.semanticText);
  const entityById = new Map(context.entities.map((entity) => [entity.canonicalId, entity]));
  // A verbally inferred event identity is useful as nearby context, but it is
  // too indirect to make that event a completeness target by itself.
  return [...bounded.occurringEntityIds, ...bounded.contextEntityIds.filter((id) => entityById.get(id)?.type !== "event")];
}

function targetPriority(target: SimpleGraphV3CompletenessTarget): number {
  return (target.signals.includes("zero_degree") ? 10_000 : 0)
    + (target.signals.includes("repeated_low_degree") ? 3_000 : 0)
    + (target.signals.includes("uncovered_occurrences") ? 1_000 : 0)
    + target.uncoveredSegmentIds.length * 20
    + target.occurrenceSegmentIds.length;
}

export function planSimpleGraphV3Completeness(
  context: ExtractionContext,
  relationships: ValidSimpleGraphV3Relationship[],
  limits: { maxTargets?: number; maxSegments?: number } = {},
): SimpleGraphV3CompletenessPlan {
  const maxTargets = limits.maxTargets ?? SIMPLE_GRAPH_V3_COMPLETENESS_MAX_TARGETS;
  const maxSegments = limits.maxSegments ?? SIMPLE_GRAPH_V3_COMPLETENESS_MAX_SEGMENTS;
  const idsBySegment = new Map(context.sourceSegments.map((segment) => [segment.segmentId, segmentEntityIds(context, segment)]));
  const degree = new Map(context.entities.map((entity) => [entity.canonicalId, 0]));
  const represented = new Map(context.entities.map((entity) => [entity.canonicalId, new Set<string>()]));
  for (const relationship of relationships) {
    for (const entityId of [relationship.sourceCanonicalId, relationship.targetCanonicalId]) {
      degree.set(entityId, (degree.get(entityId) ?? 0) + 1);
      const segments = represented.get(entityId) ?? new Set<string>();
      for (const provenance of relationship.provenance) segments.add(provenance.segmentId);
      represented.set(entityId, segments);
    }
  }
  const candidates = context.entities.flatMap((entity): SimpleGraphV3CompletenessTarget[] => {
    const occurrences = context.sourceSegments.filter((segment) => idsBySegment.get(segment.segmentId)?.includes(entity.canonicalId));
    const usefulOccurrences = occurrences.filter((segment) => (idsBySegment.get(segment.segmentId)?.length ?? 0) >= 2);
    if (!usefulOccurrences.length) return [];
    const representedSegments = represented.get(entity.canonicalId) ?? new Set<string>();
    const uncovered = usefulOccurrences.filter((segment) => !representedSegments.has(segment.segmentId));
    const entityDegree = degree.get(entity.canonicalId) ?? 0;
    const signals: CompletenessSignal[] = [];
    if (entityDegree === 0) signals.push("zero_degree");
    if (entityDegree <= 1 && usefulOccurrences.length >= 2) signals.push("repeated_low_degree");
    if (uncovered.length >= 2 && uncovered.length / usefulOccurrences.length >= 0.5) signals.push("uncovered_occurrences");
    if (!signals.length || !uncovered.length) return [];
    return [{
      entity,
      degree: entityDegree,
      occurrenceSegmentIds: usefulOccurrences.map((segment) => segment.segmentId),
      uncoveredSegmentIds: uncovered.map((segment) => segment.segmentId),
      signals,
    }];
  }).sort((left, right) => targetPriority(right) - targetPriority(left) || left.entity.name.localeCompare(right.entity.name)).slice(0, maxTargets);

  const uncoveredTargets = new Set(candidates.map((target) => target.entity.canonicalId));
  const selected: SourceSegment[] = [];
  while (selected.length < maxSegments && uncoveredTargets.size) {
    const next = context.sourceSegments
      .filter((segment) => !selected.some((item) => item.segmentId === segment.segmentId))
      .map((segment) => {
        const covering = candidates.filter((target) => uncoveredTargets.has(target.entity.canonicalId) && target.uncoveredSegmentIds.includes(segment.segmentId));
        const score = covering.reduce((sum, target) => sum + targetPriority(target), 0) - segment.semanticText.length / 100;
        return { segment, covering, score };
      })
      .filter((item) => item.covering.length)
      .sort((left, right) => right.score - left.score || left.segment.segmentId.localeCompare(right.segment.segmentId))[0];
    if (!next) break;
    selected.push(next.segment);
    for (const target of next.covering) uncoveredTargets.delete(target.entity.canonicalId);
  }
  if (selected.length < maxSegments) {
    const supplemental = context.sourceSegments
      .filter((segment) => !selected.some((item) => item.segmentId === segment.segmentId))
      .map((segment) => ({
        segment,
        score: candidates.reduce((sum, target) => sum + (target.uncoveredSegmentIds.includes(segment.segmentId) ? targetPriority(target) : 0), 0) - segment.semanticText.length / 100,
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.segment.segmentId.localeCompare(right.segment.segmentId))
      .slice(0, maxSegments - selected.length);
    selected.push(...supplemental.map((item) => item.segment));
  }
  selected.sort((left, right) => left.page - right.page || left.segmentId.localeCompare(right.segmentId));
  const selectedIds = new Set(selected.map((segment) => segment.segmentId));
  const targets = candidates.filter((target) => target.uncoveredSegmentIds.some((id) => selectedIds.has(id)));
  if (!targets.length) return { requests: [], targets: [], selectedSegmentIds: [] };
  const targetIds = new Set(targets.map((target) => target.entity.canonicalId));
  const nearbyIds = new Set(selected.flatMap((segment) => idsBySegment.get(segment.segmentId) ?? []));
  for (const id of targetIds) nearbyIds.add(id);
  const entities = context.entities.filter((entity) => nearbyIds.has(entity.canonicalId));
  const entityIds = new Set(entities.map((entity) => entity.canonicalId));
  const existingRelationships = relationships.filter((relationship) =>
    (targetIds.has(relationship.sourceCanonicalId) || targetIds.has(relationship.targetCanonicalId))
    && entityIds.has(relationship.sourceCanonicalId)
    && entityIds.has(relationship.targetCanonicalId));
  const request: SimpleGraphV3CompletenessRequest = {
    requestId: "simple-v3-completeness-01",
    sourceSegments: selected,
    entities,
    targets,
    existingRelationships,
  };
  return { requests: [request], targets, selectedSegmentIds: selected.map((segment) => segment.segmentId) };
}

export function serializeSimpleGraphV3CompletenessRequest(request: SimpleGraphV3CompletenessRequest) {
  const targetIds = new Set(request.targets.map((target) => target.entity.canonicalId));
  const entityContext = request.entities.map((entity) => `${entity.name} | ${entity.type}${targetIds.has(entity.canonicalId) ? " | TARGET" : ""}`).join("\n");
  const existingRelationships = request.existingRelationships.map((relationship) => `${relationship.sourceName} | ${relationship.relationship} | ${relationship.targetName}`).join("\n");
  const source = request.sourceSegments.map((segment) => `[${segment.segmentId}] ${segment.semanticText}`).join("\n");
  const payload = `SOURCE\n${source}\n\nKNOWN ENTITIES\n${entityContext}\n\nRELATIONSHIPS ALREADY FOUND\n${existingRelationships || "(none)"}`;
  return { entityContext, existingRelationships, source, payload };
}

export function simpleGraphV3CompletenessTokenDiagnostics(request: SimpleGraphV3CompletenessRequest) {
  const serialized = serializeSimpleGraphV3CompletenessRequest(request);
  const schema = JSON.stringify(z.toJSONSchema(simpleGraphV3CompletenessOutputSchema));
  const characters = {
    source: serialized.source.length,
    entityContext: serialized.entityContext.length,
    existingRelationships: serialized.existingRelationships.length,
    instructions: SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT.length,
    schema: schema.length,
  };
  const tokens = Object.fromEntries(Object.entries(characters).map(([key, value]) => [key, Math.ceil(value / 4)])) as Record<keyof typeof characters, number>;
  return {
    characters,
    estimatedTokens: {
      ...tokens,
      totalInput: Object.values(tokens).reduce((sum, value) => sum + value, 0),
      maximumExpectedOutput: SIMPLE_GRAPH_V3_COMPLETENESS_EXPECTED_OUTPUT_TOKENS,
    },
  };
}

export function validateSimpleGraphV3Completeness(output: SimpleGraphV3Output, request: SimpleGraphV3CompletenessRequest) {
  const base = validateSimpleGraphV3(output, request);
  const targetIds = new Set(request.targets.map((target) => target.entity.canonicalId));
  const existingKeys = new Set(request.existingRelationships.map((relationship) => relationship.semanticKey));
  let nonTargetRejections = 0;
  let existingRelationshipRejections = 0;
  const relationships = base.relationships.filter((relationship) => {
    if (!targetIds.has(relationship.sourceCanonicalId) && !targetIds.has(relationship.targetCanonicalId)) {
      nonTargetRejections += 1;
      return false;
    }
    if (existingKeys.has(relationship.semanticKey)) {
      existingRelationshipRejections += 1;
      return false;
    }
    return true;
  });
  return { ...base, relationships, nonTargetRejections, existingRelationshipRejections };
}

export function runSimpleGraphV3Completeness(request: SimpleGraphV3CompletenessRequest, provider: StructuredModelProvider) {
  return provider.parseStructured({
    system: SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT,
    payload: serializeSimpleGraphV3CompletenessRequest(request).payload,
    schema: simpleGraphV3CompletenessOutputSchema,
    schemaName: "simple_graph_v3_completeness_output",
  });
}
