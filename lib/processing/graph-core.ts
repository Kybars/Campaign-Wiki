import { graphExtractionOutputSchema, GRAPH_EXTRACTION_BEHAVIOR_VERSION, GRAPH_EXTRACTION_CONTRACT_VERSION, GRAPH_EXTRACTION_SYSTEM_PROMPT, FOCUSED_GRAPH_EXTRACTION_SYSTEM_PROMPT, buildFocusedGraphExtractionInput, buildGraphExtractionInput, resolveRawRelationships, runFocusedGraphExtraction, runGraphExtraction, validateFocusedGraphExtraction, type FocusedGraphWindow, type GraphExtractionOutput, type GraphValidationDiagnostic, type RelationshipValidationRecord, type ValidatedGraphRelationship } from "@/lib/ai/graph-extraction";
import { GRAPH_COMPLETENESS_BEHAVIOR_VERSION, GRAPH_COMPLETENESS_CONTRACT_VERSION, GRAPH_COMPLETENESS_SYSTEM_PROMPT, buildGraphCompletenessInput, buildGraphCompletenessUnion, runGraphCompletenessSweep, validateGraphCompletenessSweep } from "@/lib/ai/graph-completeness";
import type { GraphInventory } from "@/lib/ai/entity-reconciliation";
import type { AIOperationCheckpointStore, AIOperationIdentity, CheckpointPlanStatus } from "@/lib/ai/operation-checkpoint";
import { GRAPH_CORE_BEHAVIOR_VERSION, GRAPH_CORE_CONTRACT_VERSION, modelInputHash, semanticInputHash } from "@/lib/ai/operation-checkpoint";
import type { ValidatedExtractionInventoryOutput, SourceEvidence } from "@/lib/ai/schemas";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import type { ModelCallUsage } from "@/lib/ai/usage";
import { normalizeCanonicalDisplayName, normalizeName } from "@/lib/graph/normalize";
import type { CanonicalGraph, CanonicalRelationship } from "@/lib/graph/types";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";
import { relationshipPresentation, normalizeRelationshipFact } from "@/lib/relationships/normalize";
import type { PageChunk } from "@/lib/pdf/types";
import type { RelationshipReconciliationResult } from "@/lib/ai/relationship-reconciliation";
import { SPAN_GRAPH_EXTRACTION_BEHAVIOR_VERSION, SPAN_GRAPH_EXTRACTION_CONTRACT_VERSION, SPAN_GRAPH_EXTRACTION_SYSTEM_PROMPT, buildSpanGraphExtractionInput, runSpanGraphExtraction, validateSpanGraphExtraction, type SpanGraphRequest } from "@/lib/ai/span-graph-extraction";

export interface GraphCheckpointContext { campaignId: string; documentId: string; processingMode: string; store: AIOperationCheckpointStore; finalInventoryFingerprint: string; finalInventoryUpstreamFingerprint: string; }
export interface GraphPlanItem { chunkId: string; operationType: "graph_extraction" | "graph_completeness"; status: CheckpointPlanStatus; reason: string; }
export interface GraphFirstPassResult { chunkId: string; raw: GraphExtractionOutput; relationships: ValidatedGraphRelationship[]; diagnostics: GraphValidationDiagnostic[]; validationRecords: RelationshipValidationRecord[]; usage: ModelCallUsage | null; checkpointStatus: "REUSE" | "RUN"; identity: AIOperationIdentity; }
export interface GraphCompletenessResult { chunkId: string; raw: GraphExtractionOutput; relationships: ValidatedGraphRelationship[]; validationRecords: RelationshipValidationRecord[]; usage: ModelCallUsage | null; checkpointStatus: "REUSE" | "RUN"; identity: AIOperationIdentity; }
export interface GraphChunkResult { chunkId: string; rawFirstPass?: GraphExtractionOutput; firstPass: ValidatedGraphRelationship[]; completeness: ValidatedGraphRelationship[]; relationships: ValidatedGraphRelationship[]; firstPassUsage: ModelCallUsage | null; completenessUsage: ModelCallUsage | null; firstPassCheckpointStatus: "REUSE" | "RUN"; completenessCheckpointStatus: "REUSE" | "RUN"; }

const emptyGraph: CanonicalGraph["factAggregationDiagnostics"] = { candidateFactCount: 0, canonicalFactCount: 0, deduplicatedFactCount: 0, factEvidenceCount: 0 };

function checkpointStatus(store: AIOperationCheckpointStore, identity: AIOperationIdentity) {
  return store.inspect ? store.inspect(identity) : store.load(identity).then((item) => item ? { status: "REUSE" as const, reason: "exact validated identity" } : { status: "RUN" as const, reason: "no compatible validated checkpoint" });
}

function firstPassKeys(relationships: ValidatedGraphRelationship[]) { return new Set(relationships.map((relationship) => relationship.semanticKey)); }

export function graphExtractionCheckpointIdentity(chunk: PageChunk, inventory: GraphInventory, provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): AIOperationIdentity {
  const spanRequest = "units" in chunk ? chunk as SpanGraphRequest : null;
  const focused = "entityIds" in chunk ? chunk as FocusedGraphWindow : null;
  const payload = spanRequest ? buildSpanGraphExtractionInput(spanRequest, inventory) : focused ? buildFocusedGraphExtractionInput([focused], inventory) : buildGraphExtractionInput(chunk, inventory);
  const system = spanRequest ? SPAN_GRAPH_EXTRACTION_SYSTEM_PROMPT : focused ? FOCUSED_GRAPH_EXTRACTION_SYSTEM_PROMPT : GRAPH_EXTRACTION_SYSTEM_PROMPT;
  return { campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null, providerId: provider.providerId, modelId: provider.modelId, processingMode: checkpoint.processingMode, stage: "extraction", operationType: "graph_extraction", operationKey: chunk.id, inputHash: modelInputHash(system, payload), upstreamFingerprint: semanticInputHash({ chunk: chunk.pages, finalInventory: checkpoint.finalInventoryFingerprint, inventoryUpstream: checkpoint.finalInventoryUpstreamFingerprint, units: spanRequest?.units.map((unit) => unit.unitId), focusedEntityIds: focused?.entityIds }), behaviorVersion: spanRequest ? SPAN_GRAPH_EXTRACTION_BEHAVIOR_VERSION : focused ? "v0.7.0-focused-occurrence-windows-1" : GRAPH_EXTRACTION_BEHAVIOR_VERSION, schemaVersion: spanRequest ? SPAN_GRAPH_EXTRACTION_CONTRACT_VERSION : focused ? 4 : GRAPH_EXTRACTION_CONTRACT_VERSION };
}

export function graphCompletenessCheckpointIdentity(chunk: PageChunk, inventory: GraphInventory, firstPass: ValidatedGraphRelationship[], provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): AIOperationIdentity {
  const payload = buildGraphCompletenessInput(chunk, inventory, firstPass);
  return { campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null, providerId: provider.providerId, modelId: provider.modelId, processingMode: checkpoint.processingMode, stage: "extraction", operationType: "graph_completeness", operationKey: chunk.id, inputHash: modelInputHash(GRAPH_COMPLETENESS_SYSTEM_PROMPT, payload), upstreamFingerprint: semanticInputHash({ mergedInventory: inventory, resolvedFirstPass: firstPass.map((relationship) => relationship.semanticKey).sort() }), behaviorVersion: GRAPH_COMPLETENESS_BEHAVIOR_VERSION, schemaVersion: GRAPH_COMPLETENESS_CONTRACT_VERSION };
}

type GraphCheckpointOutput = { raw: GraphExtractionOutput };

async function loadFirstPass(identity: AIOperationIdentity, chunk: PageChunk, inventory: GraphInventory, checkpoint: GraphCheckpointContext) {
  const cached = await checkpoint.store.load<GraphCheckpointOutput>(identity);
  if (!cached) return null;
  try {
    const raw = graphExtractionOutputSchema.parse(cached.output.raw);
    const validation = resolveRawRelationships(raw, inventory, chunk);
    return { raw, relationships: validation.relationships, diagnostics: validation.diagnostics, validationRecords: validation.validationRecords, usage: cached.usage[0] ?? null };
  } catch (error) {
    await checkpoint.store.saveFailed(identity, cached.usage, "Stored graph extraction invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount);
    return null;
  }
}

async function loadCompleteness(identity: AIOperationIdentity, chunk: PageChunk, inventory: GraphInventory, firstPass: ValidatedGraphRelationship[], checkpoint: GraphCheckpointContext) {
  const cached = await checkpoint.store.load<GraphCheckpointOutput>(identity);
  if (!cached) return null;
  try { const raw = graphExtractionOutputSchema.parse(cached.output.raw); const validated = validateGraphCompletenessSweep(raw, inventory, chunk, firstPassKeys(firstPass)); return { raw, relationships: validated.novelRelationships, validationRecords: validated.validation.validationRecords, usage: cached.usage[0] ?? null }; }
  catch (error) { await checkpoint.store.saveFailed(identity, cached.usage, "Stored graph completeness invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount); return null; }
}

export async function planGraphFirstPass(chunks: PageChunk[], inventory: GraphInventory, provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): Promise<GraphPlanItem[]> {
  const plan: GraphPlanItem[] = [];
  for (const chunk of chunks) plan.push({ chunkId: chunk.id, operationType: "graph_extraction", ...(await checkpointStatus(checkpoint.store, graphExtractionCheckpointIdentity(chunk, inventory, provider, checkpoint))) });
  return plan;
}

export async function runGraphFirstPass(chunk: PageChunk, inventory: GraphInventory, provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): Promise<GraphFirstPassResult> {
  const identity = graphExtractionCheckpointIdentity(chunk, inventory, provider, checkpoint);
  let loaded = await loadFirstPass(identity, chunk, inventory, checkpoint);
  const status: "REUSE" | "RUN" = loaded ? "REUSE" : "RUN";
  if (!loaded) {
    const spanRequest = "units" in chunk ? chunk as SpanGraphRequest : null;
    const focused = "entityIds" in chunk ? chunk as FocusedGraphWindow : null;
    let raw: GraphExtractionOutput; let validation: ReturnType<typeof resolveRawRelationships>;
    if (spanRequest) {
      const response = await runSpanGraphExtraction(spanRequest, inventory, provider);
      validation = validateSpanGraphExtraction(response.output, spanRequest, inventory);
      raw = { relationships: validation.relationships.map((relationship) => ({ source: relationship.sourceName, relationship: relationship.relationship, target: relationship.targetName, page: relationship.page, evidence_quote: relationship.matchedEvidenceText })) };
      loaded = { raw, relationships: validation.relationships, diagnostics: validation.diagnostics, validationRecords: validation.validationRecords, usage: response.usage };
    } else if (focused) {
      const response = await runFocusedGraphExtraction([focused], inventory, provider);
      validation = validateFocusedGraphExtraction(response.output, [focused], inventory);
      raw = { relationships: validation.validationRecords.filter((record) => record.outcome === "ACCEPTED").map((record) => ({ source: record.rawSourceName, relationship: record.rawRelationshipLabel, target: record.rawTargetName, page: record.page, evidence_quote: record.evidenceQuote })) };
      loaded = { raw, relationships: validation.relationships, diagnostics: validation.diagnostics, validationRecords: validation.validationRecords, usage: response.usage };
    } else {
      const response = await runGraphExtraction(chunk, inventory, provider);
      raw = graphExtractionOutputSchema.parse(response.output);
      validation = resolveRawRelationships(raw, inventory, chunk);
      loaded = { raw, relationships: validation.relationships, diagnostics: validation.diagnostics, validationRecords: validation.validationRecords, usage: response.usage };
    }
    await checkpoint.store.saveValidated({ identity, output: { raw }, usage: [loaded.usage], attemptCount: 1 });
  }
  return { chunkId: chunk.id, ...loaded, usage: status === "RUN" ? loaded.usage : null, checkpointStatus: status, identity };
}

async function runLimited<T>(items: PageChunk[], concurrency: number, operation: (chunk: PageChunk) => Promise<T>, onCompleted?: (result: T, chunk: PageChunk, index: number) => Promise<void>) {
  const results = new Array<T>(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; const result = await operation(items[index]); if (onCompleted) await onCompleted(result, items[index], index); results[index] = result; } }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
}

export function runGraphFirstPassLimited(chunks: PageChunk[], inventory: GraphInventory, provider: StructuredModelProvider, checkpoint: GraphCheckpointContext, concurrency: number, onCompleted?: (result: GraphFirstPassResult, chunk: PageChunk, index: number) => Promise<void>) {
  return runLimited(chunks, concurrency, (chunk) => runGraphFirstPass(chunk, inventory, provider, checkpoint), onCompleted);
}

export function reResolveGraphFirstPass(firstPass: GraphFirstPassResult[], chunks: PageChunk[], inventory: GraphInventory): GraphFirstPassResult[] {
  return finalizeRawRelationshipPasses(firstPass, chunks, inventory);
}

/** Shared post-reconciliation resolver for first-pass and future rescue raw outputs. */
export function finalizeRawRelationshipPasses<T extends { chunkId: string; raw: GraphExtractionOutput }>(passes: T[], chunks: PageChunk[], inventory: GraphInventory): Array<T & { relationships: ValidatedGraphRelationship[]; diagnostics: GraphValidationDiagnostic[]; validationRecords: RelationshipValidationRecord[] }> {
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const validEntityIds = new Set(inventory.entities.map((entity) => entity.temporary_id));
  return passes.map((result) => {
    const chunk = chunkById.get(result.chunkId); if (!chunk) throw new Error(`Missing graph chunk ${result.chunkId}`);
    const validation = resolveRawRelationships(result.raw, inventory, chunk);
    if (validation.relationships.some((relationship) => !validEntityIds.has(relationship.sourceInventoryId) || !validEntityIds.has(relationship.targetInventoryId))) throw new Error("Final relationship resolution retained a stale pre-merge endpoint");
    return { ...result, relationships: validation.relationships, diagnostics: validation.diagnostics, validationRecords: validation.validationRecords };
  });
}

export async function planGraphCompleteness(chunks: PageChunk[], inventory: GraphInventory, firstPass: GraphFirstPassResult[], provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): Promise<GraphPlanItem[]> {
  const firstByChunk = new Map(firstPass.map((result) => [result.chunkId, result]));
  const plan: GraphPlanItem[] = [];
  for (const chunk of chunks) {
    const first = firstByChunk.get(chunk.id); if (!first) throw new Error(`Missing first pass for ${chunk.id}`);
    const identity = graphCompletenessCheckpointIdentity(chunk, inventory, first.relationships, provider, checkpoint);
    plan.push({ chunkId: chunk.id, operationType: "graph_completeness", ...(await checkpointStatus(checkpoint.store, identity)) });
  }
  return plan;
}

export async function runGraphCompleteness(chunk: PageChunk, inventory: GraphInventory, firstPass: ValidatedGraphRelationship[], provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): Promise<GraphCompletenessResult> {
  const identity = graphCompletenessCheckpointIdentity(chunk, inventory, firstPass, provider, checkpoint);
  let loaded = await loadCompleteness(identity, chunk, inventory, firstPass, checkpoint);
  const status: "REUSE" | "RUN" = loaded ? "REUSE" : "RUN";
  if (!loaded) {
    const response = await runGraphCompletenessSweep(chunk, inventory, firstPass, provider);
    const validated = validateGraphCompletenessSweep(response.output, inventory, chunk, firstPassKeys(firstPass));
    loaded = { raw: response.output, relationships: validated.novelRelationships, validationRecords: validated.validation.validationRecords, usage: response.usage };
    await checkpoint.store.saveValidated({ identity, output: { raw: response.output }, usage: [response.usage], attemptCount: 1 });
  }
  return { chunkId: chunk.id, raw: loaded.raw, relationships: loaded.relationships, validationRecords: loaded.validationRecords, usage: status === "RUN" ? loaded.usage : null, checkpointStatus: status, identity };
}

export function runGraphCompletenessLimited(chunks: PageChunk[], inventory: GraphInventory, firstPass: GraphFirstPassResult[], provider: StructuredModelProvider, checkpoint: GraphCheckpointContext, concurrency: number) {
  const firstByChunk = new Map(firstPass.map((result) => [result.chunkId, result]));
  return runLimited(chunks, concurrency, (chunk) => {
    const first = firstByChunk.get(chunk.id); if (!first) throw new Error(`Missing first pass for ${chunk.id}`);
    return runGraphCompleteness(chunk, inventory, first.relationships, provider, checkpoint);
  });
}

export function combineGraphPasses(firstPass: GraphFirstPassResult[], completeness: GraphCompletenessResult[]): GraphChunkResult[] {
  const completenessByChunk = new Map(completeness.map((result) => [result.chunkId, result]));
  return firstPass.map((first) => {
    const second = completenessByChunk.get(first.chunkId);
    return { chunkId: first.chunkId, rawFirstPass: first.raw, firstPass: first.relationships, completeness: second?.relationships ?? [], relationships: buildGraphCompletenessUnion(first.relationships, second?.relationships ?? []), firstPassUsage: first.usage, completenessUsage: second?.usage ?? null, firstPassCheckpointStatus: first.checkpointStatus, completenessCheckpointStatus: second?.checkpointStatus ?? "REUSE" };
  });
}

/** Backward-compatible single-chunk helper; production uses the split pass runners. */
export async function runGraphChunk(chunk: PageChunk, inventory: GraphInventory, providers: { extraction: StructuredModelProvider; completeness: StructuredModelProvider }, checkpoint: GraphCheckpointContext): Promise<GraphChunkResult> {
  const first = await runGraphFirstPass(chunk, inventory, providers.extraction, checkpoint);
  const second = await runGraphCompleteness(chunk, inventory, first.relationships, providers.completeness, checkpoint);
  return combineGraphPasses([first], [second])[0];
}

export async function planGraphChunks(chunks: PageChunk[], inventory: GraphInventory, providers: { extraction: StructuredModelProvider; completeness: StructuredModelProvider }, checkpoint: GraphCheckpointContext): Promise<GraphPlanItem[]> {
  const firstPlan = await planGraphFirstPass(chunks, inventory, providers.extraction, checkpoint);
  const first = await Promise.all(chunks.map(async (chunk) => {
    const identity = graphExtractionCheckpointIdentity(chunk, inventory, providers.extraction, checkpoint);
    const loaded = await loadFirstPass(identity, chunk, inventory, checkpoint);
    return loaded ? { chunkId: chunk.id, ...loaded, usage: null, checkpointStatus: "REUSE" as const, identity } : null;
  }));
  if (first.some((item) => item === null)) return [...firstPlan, ...chunks.map((chunk) => ({ chunkId: chunk.id, operationType: "graph_completeness" as const, status: "RUN" as const, reason: "dependent graph extraction or reconciliation will run first" }))];
  return [...firstPlan, ...(await planGraphCompleteness(chunks, inventory, first as GraphFirstPassResult[], providers.completeness, checkpoint))];
}

export async function runGraphChunksLimited(chunks: PageChunk[], inventory: GraphInventory, providers: { extraction: StructuredModelProvider; completeness: StructuredModelProvider }, checkpoint: GraphCheckpointContext, concurrency: number) {
  const first = await runGraphFirstPassLimited(chunks, inventory, providers.extraction, checkpoint, concurrency);
  const second = await runGraphCompletenessLimited(chunks, inventory, first, providers.completeness, checkpoint, concurrency);
  return combineGraphPasses(first, second);
}

function uniqueSources(sources: SourceEvidence[]) { const seen = new Set<string>(); return sources.filter((source) => { const key = `${source.page_number}:${source.supporting_text}`; if (seen.has(key)) return false; seen.add(key); return true; }); }

export function buildFinalGraphInventory(inventories: ValidatedExtractionInventoryOutput[]): GraphInventory {
  const grouped = new Map<string, ValidatedExtractionInventoryOutput["entities"]>();
  for (const entity of inventories.flatMap((inventory) => inventory.entities)) {
    const key = `${entity.type}:${normalizeName(entity.name)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), entity]);
  }
  const entities = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group], index) => ({ temporary_id: `graph_inventory_${index + 1}`, name: [...group].sort((left, right) => left.name.localeCompare(right.name))[0].name, type: group[0].type, aliases: [], memberIds: group.map((entity) => entity.temporary_id).sort(), sources: uniqueSources(group.flatMap((entity) => entity.sources)).sort((left, right) => left.page_number - right.page_number || left.supporting_text.localeCompare(right.supporting_text)) }));
  if (new Set(entities.map((entity) => entity.temporary_id)).size !== entities.length) throw new Error("Graph inventory ID collision");
  return { entities };
}

/** Exact raw text matched during quote validation; never model-generated evidence. */
export function relationshipPageExcerpt(chunk: PageChunk, relationship: ValidatedGraphRelationship): SourceEvidence {
  const page = chunk.pages.find((item) => item.pageNumber === relationship.page);
  if (!page) throw new Error(`Validated relationship page ${relationship.page} is unavailable`);
  if (!relationship.matchedEvidenceText || !page.text.includes(relationship.matchedEvidenceText)) throw new Error(`Validated relationship evidence is unavailable on raw page ${relationship.page}`);
  return { page_number: relationship.page, supporting_text: relationship.matchedEvidenceText };
}

export function buildLeanGraphCore(inventory: GraphInventory, chunks: PageChunk[], chunkResults: GraphChunkResult[], reconciliation?: RelationshipReconciliationResult[]): CanonicalGraph {
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const entityById = new Map(inventory.entities.map((entity) => [entity.temporary_id, entity]));
  const byKey = new Map<string, CanonicalRelationship>();
  if (reconciliation) {
    const instances = new Map(reconciliation.flatMap((result) => result.inputInstances.map((instance) => [instance.id, instance] as const)));
    for (const decision of reconciliation.flatMap((result) => result.groups)) {
      const canonical = instances.get(decision.canonicalInstanceId);
      if (!canonical) throw new Error("Relationship reconciliation selected an unknown canonical instance");
      const relationship = canonical.relationship;
      const source = entityById.get(relationship.sourceInventoryId); const target = entityById.get(relationship.targetInventoryId);
      if (!source || !target) throw new Error("Reconciled relationship has an unknown final-inventory endpoint");
      const members = decision.instanceIds.map((id) => { const item = instances.get(id); if (!item) throw new Error("Relationship reconciliation group contains an unknown instance"); return item; });
      const provenance = uniqueSources(members.map((instance) => {
        const chunk = chunkById.get(instance.chunkId); if (!chunk) throw new Error(`Missing graph chunk ${instance.chunkId}`);
        return relationshipPageExcerpt(chunk, instance.relationship);
      }));
      const label = relationship.relationship.trim().replace(/\s+/gu, " ");
      byKey.set(decision.groupId, {
        key: `relationship-${byKey.size + 1}`, sourceEntityKey: relationship.sourceInventoryId, targetEntityKey: relationship.targetInventoryId,
        relationshipType: label, description: "", confidence: 1, sources: provenance, candidateRelationshipIds: decision.instanceIds,
        normalization: { semanticType: `reconciled:${decision.groupId}`, forwardLabel: label, inverseLabel: label, originalRelationshipTypes: [...new Set(members.map((instance) => instance.relationship.relationship))], descriptions: [] },
      });
    }
  }
  else
  for (const result of chunkResults) for (const relationship of result.relationships) {
    const chunk = chunkById.get(result.chunkId); if (!chunk) throw new Error(`Missing graph chunk ${result.chunkId}`);
    const source = entityById.get(relationship.sourceInventoryId); const target = entityById.get(relationship.targetInventoryId);
    if (!source || !target) throw new Error("Validated graph relationship has an unknown final-inventory endpoint");
    const normalized = normalizeRelationshipFact(source.temporary_id, target.temporary_id, relationship.relationship);
    const key = `${normalized.sourceId}|${normalized.targetId}|${normalized.semanticType}`;
    const existing = byKey.get(key);
    const provenance = relationshipPageExcerpt(chunk, relationship);
    if (existing) { existing.sources = uniqueSources([...existing.sources, provenance]); existing.candidateRelationshipIds.push(`${result.chunkId}:${relationship.semanticKey}`); if (!existing.normalization.originalRelationshipTypes.includes(relationship.relationship)) existing.normalization.originalRelationshipTypes.push(relationship.relationship); continue; }
    const presentation = relationshipPresentation([normalized]);
    byKey.set(key, { key: `relationship-${byKey.size + 1}`, sourceEntityKey: normalized.sourceId, targetEntityKey: normalized.targetId, relationshipType: presentation.relationshipType, description: "", confidence: 1, sources: [provenance], candidateRelationshipIds: [`${result.chunkId}:${relationship.semanticKey}`], normalization: { semanticType: normalized.semanticType, forwardLabel: presentation.forwardLabel, inverseLabel: presentation.inverseLabel, originalRelationshipTypes: [relationship.relationship], descriptions: [] } });
  }
  const relationships = [...byKey.values()];
  const hierarchy = buildLocationHierarchy(inventory.entities.filter((entity) => entity.type === "location").map((entity) => ({ id: entity.temporary_id, name: entity.name })), relationships.map((relationship) => ({ id: relationship.key, sourceId: relationship.sourceEntityKey, targetId: relationship.targetEntityKey, relationshipType: relationship.relationshipType, confidence: relationship.confidence })));
  return { entities: inventory.entities.map((entity) => { const name = normalizeCanonicalDisplayName(entity.name); return { key: entity.temporary_id, name, normalizedName: normalizeName(name), type: entity.type, roles: [], roleSources: {}, aliases: [...(entity.aliases ?? [])], summary: "", sources: [...entity.sources], candidateIds: [...(entity.memberIds ?? [entity.temporary_id])], reconciliationEvidence: [], mergeReason: (entity.memberIds?.length ?? 1) > 1 ? "ai" as const : "deterministic" as const }; }), relationships: relationships.filter((relationship) => !hierarchy.consideredRelationshipIds.has(relationship.key) || hierarchy.selectedRelationshipIds.has(relationship.key)), facts: [], factAggregationDiagnostics: emptyGraph, discardedRelationships: hierarchy.diagnostics.map((item) => ({ id: item.relationshipId, reason: item.reason })), locationHierarchyDiagnostics: hierarchy.diagnostics, candidateToCanonical: new Map(inventory.entities.flatMap((entity) => (entity.memberIds ?? [entity.temporary_id]).map((id) => [id, entity.temporary_id] as const))) };
}

export function graphAggregationCheckpointIdentity(graph: CanonicalGraph, graphResults: GraphChunkResult[], checkpoint: GraphCheckpointContext): AIOperationIdentity {
  return { campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null, providerId: "deterministic", modelId: "graph-core", processingMode: checkpoint.processingMode, stage: "extraction", operationType: "graph_aggregation", operationKey: "final", inputHash: semanticInputHash({ entities: graph.entities.map((entity) => [entity.key, entity.name, entity.type, entity.aliases]), relationships: graph.relationships.map((relationship) => relationship.normalization.semanticType + ":" + relationship.sourceEntityKey + ":" + relationship.targetEntityKey) }), upstreamFingerprint: semanticInputHash(graphResults.map((result) => ({ chunkId: result.chunkId, firstRaw: result.rawFirstPass, first: result.firstPass.map((item) => item.semanticKey), completeness: result.completeness.map((item) => item.semanticKey) }))), behaviorVersion: GRAPH_CORE_BEHAVIOR_VERSION, schemaVersion: GRAPH_CORE_CONTRACT_VERSION };
}
