import { describe, expect, it } from "vitest";
import { buildDuplicateCandidates, type DuplicateAdjudication, type GraphInventory } from "@/lib/ai/entity-reconciliation";
import { buildLeanObservabilityAudit } from "@/lib/processing/lean-observability";
import { buildLeanGraphCore } from "@/lib/processing/graph-core";
import { resolveRawRelationships } from "@/lib/ai/graph-extraction";
import { normalizeRelationshipFact, relationshipSemanticKey } from "@/lib/relationships/normalize";
import { buildRelationshipInstances, type RelationshipReconciliationResult } from "@/lib/ai/relationship-reconciliation";

const source = (page: number, text: string) => ({ page_number: page, supporting_text: text.padEnd(12, ".") });
const chunk = { id: "chunk-1", characterCount: 100, pages: [{ pageNumber: 1, text: "Mira owns the Sword. Mira owns the Sword again." }] };

describe("lean processing observability", () => {
  it("persists inventory origins, every candidate decision, rejected raw relationships, normalization, and deterministic coverage without changing graph semantics", () => {
    const inventory: GraphInventory = { entities: [
      { temporary_id: "mira", name: "Mira", type: "npc", memberIds: ["mira"], sources: [source(1, "Mira appears.")] },
      { temporary_id: "lady-mira", name: "The Mira", type: "npc", memberIds: ["lady-mira"], sources: [source(1, "The Mira appears.")] },
      { temporary_id: "sword", name: "Sword", type: "item", memberIds: ["sword"], sources: [source(1, "Sword appears.")] },
      { temporary_id: "vault", name: "Vault", type: "location", memberIds: ["vault"], sources: [source(1, "Vault appears.")] },
    ] };
    const candidates = buildDuplicateCandidates(inventory, []);
    const decision: DuplicateAdjudication = { merge_groups: [], review_pairs: [], pair_decisions: candidates.pairs.map((pair) => ({ left_id: pair.leftId, right_id: pair.rightId, outcome: "KEEP_SEPARATE", reason_code: "DISTINCT_ENTITY_TYPE_CONTEXT", evidence_pages: [1], explanation: null })) };
    const raw = { relationships: [
      { source: "Mira", relationship: "is a member of", target: "Sword", page: 1, evidence_quote: "Mira owns the Sword." },
      { source: "Nobody", relationship: "owns", target: "Sword", page: 1, evidence_quote: "Mira owns the Sword." },
      { source: "Mira", relationship: "owns", target: "Sword", page: 2, evidence_quote: "Mira owns the Sword." },
      { source: "Mira", relationship: "member of", target: "Sword", page: 1, evidence_quote: "Mira owns the Sword." },
      { source: "Mira", relationship: "member of", target: "Sword", page: 1, evidence_quote: "Mira owns the Sword again." },
    ] };
    const validation = resolveRawRelationships(raw, inventory, chunk);
    const graph = buildLeanGraphCore(inventory, [chunk], [{ chunkId: chunk.id, rawFirstPass: raw, firstPass: validation.relationships, completeness: [], relationships: validation.relationships, firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE" }]);
    const firstPass = [{ chunkId: chunk.id, raw, relationships: validation.relationships, diagnostics: validation.diagnostics, validationRecords: validation.validationRecords, usage: null, checkpointStatus: "REUSE" as const, identity: { operationType: "graph_extraction", inputHash: "input", behaviorVersion: "behavior", schemaVersion: 1 } }];
    const preRescueCoverage = graph.entities.map((entity) => ({ entity_id: entity.key, canonical_name: entity.name, type: entity.type, aliases: entity.aliases, mention_count: 2, mention_page_count: 1, relationship_degree: entity.key === "vault" ? 0 : 1, relationship_evidence_page_count: entity.key === "vault" ? 0 : 1, source_occurrence_excerpt_count: 1, nearby_known_entity_count: 2, nearby_known_entity_ids: [], occurrence_excerpts: [], flags: [entity.key === "vault" ? "SUSPICIOUS_ZERO_RELATIONSHIPS" : "SPARSE_OK"] }));
    const rescue = [{ batch: { batchId: "rescue-001", targets: [{ entity_id: "vault", canonical_name: "Vault", type: "location", aliases: [], trigger_flags: ["SUSPICIOUS_ZERO_RELATIONSHIPS"], occurrence_excerpts: [], relationship_count_before: 0 }], pages: chunk.pages, relevantEntities: [], knownRelationships: [] }, raw: { relationships: [] }, relationships: [], validationRecords: [], diagnostics: [], usage: null, checkpointStatus: "RUN", identity: { operationType: "relationship_rescue", operationKey: "rescue-001", providerId: "openai", modelId: "model", inputHash: "rescue-input", behaviorVersion: "rescue-v1", schemaVersion: 1 } }];
    const audit = buildLeanObservabilityAudit({ inventories: [{ chunkId: chunk.id, initialInventory: { entities: [inventory.entities[0]] }, inventory: { entities: [inventory.entities[0], inventory.entities[1], inventory.entities[2], inventory.entities[3]] } }] as never, finalInventory: inventory, candidates, adjudication: decision, mergedInventory: inventory, firstPass: firstPass as never, completeness: [], graph, preRescueCoverage: preRescueCoverage as never, finalCoverage: preRescueCoverage as never, rescue: rescue as never });

    expect(audit.inventory[0].origin_records[0]).toMatchObject({ chunk_id: chunk.id, introduced_by: "initial_inventory_extraction", original_name: "Mira" });
    expect(audit.inventory.find((item) => item.name === "Sword")?.origin_records[0]?.introduced_by).toBe("inventory_completeness");
    expect(audit.entity_candidates).toHaveLength(candidates.pairs.length);
    expect(audit.entity_candidates.every((item) => item.adjudication?.outcome && item.adjudication.reason_code)).toBe(true);
    expect(audit.relationships.raw_and_validation.map((item) => item.outcome)).toEqual(expect.arrayContaining(["REJECTED_UNKNOWN_ENDPOINT", "REJECTED_INVALID_PAGE", "ACCEPTED"]));
    expect(audit.relationships.normalization[0]).toMatchObject({ raw_label: "is a member of", normalized_input_label: "is a member of", semantic_type: "literal:is a member of", canonical_label: "is a member of", final_relationship_key: "relationship-1" });
    expect(audit.coverage.find((item) => item.entity_id === "vault")?.flags).toContain("SUSPICIOUS_ZERO_RELATIONSHIPS");
    expect(audit.pre_rescue_coverage.find((item) => item.entity_id === "vault")?.flags).toContain("SUSPICIOUS_ZERO_RELATIONSHIPS");
    expect(audit.final_coverage).toEqual(preRescueCoverage);
    expect(audit.rescue[0]).toMatchObject({ entity_id: "vault", trigger_flags: ["SUSPICIOUS_ZERO_RELATIONSHIPS"], raw_relationships_proposed: [], relationship_count_before: 0, relationship_count_after: 0, rescue_checkpoint: { status: "RUN" } });
    expect(buildLeanObservabilityAudit({ inventories: [{ chunkId: chunk.id, initialInventory: { entities: [inventory.entities[0]] }, inventory: { entities: inventory.entities } }] as never, finalInventory: inventory, candidates, adjudication: decision, mergedInventory: inventory, firstPass: firstPass as never, completeness: [], graph, preRescueCoverage: preRescueCoverage as never, finalCoverage: preRescueCoverage as never }).coverage).toEqual(audit.coverage);
    expect(graph.relationships).toHaveLength(2);
  });

  it("dedupes semantic synonyms after resolution while retaining quote provenance and raw audit traceability", () => {
    const pageText = [
      "Mira owns the Sword.",
      "Mira possesses the Sword.",
      "Mira acquired the Sword.",
      "Mira belongs to the Guild.",
      "Mira is a member of the Guild.",
      "The Guild is allied with the Guard.",
      "The Guard is allied with the Guild.",
    ].join("\n");
    const evidenceChunk = { id: "chunk-semantics", characterCount: pageText.length, pages: [{ pageNumber: 1, text: pageText }] };
    const names = [["mira", "Mira", "npc"], ["sword", "Sword", "item"], ["guild", "Guild", "faction"], ["guard", "Guard", "faction"]] as const;
    const semanticInventory: GraphInventory = { entities: names.map(([temporary_id, name, type]) => ({ temporary_id, name, type, memberIds: [temporary_id], sources: [source(1, `${name} appears.`)] })) };
    const raw = { relationships: [
      { source: "Mira", relationship: "owns", target: "Sword", page: 1, evidence_quote: "Mira owns the Sword." },
      { source: "Mira", relationship: "possesses", target: "Sword", page: 1, evidence_quote: "Mira possesses the Sword." },
      { source: "Mira", relationship: "acquired", target: "Sword", page: 1, evidence_quote: "Mira acquired the Sword." },
      { source: "Mira", relationship: "belongs to", target: "Guild", page: 1, evidence_quote: "Mira belongs to the Guild." },
      { source: "Mira", relationship: "is a member of", target: "Guild", page: 1, evidence_quote: "Mira is a member of the Guild." },
      { source: "Guild", relationship: "is allied with", target: "Guard", page: 1, evidence_quote: "The Guild is allied with the Guard." },
      { source: "Guard", relationship: "allied with", target: "Guild", page: 1, evidence_quote: "The Guard is allied with the Guild." },
    ] };
    const validation = resolveRawRelationships(raw, semanticInventory, evidenceChunk);
    const graphInput = [{ chunkId: evidenceChunk.id, rawFirstPass: raw, firstPass: validation.relationships, completeness: [], relationships: validation.relationships, firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "REUSE" as const, completenessCheckpointStatus: "REUSE" as const }];
    const instances = buildRelationshipInstances(graphInput);
    const ids = instances.map((instance) => instance.id);
    const reconciliation: RelationshipReconciliationResult[] = [
      { endpointKey: "mira|sword", inputInstances: instances.slice(0, 3), groups: [
        { groupId: "ownership", unorderedEndpointKey: "mira|sword", instanceIds: ids.slice(0, 2), canonicalInstanceId: ids[0], decisionSource: "MODEL" },
        { groupId: "acquisition", unorderedEndpointKey: "mira|sword", instanceIds: [ids[2]], canonicalInstanceId: ids[2], decisionSource: "MODEL" },
      ], usage: null, checkpointStatus: "REUSE" },
      { endpointKey: "guild|mira", inputInstances: instances.slice(3, 5), groups: [{ groupId: "membership", unorderedEndpointKey: "guild|mira", instanceIds: ids.slice(3, 5), canonicalInstanceId: ids[3], decisionSource: "MODEL" }], usage: null, checkpointStatus: "REUSE" },
      { endpointKey: "guard|guild", inputInstances: instances.slice(5, 7), groups: [{ groupId: "alliance", unorderedEndpointKey: "guard|guild", instanceIds: ids.slice(5, 7), canonicalInstanceId: ids[5], decisionSource: "MODEL" }], usage: null, checkpointStatus: "REUSE" },
    ];
    const graph = buildLeanGraphCore(semanticInventory, [evidenceChunk], graphInput, reconciliation);
    const candidates = buildDuplicateCandidates(semanticInventory, []);
    const identity = { operationType: "graph_extraction", inputHash: "input", behaviorVersion: "behavior", schemaVersion: 2 };
    const audit = buildLeanObservabilityAudit({
      inventories: [{ chunkId: evidenceChunk.id, initialInventory: semanticInventory, inventory: semanticInventory }] as never,
      finalInventory: semanticInventory,
      candidates,
      adjudication: { merge_groups: [], review_pairs: [], pair_decisions: [] },
      mergedInventory: semanticInventory,
      firstPass: [{ chunkId: evidenceChunk.id, raw, relationships: validation.relationships, diagnostics: validation.diagnostics, validationRecords: validation.validationRecords, usage: null, checkpointStatus: "REUSE", identity }] as never,
      completeness: [], graph, relationshipReconciliation: reconciliation,
    });

    expect(graph.relationships).toHaveLength(4);
    const ownership = graph.relationships.find((item) => item.normalization.semanticType === "reconciled:ownership")!;
    const acquisition = graph.relationships.find((item) => item.normalization.semanticType === "reconciled:acquisition")!;
    expect(ownership.normalization.originalRelationshipTypes).toEqual(["owns", "possesses"]);
    expect(ownership.sources.map((item) => item.supporting_text)).toEqual(["Mira owns the Sword.", "Mira possesses the Sword."]);
    expect(acquisition.key).not.toBe(ownership.key);
    expect(graph.relationships.find((item) => item.normalization.semanticType === "reconciled:membership")?.sources).toHaveLength(2);
    expect(graph.relationships.find((item) => item.normalization.semanticType === "reconciled:alliance")?.sources).toHaveLength(2);
    expect(audit.relationships.raw_and_validation).toHaveLength(raw.relationships.length);
    expect(audit.relationships.semantic_reconciliation).toEqual(expect.arrayContaining([expect.objectContaining({ canonical_instance_id: ids[0], final_relationship_key: ownership.key })]));
    expect(audit.relationships.final_normalization_and_provenance.find((item) => item.relationship_key === ownership.key)?.provenance_pages_retained).toEqual([1]);
  });

  it("keeps lexical normalization non-semantic before model reconciliation", () => {
    const inverse = normalizeRelationshipFact("guild", "mira", "has member");
    expect(inverse).toMatchObject({ sourceId: "guild", targetId: "mira", semanticType: "literal:has member", reversed: false });
    const forwardAlliance = normalizeRelationshipFact("guild", "guard", "allied with");
    const reverseAlliance = normalizeRelationshipFact("guard", "guild", "is allied with");
    expect(relationshipSemanticKey(forwardAlliance)).not.toBe(relationshipSemanticKey(reverseAlliance));
    expect(forwardAlliance).toMatchObject({ directional: true, symmetric: false });
  });
});
