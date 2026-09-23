import type { ExtractionContext } from "@/lib/ai/extraction-context";
import {
  planSimpleGraphV3Requests,
  validateSimpleGraphV3,
  type SimpleGraphV3Output,
  type SimpleGraphV3Request,
  type ValidSimpleGraphV3Relationship,
} from "@/lib/ai/simple-graph-v3";

export const SIMPLE_GRAPH_V3_TWO_CHUNK_PAGES = [[10, 11, 12], [13, 14]] as const;

export function planTest9TwoChunkSimpleGraphV3(context: ExtractionContext): SimpleGraphV3Request[] {
  const expectedPages = new Set<number>(SIMPLE_GRAPH_V3_TWO_CHUNK_PAGES.flat());
  if (context.sourceSegments.some((segment) => !expectedPages.has(segment.page))) throw new Error("Unexpected page in Test 9 two-chunk context");
  return SIMPLE_GRAPH_V3_TWO_CHUNK_PAGES.map((pages, index) => {
    const sourceSegments = context.sourceSegments.filter((segment) => (pages as readonly number[]).includes(segment.page));
    if (!sourceSegments.length || pages.some((page) => !sourceSegments.some((segment) => segment.page === page))) {
      throw new Error(`Missing source page in Test 9 chunk ${index + 1}`);
    }
    const planned = planSimpleGraphV3Requests({ ...context, sourceSegments }, Number.POSITIVE_INFINITY);
    if (planned.length !== 1) throw new Error(`Expected one V3 primary request for Test 9 chunk ${index + 1}`);
    return { ...planned[0], requestId: `simple-v3-two-chunk-${index + 1}` };
  });
}

export function validateAndUnionTwoChunkSimpleGraphV3(
  outputs: Array<{ requestId: string; output: SimpleGraphV3Output }>,
  requests: SimpleGraphV3Request[],
) {
  const byRequest = new Map(requests.map((request) => [request.requestId, request]));
  const outputIds = new Set(outputs.map((item) => item.requestId));
  if (outputIds.size !== requests.length || outputs.length !== requests.length
    || requests.some((request) => !outputIds.has(request.requestId))) {
    throw new Error("Two-chunk union requires one output for each primary request");
  }
  const byKey = new Map<string, ValidSimpleGraphV3Relationship>();
  let proposed = 0;
  let duplicateRelationships = 0;
  let unknownEndpointRejections = 0;
  let ambiguousEndpointRejections = 0;
  let selfEdgeRejections = 0;
  let invalidSegmentRejections = 0;
  let invalidPageSegmentRejections = 0;
  for (const item of outputs) {
    const request = byRequest.get(item.requestId);
    if (!request) throw new Error(`Unknown two-chunk request ${item.requestId}`);
    const validation = validateSimpleGraphV3(item.output, request);
    proposed += validation.proposed;
    duplicateRelationships += validation.duplicateRelationships;
    unknownEndpointRejections += validation.unknownEndpointRejections;
    ambiguousEndpointRejections += validation.ambiguousEndpointRejections;
    selfEdgeRejections += validation.selfEdgeRejections;
    invalidSegmentRejections += validation.invalidSegmentRejections;
    invalidPageSegmentRejections += validation.invalidPageSegmentRejections;
    for (const edge of validation.relationships) {
      const prior = byKey.get(edge.semanticKey);
      if (!prior) { byKey.set(edge.semanticKey, edge); continue; }
      duplicateRelationships += 1;
      for (const provenance of edge.provenance) {
        if (!prior.provenance.some((item) => item.segmentId === provenance.segmentId)) prior.provenance.push(provenance);
      }
    }
  }
  return { relationships: [...byKey.values()], proposed, duplicateRelationships, unknownEndpointRejections, ambiguousEndpointRejections, selfEdgeRejections, invalidSegmentRejections, invalidPageSegmentRejections };
}
