import type { InventoryExtractedChunk } from "@/lib/ai/extract";
import type { DuplicateAdjudication, DuplicateCandidates, EntityMergeApplication, GraphInventory } from "@/lib/ai/entity-reconciliation";
import type { GraphCompletenessResult, GraphFirstPassResult } from "@/lib/processing/graph-core";
import type { CanonicalGraph } from "@/lib/graph/types";
import type { PageChunk } from "@/lib/pdf/types";
import { GRAPH_COVERAGE_BEHAVIOR_VERSION, RELATIONSHIP_RESCUE_BEHAVIOR_VERSION, type EntityCoverageAudit, type RelationshipRescueResult } from "@/lib/processing/relationship-rescue";
import { RELATIONSHIP_RECONCILIATION_BEHAVIOR_VERSION, type RelationshipReconciliationResult } from "@/lib/ai/relationship-reconciliation";
import { pageTextForModel } from "@/lib/pdf/model-text";

const pages = (sources: Array<{ page_number: number }>) => [...new Set(sources.map((source) => source.page_number))].sort((a, b) => a - b);
const pairKey = (left: string, right: string) => [left, right].sort().join("|");

/** A compact, append-only processing_runs artifact. It deliberately contains no new model output. */
export function buildLeanObservabilityAudit(args: {
  inventories: InventoryExtractedChunk[]; finalInventory: GraphInventory; candidates: DuplicateCandidates;
  adjudication: DuplicateAdjudication; entityMergeApplications?: EntityMergeApplication[]; mergedInventory: GraphInventory; firstPass: GraphFirstPassResult[];
  completeness: GraphCompletenessResult[]; graph: CanonicalGraph; sourceChunks?: PageChunk[];
  preRescueCoverage?: EntityCoverageAudit[]; finalCoverage?: EntityCoverageAudit[]; rescue?: RelationshipRescueResult[];
  relationshipReconciliation?: RelationshipReconciliationResult[];
}) {
  const { inventories, finalInventory, candidates, adjudication, entityMergeApplications = [], mergedInventory, firstPass, completeness, graph, sourceChunks = [], preRescueCoverage, finalCoverage, rescue = [], relationshipReconciliation = [] } = args;
  const inputEntities = inventories.flatMap((chunk) => [
    ...((chunk.initialInventory ?? chunk.inventory).entities.map((entity) => ({ chunkId: chunk.chunkId, introducedBy: "initial_inventory_extraction" as const, entity }))),
    ...((chunk.inventory ?? { entities: [] }).entities.filter((entity) => !(chunk.initialInventory ?? { entities: [] }).entities.some((initial) => initial.temporary_id === entity.temporary_id)).map((entity) => ({ chunkId: chunk.chunkId, introducedBy: "inventory_completeness" as const, entity }))),
  ]);
  const inventoryAudit = finalInventory.entities.map((entity) => ({
    inventory_id: entity.temporary_id, name: entity.name, type: entity.type, member_temporary_ids: entity.memberIds ?? [entity.temporary_id],
    origin_records: inputEntities.filter((input) => input.entity.type === entity.type && input.entity.sources.some((source) => entity.sources.some((finalSource) => finalSource.page_number === source.page_number && finalSource.supporting_text === source.supporting_text))).map((input) => ({ chunk_id: input.chunkId, introduced_by: input.introducedBy, original_temporary_id: input.entity.temporary_id, original_name: input.entity.name, original_type: input.entity.type, evidence_pages: pages(input.entity.sources) })),
    evidence_pages: pages(entity.sources),
  }));
  const entityById = new Map(finalInventory.entities.map((entity) => [entity.temporary_id, entity]));
  const componentByPair = new Map(candidates.components.flatMap((component) => component.pairs.map((pair) => [pairKey(pair.leftId, pair.rightId), component.componentId] as const)));
  const decisionByPair = new Map((adjudication.pair_decisions ?? []).map((decision) => [pairKey(decision.left_id, decision.right_id), decision]));
  const candidateAudit = candidates.pairs.map((pair) => {
    const left = entityById.get(pair.leftId)!; const right = entityById.get(pair.rightId)!; const decision = decisionByPair.get(pairKey(pair.leftId, pair.rightId));
    const names = new Set([left.name.toLocaleLowerCase("en-US"), right.name.toLocaleLowerCase("en-US")]);
    const relevant_relationship_evidence = firstPass.flatMap((result) => result.raw.relationships.filter((relationship) => names.has(relationship.source.toLocaleLowerCase("en-US")) || names.has(relationship.target.toLocaleLowerCase("en-US"))).map((relationship) => ({ chunk_id: result.chunkId, page: relationship.page, raw_source_name: relationship.source, raw_relationship_label: relationship.relationship, raw_target_name: relationship.target })));
    const occurrence_excerpts = sourceChunks.flatMap((chunk) => chunk.pages.flatMap((page) => { const compact = pageTextForModel(page).replace(/\s+/g, " ").trim(); const lowered = compact.toLocaleLowerCase("en-US"); const indexes = [...names].map((name) => lowered.indexOf(name)).filter((index) => index >= 0); return indexes.length ? [{ chunk_id: chunk.id, page: page.pageNumber, excerpt: compact.slice(Math.max(0, Math.min(...indexes) - 160), Math.max(0, Math.min(...indexes) - 160) + 480) }] : []; })).slice(0, 4);
    const overlap = pages(left.sources).filter((page) => pages(right.sources).includes(page));
    return { component_id: componentByPair.get(pairKey(pair.leftId, pair.rightId)), left: { id: left.temporary_id, name: left.name, type: left.type, evidence_pages: pages(left.sources), inventory_source_excerpts: left.sources.slice(0, 3) }, right: { id: right.temporary_id, name: right.name, type: right.type, evidence_pages: pages(right.sources), inventory_source_excerpts: right.sources.slice(0, 3) }, reasons: pair.reasons, source_page_overlap: overlap, occurrence_excerpts, relevant_relationship_evidence, sent_to_adjudicator: candidates.pairs.length > 0, adjudication: decision ? { outcome: decision.outcome, reason_code: decision.reason_code, evidence_pages: decision.evidence_pages, explanation: decision.explanation ?? null } : null };
  });
  const mergedById = new Map(mergedInventory.entities.map((entity) => [entity.temporary_id, entity]));
  const mergeAudit = [...new Set(entityMergeApplications.filter((item) => item.outcome === "APPLIED").map((item) => item.canonical_member_id!))].map((canonicalId) => {
    const canonical = mergedById.get(canonicalId)!;
    return { canonical_member_id: canonicalId, canonical_name: canonical.name, canonical_type: canonical.type, member_ids: canonical.memberIds ?? [canonicalId], aliases: canonical.aliases ?? [] };
  });
  const finalRelationshipBySemantic = new Map(graph.relationships.map((relationship) => [`${relationship.sourceEntityKey}|${relationship.targetEntityKey}|${relationship.normalization.semanticType}`, relationship]));
  const firstKeys = new Set(firstPass.flatMap((result) => result.validationRecords.filter((record) => record.outcome === "ACCEPTED").map((record) => record.semanticKey)));
  const normalRelationshipAudit = [
    ...firstPass.flatMap((result) => result.validationRecords.map((record) => ({ pass: "graph_extraction" as const, chunk_id: result.chunkId, checkpoint: { operation_type: result.identity.operationType, provider_id: result.identity.providerId, model_id: result.identity.modelId, input_hash: result.identity.inputHash, behavior_version: result.identity.behaviorVersion, schema_version: result.identity.schemaVersion }, ...record }))),
    ...completeness.flatMap((result) => result.validationRecords.map((record) => ({ pass: "graph_completeness" as const, chunk_id: result.chunkId, checkpoint: { operation_type: result.identity.operationType, provider_id: result.identity.providerId, model_id: result.identity.modelId, input_hash: result.identity.inputHash, behavior_version: result.identity.behaviorVersion, schema_version: result.identity.schemaVersion }, ...record, outcome: record.outcome === "ACCEPTED" && record.semanticKey && firstKeys.has(record.semanticKey) ? "REJECTED_DUPLICATE" : record.outcome }))),
  ];
  const seenSemanticKeys = new Set(normalRelationshipAudit.filter((record) => record.outcome === "ACCEPTED" && record.semanticKey).map((record) => record.semanticKey!));
  const rescueRelationshipAudit = rescue.flatMap((result) => result.validationRecords.map((record) => {
    const duplicate = record.outcome === "ACCEPTED" && record.semanticKey && seenSemanticKeys.has(record.semanticKey);
    if (record.outcome === "ACCEPTED" && record.semanticKey) seenSemanticKeys.add(record.semanticKey);
    return { pass: "relationship_rescue" as const, chunk_id: result.batch.batchId, checkpoint: { operation_type: result.identity.operationType, provider_id: result.identity.providerId, model_id: result.identity.modelId, input_hash: result.identity.inputHash, behavior_version: result.identity.behaviorVersion, schema_version: result.identity.schemaVersion }, ...record, outcome: duplicate ? "REJECTED_DUPLICATE" as const : record.outcome };
  }));
  const relationshipAudit = [...normalRelationshipAudit, ...rescueRelationshipAudit].map((record) => ({ ...record, final_relationship_key: record.semanticKey ? finalRelationshipBySemantic.get(record.semanticKey)?.key ?? null : null }));
  const normalizedRecords = relationshipAudit.filter((record) => (record.outcome === "ACCEPTED" || record.outcome === "REJECTED_DUPLICATE") && record.final_relationship_key);
  const normalizationAudit = normalizedRecords.map((record) => {
    const relationship = finalRelationshipBySemantic.get(record.semanticKey!)!;
    const merged = normalizedRecords.filter((item) => item.final_relationship_key === relationship.key && item !== record);
    return { raw_label: record.rawRelationshipLabel, normalized_input_label: record.normalizedInputLabel, semantic_type: record.semanticType, canonical_label: record.canonicalLabel, direction_reversed: record.reversed, inverse_semantics_known: record.knownInverse, final_relationship_key: relationship.key, merged_into_existing_semantic_edge: merged.length > 0, merged_with: merged.map((item) => ({ raw_source_name: item.rawSourceName, raw_relationship_label: item.rawRelationshipLabel, raw_target_name: item.rawTargetName, page: item.page })), provenance_pages_retained: pages(relationship.sources) };
  });
  const legacyCoverage = graph.entities.map((entity) => {
    const touching = graph.relationships.filter((relationship) => relationship.sourceEntityKey === entity.key || relationship.targetEntityKey === entity.key);
    const evidencePages = new Set(touching.flatMap((relationship) => relationship.sources.map((source) => source.page_number)));
    const flags = [touching.length === 0 ? "NO_RELATIONSHIPS" : null, touching.length > 0 && touching.length < 2 ? "LOW_RELATIONSHIP_COVERAGE" : null].filter(Boolean);
    return { entity_id: entity.key, canonical_name: entity.name, type: entity.type, source_mention_count: entity.sourceMentionCount ?? entity.sources.length, source_mention_page_count: entity.sourceMentionPageCount ?? pages(entity.sources).length, relationship_degree: touching.length, relationship_evidence_page_count: evidencePages.size, aliases: entity.aliases, flags };
  }).sort((left, right) => left.entity_id.localeCompare(right.entity_id));
  const finalCoverageAudit = finalCoverage ?? legacyCoverage;
  const finalCoverageById = new Map(finalCoverageAudit.map((item) => [item.entity_id, item]));
  const rescueAudit = rescue.flatMap((result) => result.batch.targets.map((target) => {
    const finalEntityId = graph.candidateToCanonical.get(target.entity_id) ?? target.entity_id;
    return {
    entity_id: target.entity_id,
    final_entity_id: finalEntityId,
    canonical_name: target.canonical_name,
    trigger_flags: target.trigger_flags,
    source_window_pages: result.batch.pages.map((page) => page.pageNumber),
    rescue_checkpoint: { operation_type: result.identity.operationType, operation_key: result.identity.operationKey, provider_id: result.identity.providerId, model_id: result.identity.modelId, input_hash: result.identity.inputHash, behavior_version: result.identity.behaviorVersion, schema_version: result.identity.schemaVersion, status: result.checkpointStatus },
    raw_relationships_proposed: result.raw.relationships,
    validation_results: result.validationRecords,
    relationship_count_before: target.relationship_count_before,
    relationship_count_after: finalCoverageById.get(finalEntityId)?.relationship_degree ?? 0,
  }; }));
  const reconciliationAudit = relationshipReconciliation.flatMap((result) => result.groups.map((group) => ({
    unordered_endpoint_pair: result.endpointKey,
    input_instance_ids: group.instanceIds,
    canonical_instance_id: group.canonicalInstanceId,
    decision_source: group.decisionSource,
    checkpoint: result.identity ? { operation_type: result.identity.operationType, operation_key: result.identity.operationKey, provider_id: result.identity.providerId, model_id: result.identity.modelId, input_hash: result.identity.inputHash, behavior_version: result.identity.behaviorVersion, schema_version: result.identity.schemaVersion, status: result.checkpointStatus } : null,
    final_relationship_key: graph.relationships.find((relationship) => relationship.candidateRelationshipIds.includes(group.canonicalInstanceId))?.key ?? null,
  })));
  return { audit_schema_version: 3, coverage_behavior_version: GRAPH_COVERAGE_BEHAVIOR_VERSION, relationship_rescue_behavior_version: RELATIONSHIP_RESCUE_BEHAVIOR_VERSION, relationship_reconciliation_behavior_version: RELATIONSHIP_RECONCILIATION_BEHAVIOR_VERSION, inventory: inventoryAudit, entity_candidates: candidateAudit, adjudication: { proposed_merge_groups_ignored: adjudication.merge_groups, applied_merge_groups: mergeAudit, pair_decisions: candidateAudit.map((candidate) => ({ component_id: candidate.component_id, left_id: candidate.left.id, right_id: candidate.right.id, ...candidate.adjudication })), merge_application: entityMergeApplications }, relationships: { raw_and_validation: relationshipAudit, semantic_reconciliation: reconciliationAudit, final_normalization_and_provenance: graph.relationships.map((relationship) => ({ relationship_key: relationship.key, source_entity_id: relationship.sourceEntityKey, label: relationship.relationshipType, target_entity_id: relationship.targetEntityKey, input_instance_ids: relationship.candidateRelationshipIds, provenance_pages_retained: pages(relationship.sources) })), normalization: normalizationAudit }, pre_rescue_coverage: preRescueCoverage ?? legacyCoverage, final_coverage: finalCoverageAudit, rescue: rescueAudit, coverage: finalCoverageAudit };
}
