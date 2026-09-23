import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/extraction-context";
import {
  planSimpleGraphV3BlanketRequest, serializeSimpleGraphV3BlanketRequest,
  simpleGraphV3BlanketCheckpointIdentity, simpleGraphV3BlanketOutputSchema,
  validateSimpleGraphV3Blanket, SIMPLE_GRAPH_V3_BLANKET_SYSTEM_PROMPT,
} from "../lib/ai/simple-graph-v3-blanket-completeness";
import { planSimpleGraphV3Requests, validateSimpleGraphV3 } from "../lib/ai/simple-graph-v3";

const inventory: GraphInventory = { entities: [
  { temporary_id: "a", name: "Ostalin", type: "faction", aliases: [], sources: [] },
  { temporary_id: "b", name: "Turinn", type: "location", aliases: [], sources: [] },
  { temporary_id: "c", name: "Sindaire", type: "location", aliases: [], sources: [] },
] };

function setup() {
  const context = buildExtractionContext([
    { pageNumber: 13, text: "Ostalin attacks Turinn." },
    { pageNumber: 14, text: "Turinn is the capital of Sindaire." },
  ], inventory);
  const primary = planSimpleGraphV3Requests(context)[0];
  const first = validateSimpleGraphV3({ relationships: [
    { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 13, evidence_segment: "13a" },
  ] }, primary).relationships;
  return { context, primary, first };
}

describe("Simple V3 blanket completeness", () => {
  it("serializes the complete primary source once, then names and existing edges once", () => {
    const { context, primary, first } = setup();
    const request = planSimpleGraphV3BlanketRequest(context, primary, [...first, ...first]);
    const serialized = serializeSimpleGraphV3BlanketRequest(request);
    expect(serialized.payload).toBe(`SOURCE\n[13a] Ostalin attacks Turinn.\n[14a] Turinn is the capital of Sindaire.\n\nKNOWN ENTITIES\nOstalin | faction\nTurinn | location\nSindaire | location\n\nRELATIONSHIPS ALREADY FOUND\nOstalin | attacks | Turinn`);
    expect(request.existingRelationships).toHaveLength(1);
    expect(serialized.payload).not.toMatch(/TARGET|candidate pairs|micro-units|evidence_quote|Facts| \| a\b/u);
    expect(SIMPLE_GRAPH_V3_BLANKET_SYSTEM_PROMPT).toContain("Inspect the entire supplied source");
    expect(simpleGraphV3BlanketOutputSchema.shape.relationships.element.shape.evidence_segment.description).toContain("Bare exact");
  });

  it("validates any missing edge with shared endpoint, segment, and raw provenance rules", () => {
    const { context, primary, first } = setup();
    const request = planSimpleGraphV3BlanketRequest(context, primary, first);
    const result = validateSimpleGraphV3Blanket({ relationships: [
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 13, evidence_segment: "13a" },
      { source: "Turinn", relationship: "capital of", target: "Sindaire", page: 14, evidence_segment: "[14a] copied text" },
      { source: "Turinn", relationship: "capital of", target: "Sindaire", page: 14, evidence_segment: "14a" },
      { source: "Ostalin", relationship: "rules", target: "Sindaire", page: 13, evidence_segment: "14a" },
    ] }, request);
    expect(result.relationships).toHaveLength(1);
    expect(result.existingRelationshipRejections).toBe(1);
    expect(result.duplicateRelationships).toBe(1);
    expect(result.invalidPageSegmentRejections).toBe(1);
    expect(result.relationships[0].provenance[0].text).toContain("capital of Sindaire");
  });

  it("refuses source truncation and binds checkpoints to accepted edges", () => {
    const { context, primary, first } = setup();
    expect(() => planSimpleGraphV3BlanketRequest(context, { ...primary, sourceSegments: primary.sourceSegments.slice(0, 1) }, first)).toThrow("full V3 primary");
    const request = planSimpleGraphV3BlanketRequest(context, primary, first);
    const args = { campaignId: "c", documentId: "d", sourceExtractionCacheId: null, providerId: "openai", modelId: "gpt-5.6-luna", request, contextFingerprint: extractionContextFingerprint(context) };
    const identity = simpleGraphV3BlanketCheckpointIdentity(args);
    expect(identity.operationType).toBe("simple_graph_v3_blanket");
    expect(simpleGraphV3BlanketCheckpointIdentity({ ...args, modelId: "other" })).not.toEqual(identity);
    expect(simpleGraphV3BlanketCheckpointIdentity({ ...args, request: { ...request, existingRelationships: [] } })).not.toEqual(identity);
  });
});
