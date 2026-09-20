import { describe, expect, it, vi } from "vitest";
import {
  buildGraphExtractionInput,
  GRAPH_EXTRACTION_SYSTEM_PROMPT,
  graphExtractionOutputSchema,
  runGraphExtraction,
  serializeGraphInventory,
  validateGraphExtraction,
} from "@/lib/ai/graph-extraction";
import { assertGoldReferenceIsolation } from "../scripts/wotbs-stage1";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import type { ValidatedExtractionInventoryOutput } from "@/lib/ai/schemas";

const chunk = { id: "graph-proof", characterCount: 93, pages: [{ pageNumber: 1, text: "Duke Mira commands the Dawn Compact. The Dawn Compact is located in Ashfall." }] };
const inventory: ValidatedExtractionInventoryOutput = { entities: [
  { temporary_id: "inv_mira", name: "Duke Mira", type: "npc", sources: [{ page_number: 1, supporting_text: "Duke Mira commands the Dawn Compact." }] },
  { temporary_id: "inv_compact", name: "Dawn Compact", type: "faction", sources: [{ page_number: 1, supporting_text: "Duke Mira commands the Dawn Compact." }] },
  { temporary_id: "inv_ashfall", name: "Ashfall", type: "location", sources: [{ page_number: 1, supporting_text: "The Dawn Compact is located in Ashfall." }] },
] };

describe("v0-style graph extraction proof", () => {
  it("uses a strict relationship-only schema and a narrow semantic prompt", () => {
    expect(graphExtractionOutputSchema.safeParse({ relationships: [{ source: "Duke Mira", relationship: "commands", target: "Dawn Compact", page: 1, evidence_quote: "Duke Mira commands the Dawn Compact." }] }).success).toBe(true);
    expect(graphExtractionOutputSchema.safeParse({ relationships: [{ source: "Duke Mira", relationship: "commands", target: "Dawn Compact", page: 1 }] }).success).toBe(false);
    expect(graphExtractionOutputSchema.safeParse({ relationships: [], facts: [] }).success).toBe(false);
    expect(GRAPH_EXTRACTION_SYSTEM_PROMPT).toContain("explicit semantic support");
    expect(GRAPH_EXTRACTION_SYSTEM_PROMPT).toContain("Only use endpoint names from KNOWN ENTITIES");
    expect(GRAPH_EXTRACTION_SYSTEM_PROMPT).not.toContain("atomic fact");
    expect(GRAPH_EXTRACTION_SYSTEM_PROMPT).not.toContain("enrichment");
  });

  it("serializes only human-readable canonical names and types", () => {
    const serialized = serializeGraphInventory(inventory);
    expect(serialized).toContain("Duke Mira | npc");
    expect(serialized).not.toContain("inv_mira");
    const input = buildGraphExtractionInput(chunk, inventory);
    expect(input).toContain("SOURCE PAGES");
    expect(input).toContain("KNOWN ENTITIES");
    expect(input).toContain("Dawn Compact | faction");
  });

  it("maps unique names, rejects unknown/ambiguous/self endpoints, and cannot create entities", () => {
    const ambiguous: ValidatedExtractionInventoryOutput = { entities: [...inventory.entities, { temporary_id: "inv_other_mira", name: "Duke Mira", type: "other", sources: [{ page_number: 1, supporting_text: "Duke Mira commands the Dawn Compact." }] }] };
    const raw = { relationships: [
      { source: "Duke Mira", relationship: "commands", target: "Dawn Compact", page: 1, evidence_quote: "Duke Mira commands the Dawn Compact." },
      { source: "Nobody", relationship: "commands", target: "Dawn Compact", page: 1, evidence_quote: "Duke Mira commands the Dawn Compact." },
      { source: "Dawn Compact", relationship: "located in", target: "Dawn Compact", page: 1, evidence_quote: "The Dawn Compact is located in Ashfall." },
      { source: "Duke Mira", relationship: "commands", target: "Dawn Compact", page: 2, evidence_quote: "Duke Mira commands the Dawn Compact." },
    ] };
    const valid = validateGraphExtraction(raw, inventory, chunk);
    expect(valid.relationships).toHaveLength(1);
    expect(valid.relationships[0]).toMatchObject({ sourceInventoryId: "inv_mira", targetInventoryId: "inv_compact", page: 1 });
    expect(valid.unknownEndpointRejections).toBe(1);
    expect(valid.selfEdgeRejections).toBe(1);
    expect(valid.diagnostics.some((item) => item.reason.includes("page 2"))).toBe(true);
    expect(validateGraphExtraction({ relationships: [{ source: "Duke Mira", relationship: "commands", target: "Dawn Compact", page: 1, evidence_quote: "Duke Mira commands the Dawn Compact." }] }, ambiguous, chunk).ambiguousEndpointRejections).toBe(1);
    expect(inventory.entities).toHaveLength(3);
  });

  it("keeps arbitrary labels and directions as separate evidence-backed instances before reconciliation", () => {
    const raw = { relationships: [
      { source: "Dawn Compact", relationship: "located in", target: "Ashfall", page: 1, evidence_quote: "The Dawn Compact is located in Ashfall." },
      { source: "Ashfall", relationship: "contains", target: "Dawn Compact", page: 1, evidence_quote: "The Dawn Compact is located in Ashfall." },
      { source: "Duke Mira", relationship: "seeks", target: "Ashfall", page: 1, evidence_quote: "Duke Mira commands the Dawn Compact." },
    ] };
    const valid = validateGraphExtraction(raw, inventory, chunk);
    expect(valid.relationships).toHaveLength(3);
    expect(valid.duplicateSemanticEdges).toBe(0);
    expect(valid.relationships[0]).toMatchObject({ relationshipType: "located in", inverseLabel: "located in", sourceInventoryId: "inv_compact", targetInventoryId: "inv_ashfall" });
    expect(valid.relationships[2]).toMatchObject({ relationshipType: "seeks", knownInverse: false });
  });

  it("requires a verbatim raw-page quote and preserves the exact raw match", () => {
    const wrappedChunk = { id: "quote", characterCount: 60, pages: [{ pageNumber: 1, text: "Duke Mira commands\n  the Dawn Compact." }] };
    const accepted = validateGraphExtraction({ relationships: [{ source: "Duke Mira", relationship: "commands", target: "Dawn Compact", page: 1, evidence_quote: "Duke Mira commands the Dawn Compact." }] }, inventory, wrappedChunk);
    expect(accepted.relationships[0].matchedEvidenceText).toBe("Duke Mira commands\n  the Dawn Compact.");
    const rejected = validateGraphExtraction({ relationships: [{ source: "Duke Mira", relationship: "commands", target: "Dawn Compact", page: 1, evidence_quote: "Mira leads the Compact." }] }, inventory, wrappedChunk);
    expect(rejected.relationships).toEqual([]);
    expect(rejected.validationRecords[0].outcome).toBe("REJECTED_EVIDENCE_NOT_FOUND");
  });

  it("uses the shared provider abstraction without dispatching during construction", async () => {
    const parseStructured = vi.fn(async () => ({ output: { relationships: [] }, providerId: "local" as const, modelId: "test", responseId: null, usage: { model: "test", responseId: null, inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null } }));
    const provider: StructuredModelProvider = { providerId: "local", modelId: "test", parseStructured: parseStructured as StructuredModelProvider["parseStructured"] };
    await runGraphExtraction(chunk, inventory, provider);
    expect(parseStructured).toHaveBeenCalledWith(expect.objectContaining({ system: GRAPH_EXTRACTION_SYSTEM_PROMPT, schemaName: "graph_extraction_output" }));
  });

  it("keeps evaluator-only gold content out of graph model inputs", () => {
    const input = buildGraphExtractionInput(chunk, inventory);
    const artifacts = [{ path: "private-gold.json", raw: "graph evaluator secret marker" }];
    expect(() => assertGoldReferenceIsolation([GRAPH_EXTRACTION_SYSTEM_PROMPT, input], artifacts)).not.toThrow();
    expect(() => assertGoldReferenceIsolation(["graph evaluator secret marker"], artifacts)).toThrow(/Gold reference leaked/);
  });
});
