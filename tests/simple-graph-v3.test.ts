import { describe, expect, it } from "vitest";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/extraction-context";
import { planSimpleGraphV3Completeness, serializeSimpleGraphV3CompletenessRequest, SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT, simpleGraphV3CompletenessOutputSchema, simpleGraphV3CompletenessTokenDiagnostics, validateSimpleGraphV3Completeness } from "../lib/ai/simple-graph-v3-completeness";
import { auditSimpleGraphV3Coverage, normalizeSimpleGraphV3EvidenceSegmentId, planSimpleGraphV3Requests, serializeSimpleGraphV3Request, simpleGraphV3CheckpointIdentity, simpleGraphV3TokenDiagnostics, validateSimpleGraphV3 } from "../lib/ai/simple-graph-v3";

const inventory: GraphInventory = { entities: [
  { temporary_id: "turinn-id", name: "Turinn", type: "location", aliases: ["the capital city"], sources: [] },
  { temporary_id: "sindaire-id", name: "Sindaire", type: "location", aliases: [], sources: [] },
  { temporary_id: "ostalin-id", name: "Ostalin", type: "faction", aliases: [], sources: [] },
  { temporary_id: "leska-id", name: "Supreme Inquisitor Leska", type: "npc", aliases: ["Leska"], sources: [] },
  { temporary_id: "unused-id", name: "Unused Kingdom", type: "location", aliases: [], sources: [] },
] };

function fixture() {
  const pages = [
    { pageNumber: 13, text: "Turinn, the capital city of Sindaire, is under blockade. Leska watches." },
    { pageNumber: 14, text: "Ostalin attacks Turinn. Turinn remains the capital city of Sindaire." },
  ];
  const context = buildExtractionContext(pages, inventory);
  const request = planSimpleGraphV3Requests(context)[0];
  return { context, request };
}

describe("Simple Graph Pipeline V3", () => {
  it("builds a Facts-compatible generic context with stable source provenance", () => {
    const { context } = fixture();
    expect(Object.keys(context).sort()).toEqual(["entities", "sourceSegments"]);
    expect(context.sourceSegments.map((segment) => segment.segmentId)).toEqual(["13a", "14a"]);
    for (const segment of context.sourceSegments) {
      expect(segment.rawSource.text.slice(0, 20)).toBeTruthy();
      expect(segment.rawSource.page).toBe(segment.page);
      expect(segment).not.toHaveProperty("relationships");
      expect(segment).not.toHaveProperty("facts");
    }
  });

  it("filters each broad chunk to locally occurring canonical names and aliases", () => {
    const { request } = fixture();
    expect(request.entities.map((entity) => entity.name)).toEqual(["Turinn", "Sindaire", "Ostalin", "Supreme Inquisitor Leska"]);
    expect(request.entities.some((entity) => entity.name === "Unused Kingdom")).toBe(false);
  });

  it("serializes natural names and types once without model-facing IDs", () => {
    const { request } = fixture();
    const serialized = serializeSimpleGraphV3Request(request);
    expect(serialized.payload.match(/Turinn \| location/gu)).toHaveLength(1);
    expect(serialized.payload.match(/\[13a\]/gu)).toHaveLength(1);
    expect(serialized.payload).not.toContain("turinn-id");
    expect(serialized.payload).not.toContain("unit_results");
  });

  it("resolves natural canonical names and aliases to canonical IDs", () => {
    const { request } = fixture();
    const result = validateSimpleGraphV3({ relationships: [
      { source: "the capital city", relationship: "capital of", target: "Sindaire", page: 13, evidence_segment: "13a" },
    ] }, request);
    expect(result.relationships[0]).toMatchObject({ sourceCanonicalId: "turinn-id", targetCanonicalId: "sindaire-id", sourceName: "Turinn" });
    expect(result.relationships[0].provenance[0].text).toContain("capital city of Sindaire");
  });

  it("rejects ambiguous aliases rather than guessing", () => {
    const { context } = fixture();
    const request = { ...planSimpleGraphV3Requests(context)[0], entities: [
      ...context.entities,
      { canonicalId: "other-leska", name: "Leska the Younger", type: "npc", aliases: ["Leska"] },
    ] };
    const result = validateSimpleGraphV3({ relationships: [
      { source: "Leska", relationship: "watches", target: "Turinn", page: 13, evidence_segment: "13a" },
    ] }, request);
    expect(result.relationships).toHaveLength(0);
    expect(result.ambiguousEndpointRejections).toBe(1);
  });

  it("accepts a unique leading-article endpoint and stores its canonical identity", () => {
    const { request } = fixture();
    const withTitle = { ...request, entities: [
      ...request.entities,
      { canonicalId: "scouring-id", name: "The Scouring of Gate Pass", type: "event", aliases: [] },
    ] };
    const result = validateSimpleGraphV3({ relationships: [
      { source: "Scouring of Gate Pass", relationship: "affects", target: "Turinn", page: 13, evidence_segment: "13a" },
    ] }, withTitle);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toMatchObject({ sourceCanonicalId: "scouring-id", sourceName: "The Scouring of Gate Pass" });
  });

  it("also accepts a unique extra leading article", () => {
    const { request } = fixture();
    const withUntitled = { ...request, entities: [
      ...request.entities,
      { canonicalId: "scouring-id", name: "Scouring of Gate Pass", type: "event", aliases: [] },
    ] };
    const result = validateSimpleGraphV3({ relationships: [
      { source: "The Scouring of Gate Pass", relationship: "affects", target: "Turinn", page: 13, evidence_segment: "13a" },
    ] }, withUntitled);
    expect(result.relationships[0]).toMatchObject({ sourceCanonicalId: "scouring-id", sourceName: "Scouring of Gate Pass" });
  });

  it("rejects an ambiguous leading-article endpoint", () => {
    const { request } = fixture();
    const withDuplicates = { ...request, entities: [
      ...request.entities,
      { canonicalId: "first", name: "The Scouring of Gate Pass", type: "event", aliases: [] },
      { canonicalId: "second", name: "the scouring of gate pass", type: "event", aliases: [] },
    ] };
    const result = validateSimpleGraphV3({ relationships: [
      { source: "Scouring of Gate Pass", relationship: "affects", target: "Turinn", page: 13, evidence_segment: "13a" },
    ] }, withDuplicates);
    expect(result.relationships).toHaveLength(0);
    expect(result.ambiguousEndpointRejections).toBe(1);
  });

  it("rejects unrelated endpoints without fuzzy matching", () => {
    const { request } = fixture();
    const result = validateSimpleGraphV3({ relationships: [
      { source: "Scouring at Gate Pass", relationship: "affects", target: "Turinn", page: 13, evidence_segment: "13a" },
    ] }, request);
    expect(result.relationships).toHaveLength(0);
    expect(result.unknownEndpointRejections).toBe(1);
  });

  it("prefers an exact canonical name over a different entity's article variant", () => {
    const { request } = fixture();
    const withBoth = { ...request, entities: [
      ...request.entities,
      { canonicalId: "exact", name: "Scouring of Gate Pass", type: "event", aliases: [] },
      { canonicalId: "article", name: "The Scouring of Gate Pass", type: "event", aliases: [] },
    ] };
    const result = validateSimpleGraphV3({ relationships: [
      { source: "Scouring of Gate Pass", relationship: "affects", target: "Turinn", page: 13, evidence_segment: "13a" },
    ] }, withBoth);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toMatchObject({ sourceCanonicalId: "exact", sourceName: "Scouring of Gate Pass" });
  });

  it("rejects invalid and page-mismatched segments", () => {
    const { request } = fixture();
    const result = validateSimpleGraphV3({ relationships: [
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 14, evidence_segment: "missing" },
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 13, evidence_segment: "14a" },
    ] }, request);
    expect(result.relationships).toHaveLength(0);
    expect(result.invalidSegmentRejections).toBe(1);
    expect(result.invalidPageSegmentRejections).toBe(1);
  });

  it("normalizes only exact IDs or exact IDs copied from a leading bracket", () => {
    const supplied = new Set(["11e", "13b"]);
    expect(normalizeSimpleGraphV3EvidenceSegmentId("11e", supplied)).toBe("11e");
    expect(normalizeSimpleGraphV3EvidenceSegmentId("[11e] copied source text", supplied)).toBe("11e");
    expect(normalizeSimpleGraphV3EvidenceSegmentId("11e copied source text", supplied)).toBeNull();
    expect(normalizeSimpleGraphV3EvidenceSegmentId("[11f] copied source text", supplied)).toBeNull();
    expect(normalizeSimpleGraphV3EvidenceSegmentId("prefix [11e]", supplied)).toBeNull();
  });

  it("semantically dedupes normalized edges while unioning raw provenance", () => {
    const { request } = fixture();
    const result = validateSimpleGraphV3({ relationships: [
      { source: "Turinn", relationship: "capital of", target: "Sindaire", page: 13, evidence_segment: "13a" },
      { source: "Turinn", relationship: "Capital   Of", target: "Sindaire", page: 14, evidence_segment: "14a" },
    ] }, request);
    expect(result.relationships).toHaveLength(1);
    expect(result.duplicateRelationships).toBe(1);
    expect(result.relationships[0].provenance.map((item) => item.segmentId)).toEqual(["13a", "14a"]);
  });

  it("reports deterministic zero-degree coverage without another model contract", () => {
    const { request } = fixture();
    const validation = validateSimpleGraphV3({ relationships: [
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 14, evidence_segment: "14a" },
    ] }, request);
    const audit = auditSimpleGraphV3Coverage([request], validation.relationships);
    expect(audit).toMatchObject({ suppliedEntities: 4, touchedEntities: 2, relationships: 1, sourceSegments: 2, pages: [13, 14] });
    expect(audit.zeroDegreeEntityNames).toEqual(["Sindaire", "Supreme Inquisitor Leska"]);
  });

  it("creates a stable, behavior-versioned checkpoint identity", () => {
    const { context, request } = fixture();
    const base = { campaignId: "campaign", documentId: "document", sourceExtractionCacheId: "cache", providerId: "openai", modelId: "gpt-5.6-luna", request, contextFingerprint: extractionContextFingerprint(context) };
    const identity = simpleGraphV3CheckpointIdentity(base);
    expect(identity).toMatchObject({ processingMode: "simple_graph_v3", operationType: "simple_graph_v3", behaviorVersion: "v0.7.0-simple-graph-v3-2", schemaVersion: 1 });
    expect(simpleGraphV3CheckpointIdentity(base)).toEqual(identity);
    expect(simpleGraphV3CheckpointIdentity({ ...base, modelId: "different-model" })).not.toEqual(identity);
  });

  it("reports compact component-level serialization diagnostics", () => {
    const { request } = fixture();
    const diagnostics = simpleGraphV3TokenDiagnostics(request);
    expect(diagnostics.estimatedTokens.source).toBeGreaterThan(0);
    expect(diagnostics.estimatedTokens.entityContext).toBeGreaterThan(0);
    expect(diagnostics.estimatedTokens.totalInput).toBe(Object.entries(diagnostics.estimatedTokens).filter(([key]) => key !== "totalInput").reduce((sum, [, value]) => sum + value, 0));
  });

  it("plans one bounded completeness request from generic coverage signals", () => {
    const { context, request } = fixture();
    const firstPass = validateSimpleGraphV3({ relationships: [
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 14, evidence_segment: "14a" },
    ] }, request).relationships;
    const plan = planSimpleGraphV3Completeness(context, firstPass, { maxTargets: 4, maxSegments: 2 });
    expect(plan.requests).toHaveLength(1);
    expect(plan.targets.map((target) => target.entity.name)).toContain("Sindaire");
    expect(plan.selectedSegmentIds.length).toBeLessThanOrEqual(2);
    expect(plan.requests[0].entities.map((entity) => entity.name)).not.toContain("Unused Kingdom");
  });

  it("serializes source first and target markers inline with one known-entity list", () => {
    const { context } = fixture();
    const plan = planSimpleGraphV3Completeness(context, []);
    const serialized = serializeSimpleGraphV3CompletenessRequest(plan.requests[0]);
    expect(serialized.payload.startsWith("SOURCE\n[13a]")).toBe(true);
    expect(serialized.payload).not.toContain("TARGET ENTITIES");
    expect(serialized.payload.match(/KNOWN ENTITIES/gu)).toHaveLength(1);
    expect(serialized.payload.match(/Turinn \| location \| TARGET/gu)).toHaveLength(1);
    expect(serialized.payload.match(/RELATIONSHIPS ALREADY FOUND/gu)).toHaveLength(1);
    expect(serialized.payload.match(/\[13a\]/gu)).toHaveLength(1);
    expect(serialized.payload).not.toContain("turinn-id");
    expect(serialized.payload).not.toContain("candidate");
    expect(SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT).toContain("Inspect every supplied source segment");
    expect(SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT).toContain("Do not stop after finding one");
    expect(simpleGraphV3CompletenessOutputSchema.shape.relationships.element.shape.evidence_segment.description).toContain("Bare exact ID");
    const diagnostics = simpleGraphV3CompletenessTokenDiagnostics(plan.requests[0]);
    expect(diagnostics.estimatedTokens.totalInput).toBeGreaterThan(0);
    expect(diagnostics.estimatedTokens.maximumExpectedOutput).toBe(3_000);
  });

  it("validates completeness with the shared provenance resolver and fails closed outside targets", () => {
    const { context, request } = fixture();
    const firstPass = validateSimpleGraphV3({ relationships: [
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 14, evidence_segment: "14a" },
    ] }, request).relationships;
    const planned = planSimpleGraphV3Completeness(context, firstPass).requests[0];
    const completeness = { ...planned, targets: planned.targets.filter((target) => target.entity.name === "Turinn") };
    const result = validateSimpleGraphV3Completeness({ relationships: [
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 14, evidence_segment: "14a" },
      { source: "Turinn", relationship: "capital of", target: "Sindaire", page: 13, evidence_segment: "13a" },
      { source: "Ostalin", relationship: "watches", target: "Supreme Inquisitor Leska", page: 14, evidence_segment: "14a" },
    ] }, completeness);
    expect(result.existingRelationshipRejections).toBe(1);
    expect(result.nonTargetRejections).toBe(1);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].provenance[0].text).toContain("capital city of Sindaire");
  });
});
