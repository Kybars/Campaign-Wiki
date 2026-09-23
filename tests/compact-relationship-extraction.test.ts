import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext } from "../lib/ai/compact-extraction-context";
import { planCompactRelationshipRequests, serializeCompactRelationshipRequest, validateCompactRelationships } from "../lib/ai/compact-relationship-extraction";

const inventory: GraphInventory = { entities: [
  { temporary_id: "leska", name: "Leska", type: "npc", aliases: [], sources: [] },
  { temporary_id: "turinn", name: "Turinn", type: "location", aliases: [], sources: [] },
  { temporary_id: "sindaire", name: "Sindaire", type: "location", aliases: [], sources: [] },
] };

describe("compact extraction context", () => {
  it("maps reusable semantic segments back to exact raw source offsets", () => {
    const raw = "Header\n\nTurinn, the capi-\ntal city of Sindaire, resisted.\n\nLeska watched.";
    const context = buildExtractionContext([{ pageNumber: 13, text: raw, modelText: "Turinn, the capital city of Sindaire, resisted.\n\nLeska watched." }], inventory);
    expect(context.entities.map((entity) => entity.localId)).toEqual([0, 1, 2]);
    expect(context.evidenceSegments).toHaveLength(1);
    const mapping = context.evidenceSegments[0].rawSource;
    expect(raw.slice(mapping.start, mapping.end)).toBe(mapping.text);
    expect(mapping.text).toContain("capi-\ntal");
  });

  it("serializes the entity dictionary once and source once per request", () => {
    const context = buildExtractionContext([{ pageNumber: 13, text: "Turinn is the capital of Sindaire." }], inventory);
    const request = planCompactRelationshipRequests(context)[0];
    const serialized = serializeCompactRelationshipRequest(context, request);
    expect(serialized.payload.match(/1\|Turinn\|location/gu)).toHaveLength(1);
    expect(serialized.payload.match(/Turinn is the capital of Sindaire\./gu)).toHaveLength(1);
    expect(serialized.payload).not.toContain("unit_results");
  });

  it("fails closed for unknown IDs and unknown segments while retaining deterministic raw provenance", () => {
    const context = buildExtractionContext([{ pageNumber: 13, text: "Turinn is the capital of Sindaire." }], inventory);
    const request = planCompactRelationshipRequests(context)[0];
    const segmentId = request.segments[0].segmentId;
    const validation = validateCompactRelationships({ relationships: [
      { s: 1, r: "capital of", t: 2, e: segmentId },
      { s: 99, r: "rules", t: 2, e: segmentId },
      { s: 1, r: "capital of", t: 2, e: "missing" },
      { s: 0, r: "rules", t: 2, e: segmentId },
    ] }, context, request);
    expect(validation.relationships).toHaveLength(2);
    expect(validation.invalidEntityIdRejections).toBe(1);
    expect(validation.invalidSegmentIdRejections).toBe(1);
    expect(validation.endpointEvidenceRejections).toBe(0);
    expect(validation.relationships[0].rawSource.text).toContain("capital of");
  });

  it("creates the smallest ordered bounded request set", () => {
    const context = buildExtractionContext([
      { pageNumber: 1, text: "A".repeat(700) },
      { pageNumber: 2, text: "B".repeat(700) },
    ], inventory);
    const requests = planCompactRelationshipRequests(context, 800);
    expect(requests).toHaveLength(2);
    expect(requests.flatMap((request) => request.segments.map((segment) => segment.page))).toEqual([1, 2]);
  });
});
