import { graphExtractionOutputSchema, GRAPH_EXTRACTION_BEHAVIOR_VERSION, GRAPH_EXTRACTION_CONTRACT_VERSION, GRAPH_EXTRACTION_SYSTEM_PROMPT, buildGraphExtractionInput, resolveRawRelationships, runGraphExtraction, type GraphExtractionOutput, type GraphValidationDiagnostic, type ValidatedGraphRelationship } from "@/lib/ai/graph-extraction";
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

export interface GraphCheckpointContext { campaignId: string; documentId: string; processingMode: string; store: AIOperationCheckpointStore; finalInventoryFingerprint: string; finalInventoryUpstreamFingerprint: string; }
export interface GraphPlanItem { chunkId: string; operationType: "graph_extraction" | "graph_completeness"; status: CheckpointPlanStatus; reason: string; }
export interface GraphFirstPassResult { chunkId: string; raw: GraphExtractionOutput; relationships: ValidatedGraphRelationship[]; diagnostics: GraphValidationDiagnostic[]; usage: ModelCallUsage | null; checkpointStatus: "REUSE" | "RUN"; identity: AIOperationIdentity; }
export interface GraphCompletenessResult { chunkId: string; relationships: ValidatedGraphRelationship[]; usage: ModelCallUsage | null; checkpointStatus: "REUSE" | "RUN"; }
export interface GraphChunkResult { chunkId: string; rawFirstPass?: GraphExtractionOutput; firstPass: ValidatedGraphRelationship[]; completeness: ValidatedGraphRelationship[]; relationships: ValidatedGraphRelationship[]; firstPassUsage: ModelCallUsage | null; completenessUsage: ModelCallUsage | null; firstPassCheckpointStatus: "REUSE" | "RUN"; completenessCheckpointStatus: "REUSE" | "RUN"; }

const emptyGraph: CanonicalGraph["factAggregationDiagnostics"] = { candidateFactCount: 0, canonicalFactCount: 0, deduplicatedFactCount: 0, factEvidenceCount: 0 };

function checkpointStatus(store: AIOperationCheckpointStore, identity: AIOperationIdentity) {
  return store.inspect ? store.inspect(identity) : store.load(identity).then((item) => item ? { status: "REUSE" as const, reason: "exact validated identity" } : { status: "RUN" as const, reason: "no compatible validated checkpoint" });
}

function firstPassKeys(relationships: ValidatedGraphRelationship[]) { return new Set(relationships.map((relationship) => relationship.semanticKey)); }

export function graphExtractionCheckpointIdentity(chunk: PageChunk, inventory: GraphInventory, provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): AIOperationIdentity {
  const payload = buildGraphExtractionInput(chunk, inventory);
  return { campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null, providerId: provider.providerId, modelId: provider.modelId, processingMode: checkpoint.processingMode, stage: "extraction", operationType: "graph_extraction", operationKey: chunk.id, inputHash: modelInputHash(GRAPH_EXTRACTION_SYSTEM_PROMPT, payload), upstreamFingerprint: semanticInputHash({ chunk: chunk.pages, finalInventory: checkpoint.finalInventoryFingerprint, inventoryUpstream: checkpoint.finalInventoryUpstreamFingerprint }), behaviorVersion: GRAPH_EXTRACTION_BEHAVIOR_VERSION, schemaVersion: GRAPH_EXTRACTION_CONTRACT_VERSION };
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
    return { raw, relationships: validation.relationships, diagnostics: validation.diagnostics, usage: cached.usage[0] ?? null };
  } catch (error) {
    await checkpoint.store.saveFailed(identity, cached.usage, "Stored graph extraction invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount);
    return null;
  }
}

async function loadCompleteness(identity: AIOperationIdentity, chunk: PageChunk, inventory: GraphInventory, firstPass: ValidatedGraphRelationship[], checkpoint: GraphCheckpointContext) {
  const cached = await checkpoint.store.load<GraphCheckpointOutput>(identity);
  if (!cached) return null;
  try { return { relationships: validateGraphCompletenessSweep(graphExtractionOutputSchema.parse(cached.output.raw), inventory, chunk, firstPassKeys(firstPass)).novelRelationships, usage: cached.usage[0] ?? null }; }
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
    const response = await runGraphExtraction(chunk, inventory, provider);
    const raw = graphExtractionOutputSchema.parse(response.output);
    const validation = resolveRawRelationships(raw, inventory, chunk);
    loaded = { raw, relationships: validation.relationships, diagnostics: validation.diagnostics, usage: response.usage };
    await checkpoint.store.saveValidated({ identity, output: { raw }, usage: [response.usage], attemptCount: 1 });
  }
  return { chunkId: chunk.id, ...loaded, usage: status === "RUN" ? loaded.usage : null, checkpointStatus: status, identity };
}

async function runLimited<T>(items: PageChunk[], concurrency: number, operation: (chunk: PageChunk) => Promise<T>) {
  const results = new Array<T>(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; results[index] = await operation(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
}

export function runGraphFirstPassLimited(chunks: PageChunk[], inventory: GraphInventory, provider: StructuredModelProvider, checkpoint: GraphCheckpointContext, concurrency: number) {
  return runLimited(chunks, concurrency, (chunk) => runGraphFirstPass(chunk, inventory, provider, checkpoint));
}

export function reResolveGraphFirstPass(firstPass: GraphFirstPassResult[], chunks: PageChunk[], inventory: GraphInventory): GraphFirstPassResult[] {
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return firstPass.map((result) => {
    const chunk = chunkById.get(result.chunkId); if (!chunk) throw new Error(`Missing graph chunk ${result.chunkId}`);
    const validation = resolveRawRelationships(result.raw, inventory, chunk);
    return { ...result, relationships: validation.relationships, diagnostics: validation.diagnostics };
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
    loaded = { relationships: validated.novelRelationships, usage: response.usage };
    await checkpoint.store.saveValidated({ identity, output: { raw: response.output }, usage: [response.usage], attemptCount: 1 });
  }
  return { chunkId: chunk.id, relationships: loaded.relationships, usage: status === "RUN" ? loaded.usage : null, checkpointStatus: status };
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
    const second = completenessByChunk.get(first.chunkId); if (!second) throw new Error(`Missing graph completeness for ${first.chunkId}`);
    return { chunkId: first.chunkId, rawFirstPass: first.raw, firstPass: first.relationships, completeness: second.relationships, relationships: buildGraphCompletenessUnion(first.relationships, second.relationships), firstPassUsage: first.usage, completenessUsage: second.usage, firstPassCheckpointStatus: first.checkpointStatus, completenessCheckpointStatus: second.checkpointStatus };
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

/** Exact, bounded page text only; it is an excerpt for provenance, never model-generated evidence. */
export function relationshipPageExcerpt(chunk: PageChunk, relationship: ValidatedGraphRelationship): SourceEvidence {
  const page = chunk.pages.find((item) => item.pageNumber === relationship.page);
  if (!page) throw new Error(`Validated relationship page ${relationship.page} is unavailable`);
  const text = page.text.replace(/\s+/g, " ").trim();
  const lowered = text.toLocaleLowerCase("en-US");
  const anchors = [relationship.sourceName, relationship.targetName].map((name) => lowered.indexOf(name.toLocaleLowerCase("en-US"))).filter((index) => index >= 0);
  const anchor = anchors.length ? Math.min(...anchors) : 0;
  const start = Math.max(0, anchor - 360);
  const excerpt = text.slice(start, start + 1200).trim();
  if (excerpt.length < 8) throw new Error(`Page ${relationship.page} does not contain enough source text for relationship provenance`);
  return { page_number: relationship.page, supporting_text: excerpt };
}

export function buildLeanGraphCore(inventory: GraphInventory, chunks: PageChunk[], chunkResults: GraphChunkResult[]): CanonicalGraph {
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const entityById = new Map(inventory.entities.map((entity) => [entity.temporary_id, entity]));
  const byKey = new Map<string, CanonicalRelationship>();
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
