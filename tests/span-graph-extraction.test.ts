import { describe, expect, it } from "vitest";
import type { GraphInventory } from "@/lib/ai/entity-reconciliation";
import { graphExtractionCheckpointIdentity } from "@/lib/processing/graph-core";
import { memoryCheckpointStore } from "@/lib/ai/operation-checkpoint";
import { boundedEntityContextInSemanticText } from "@/lib/graph/occurrence-index";
import {
  SPAN_GRAPH_EXTRACTION_BEHAVIOR_VERSION,
  SPAN_GRAPH_EXTRACTION_CONTRACT_VERSION,
  SPAN_GRAPH_LIMITS,
  buildSemanticEvidenceUnits,
  buildSpanGraphExtractionInput,
  packSemanticEvidenceUnits,
  spanGraphExtractionOutputSchemaForRequest,
  validateSpanGraphExtraction,
  validateSpanUnitAccounting,
} from "@/lib/ai/span-graph-extraction";

const inventory: GraphInventory = { entities: [
  ["turinn", "Turinn", "location"], ["sindaire", "Sindaire", "location"], ["ostalin", "Ostalin", "location"], ["navy", "Ragesian Navy", "faction"],
].map(([temporary_id, name, type]) => ({ temporary_id, name, type: type as never, aliases: [], memberIds: [temporary_id], sources: [] })) };

const page = {
  pageNumber: 14,
  text: "Timeline\n\nTurinn, capital of Sindaire, is under naval blockade by the Ragesian Navy and under attack by\nOstalin.\n\nThe armies regroup after the battle.",
  modelText: "Timeline\n\nTurinn, capital of Sindaire, is under naval blockade by the Ragesian Navy and under attack by Ostalin.\n\nThe armies regroup after the battle.",
};

describe("span-driven primary relationship extraction", () => {
  it("preserves paragraph order, produces stable IDs, and maps semantic text to exact raw slices", () => {
    const first = buildSemanticEvidenceUnits([page], inventory);
    const second = buildSemanticEvidenceUnits([page], inventory);
    expect(first.map((unit) => unit.unitId)).toEqual(second.map((unit) => unit.unitId));
    expect(first).toHaveLength(1);
    expect(first[0]!.semanticCharacters).toBeLessThanOrEqual(SPAN_GRAPH_LIMITS.maximumUnitCharacters);
    const relationshipSpan = first[0]!.evidenceSpans.find((span) => span.entityIds.includes("turinn") && span.entityIds.includes("ostalin"))!;
    expect(relationshipSpan.rawSourceSlice).toContain("under attack by\nOstalin");
    expect(page.text).toContain(relationshipSpan.rawSourceSlice);
  });

  it("uses local occurrences and refines high-density units without truncating entity IDs", () => {
    const names = Array.from({ length: 20 }, (_, index) => `Entity${String(index).padStart(2, "0")}`);
    const denseInventory: GraphInventory = { entities: names.map((name) => ({ temporary_id: name, name, type: "npc", aliases: [], memberIds: [name], sources: [] })) };
    const densePage = { pageNumber: 1, text: names.map((name, index) => `${name} meets Entity${String((index + 1) % names.length).padStart(2, "0")}.`).join(" ") };
    const units = buildSemanticEvidenceUnits([densePage], denseInventory);
    expect(units.length).toBeGreaterThan(1);
    expect(Math.max(...units.map((unit) => unit.entityIds.length))).toBeLessThanOrEqual(SPAN_GRAPH_LIMITS.maximumEntitiesPerUnit);
    const represented = new Set(units.flatMap((unit) => unit.entityIds));
    expect([...represented].sort()).toEqual(names.sort());
  });

  it("adds only bounded, unambiguous local identity context", () => {
    const contextual = [
      { temporary_id: "king", name: "King Steppengard", type: "npc" },
      { temporary_id: "first", name: "Emperor's First Army", type: "faction" },
      { temporary_id: "second", name: "Second Army of the Ragesian Empire", type: "faction" },
      { temporary_id: "ragesians", name: "Ragesians", type: "faction" },
      { temporary_id: "death", name: "Assassination of Drakus Coaltongue", type: "event" },
      { temporary_id: "magdus", name: "General Magdus", type: "npc" },
    ];
    const result = boundedEntityContextInSemanticText(contextual, "The second Ragesian army under General Magdus obeyed the king after Coaltongue was slain.");
    expect(result.occurringEntityIds).toEqual(["magdus"]);
    expect(result.contextEntityIds).toEqual(["death", "king", "ragesians", "second"]);
    expect(result.contextEntityIds).not.toContain("first");
    const ambiguous = boundedEntityContextInSemanticText([...contextual, { temporary_id: "other-king", name: "King Aster", type: "npc" }], "The king issued an order.");
    expect(ambiguous.contextEntityIds).not.toContain("king");
    expect(ambiguous.contextEntityIds).not.toContain("other-king");
  });

  it("packs multiple independently accounted units into bounded requests", () => {
    const repeatedPages = Array.from({ length: 8 }, (_, index) => ({ ...page, pageNumber: index + 1, text: page.text.replace("Timeline", `Timeline ${index + 1}`), modelText: page.modelText.replace("Timeline", `Timeline ${index + 1}`) }));
    const units = buildSemanticEvidenceUnits(repeatedPages, inventory);
    const requests = packSemanticEvidenceUnits(units, repeatedPages);
    expect(requests.length).toBeLessThan(units.length);
    expect(requests.every((request) => request.characterCount <= SPAN_GRAPH_LIMITS.maximumRequestCharacters)).toBe(true);
    expect(requests.every((request) => request.units.length <= SPAN_GRAPH_LIMITS.maximumUnitsPerRequest)).toBe(true);
    for (const request of requests) {
      const spanIds = request.units.flatMap((unit) => unit.evidenceSpans.map((span) => span.evidenceSpanId));
      expect(new Set(spanIds).size).toBe(spanIds.length);
    }
    expect(buildSpanGraphExtractionInput(requests[0]!, inventory).units[0]).not.toHaveProperty("rawSourceSlice");
  });

  it("requires exact unit, endpoint, and evidence-span IDs and needs no copied quote", () => {
    const request = packSemanticEvidenceUnits(buildSemanticEvidenceUnits([page], inventory), [page])[0]!;
    const unit = request.units[0]!;
    const span = unit.evidenceSpans.find((item) => item.entityIds.includes("turinn") && item.entityIds.includes("sindaire"))!;
    const raw = { unit_results: [{ unit_id: unit.unitId, relationships: [{ source_id: "turinn", relationship: "capital of", target_id: "sindaire", evidence_span_id: span.evidenceSpanId }] }] };
    const validation = validateSpanGraphExtraction(raw, request, inventory);
    expect(validation.relationships[0]).toMatchObject({ sourceInventoryId: "turinn", targetInventoryId: "sindaire", evidenceQuote: span.rawSourceSlice, matchedEvidenceText: span.rawSourceSlice });
    expect(raw.unit_results[0]!.relationships[0]).not.toHaveProperty("evidence_quote");
    expect(() => validateSpanUnitAccounting({ unit_results: [] }, request)).toThrow(/omitted/);
    expect(() => validateSpanUnitAccounting({ unit_results: [{ unit_id: "invented", relationships: [] }] }, request)).toThrow(/invented/);
    expect(() => validateSpanUnitAccounting({ unit_results: [{ unit_id: unit.unitId, relationships: [] }, { unit_id: unit.unitId, relationships: [] }] }, request)).toThrow(/duplicated/);
    expect(() => validateSpanGraphExtraction({ unit_results: [{ unit_id: unit.unitId, relationships: [{ source_id: "invented", relationship: "rules", target_id: "sindaire", evidence_span_id: span.evidenceSpanId }] }] }, request, inventory)).toThrow(/outside unit/);
    expect(() => validateSpanGraphExtraction({ unit_results: [{ unit_id: unit.unitId, relationships: [{ source_id: "turinn", relationship: "rules", target_id: "sindaire", evidence_span_id: "invented" }] }] }, request, inventory)).toThrow(/invented evidence span/);
    expect(() => spanGraphExtractionOutputSchemaForRequest(request).parse({ unit_results: [{ unit_id: unit.unitId, relationships: [{ source_id: "invented", relationship: "rules", target_id: "sindaire", evidence_span_id: span.evidenceSpanId }] }] })).toThrow();
    const unrelated = { ...span, evidenceSpanId: "unrelated", semanticText: "The armies regroup.", rawSourceSlice: "The armies regroup", entityIds: [], occurringEntityIds: [], contextEntityIds: [] };
    const requestWithUnrelated = { ...request, units: [{ ...unit, evidenceSpans: [...unit.evidenceSpans, unrelated] }] };
    const rejected = validateSpanGraphExtraction({ unit_results: [{ unit_id: unit.unitId, relationships: [{ source_id: "turinn", relationship: "rules", target_id: "sindaire", evidence_span_id: "unrelated" }] }] }, requestWithUnrelated, inventory);
    expect(rejected).toMatchObject({ relationships: [], evidenceQuoteRejections: 1 });
    expect(rejected.validationRecords[0]?.outcome).toBe("REJECTED_EVIDENCE_NOT_FOUND");
  });

  it("advances only the span-primary checkpoint contract", () => {
    const request = packSemanticEvidenceUnits(buildSemanticEvidenceUnits([page], inventory), [page])[0]!;
    const identity = graphExtractionCheckpointIdentity(request, inventory, { providerId: "openai", modelId: "gpt-5.6-luna", parseStructured: async () => { throw new Error("not called"); } } as never, { campaignId: "campaign", documentId: "document", processingMode: "lean", store: memoryCheckpointStore(), finalInventoryFingerprint: "inventory", finalInventoryUpstreamFingerprint: "upstream" });
    expect(identity).toMatchObject({ behaviorVersion: SPAN_GRAPH_EXTRACTION_BEHAVIOR_VERSION, schemaVersion: SPAN_GRAPH_EXTRACTION_CONTRACT_VERSION });
  });
});
