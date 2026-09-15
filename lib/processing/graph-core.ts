import { graphExtractionOutputSchema, GRAPH_EXTRACTION_BEHAVIOR_VERSION, GRAPH_EXTRACTION_CONTRACT_VERSION, GRAPH_EXTRACTION_SYSTEM_PROMPT, buildGraphExtractionInput, runGraphExtraction, validateGraphExtraction, type GraphExtractionOutput, type ValidatedGraphRelationship } from "@/lib/ai/graph-extraction";
import { GRAPH_COMPLETENESS_BEHAVIOR_VERSION, GRAPH_COMPLETENESS_CONTRACT_VERSION, GRAPH_COMPLETENESS_SYSTEM_PROMPT, buildGraphCompletenessInput, buildGraphCompletenessUnion, runGraphCompletenessSweep, validateGraphCompletenessSweep } from "@/lib/ai/graph-completeness";
import type { AIOperationCheckpointStore, AIOperationIdentity, CheckpointPlanStatus } from "@/lib/ai/operation-checkpoint";
import { GRAPH_CORE_BEHAVIOR_VERSION, GRAPH_CORE_CONTRACT_VERSION, modelInputHash, semanticInputHash } from "@/lib/ai/operation-checkpoint";
import type { ValidatedExtractionInventoryOutput, SourceEvidence } from "@/lib/ai/schemas";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import type { ModelCallUsage } from "@/lib/ai/usage";
import { normalizeName } from "@/lib/graph/normalize";
import type { CanonicalGraph, CanonicalRelationship } from "@/lib/graph/types";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";
import { relationshipPresentation, normalizeRelationshipFact } from "@/lib/relationships/normalize";
import type { PageChunk } from "@/lib/pdf/types";

export interface GraphCheckpointContext { campaignId: string; documentId: string; processingMode: string; store: AIOperationCheckpointStore; finalInventoryFingerprint: string; finalInventoryUpstreamFingerprint: string; }
export interface GraphPlanItem { chunkId: string; operationType: "graph_extraction" | "graph_completeness"; status: CheckpointPlanStatus; reason: string; }
export interface GraphChunkResult { chunkId: string; firstPass: ValidatedGraphRelationship[]; completeness: ValidatedGraphRelationship[]; relationships: ValidatedGraphRelationship[]; firstPassUsage: ModelCallUsage | null; completenessUsage: ModelCallUsage | null; firstPassCheckpointStatus: "REUSE" | "RUN"; completenessCheckpointStatus: "REUSE" | "RUN"; }

const emptyGraph: CanonicalGraph["factAggregationDiagnostics"] = { candidateFactCount: 0, canonicalFactCount: 0, deduplicatedFactCount: 0, factEvidenceCount: 0 };

function checkpointStatus(store: AIOperationCheckpointStore, identity: AIOperationIdentity) {
  return store.inspect ? store.inspect(identity) : store.load(identity).then((item) => item ? { status: "REUSE" as const, reason: "exact validated identity" } : { status: "RUN" as const, reason: "no compatible validated checkpoint" });
}

function firstPassKeys(relationships: ValidatedGraphRelationship[]) { return new Set(relationships.map((relationship) => relationship.semanticKey)); }

export function graphExtractionCheckpointIdentity(chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): AIOperationIdentity {
  const payload = buildGraphExtractionInput(chunk, inventory);
  return { campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null, providerId: provider.providerId, modelId: provider.modelId, processingMode: checkpoint.processingMode, stage: "extraction", operationType: "graph_extraction", operationKey: chunk.id, inputHash: modelInputHash(GRAPH_EXTRACTION_SYSTEM_PROMPT, payload), upstreamFingerprint: semanticInputHash({ chunk: chunk.pages, finalInventory: checkpoint.finalInventoryFingerprint, inventoryUpstream: checkpoint.finalInventoryUpstreamFingerprint }), behaviorVersion: GRAPH_EXTRACTION_BEHAVIOR_VERSION, schemaVersion: GRAPH_EXTRACTION_CONTRACT_VERSION };
}

export function graphCompletenessCheckpointIdentity(chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, firstPass: ValidatedGraphRelationship[], firstIdentity: AIOperationIdentity, provider: StructuredModelProvider, checkpoint: GraphCheckpointContext): AIOperationIdentity {
  const payload = buildGraphCompletenessInput(chunk, inventory, firstPass);
  return { campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null, providerId: provider.providerId, modelId: provider.modelId, processingMode: checkpoint.processingMode, stage: "extraction", operationType: "graph_completeness", operationKey: chunk.id, inputHash: modelInputHash(GRAPH_COMPLETENESS_SYSTEM_PROMPT, payload), upstreamFingerprint: semanticInputHash({ firstIdentity, firstPass: [...firstPassKeys(firstPass)].sort() }), behaviorVersion: GRAPH_COMPLETENESS_BEHAVIOR_VERSION, schemaVersion: GRAPH_COMPLETENESS_CONTRACT_VERSION };
}

type GraphCheckpointOutput = { raw: GraphExtractionOutput };

async function loadFirstPass(identity: AIOperationIdentity, chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, checkpoint: GraphCheckpointContext) {
  const cached = await checkpoint.store.load<GraphCheckpointOutput>(identity);
  if (!cached) return null;
  try { return { relationships: validateGraphExtraction(graphExtractionOutputSchema.parse(cached.output.raw), inventory, chunk).relationships, usage: cached.usage[0] ?? null }; }
  catch (error) { await checkpoint.store.saveFailed(identity, cached.usage, "Stored graph extraction invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount); return null; }
}

async function loadCompleteness(identity: AIOperationIdentity, chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, firstPass: ValidatedGraphRelationship[], checkpoint: GraphCheckpointContext) {
  const cached = await checkpoint.store.load<GraphCheckpointOutput>(identity);
  if (!cached) return null;
  try { return { relationships: validateGraphCompletenessSweep(graphExtractionOutputSchema.parse(cached.output.raw), inventory, chunk, firstPassKeys(firstPass)).novelRelationships, usage: cached.usage[0] ?? null }; }
  catch (error) { await checkpoint.store.saveFailed(identity, cached.usage, "Stored graph completeness invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount); return null; }
}

export async function runGraphChunk(chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, providers: { extraction: StructuredModelProvider; completeness: StructuredModelProvider }, checkpoint: GraphCheckpointContext): Promise<GraphChunkResult> {
  const firstIdentity = graphExtractionCheckpointIdentity(chunk, inventory, providers.extraction, checkpoint);
  let first = await loadFirstPass(firstIdentity, chunk, inventory, checkpoint);
  const firstPassCheckpointStatus: "REUSE" | "RUN" = first ? "REUSE" : "RUN";
  if (!first) {
    const response = await runGraphExtraction(chunk, inventory, providers.extraction);
    const validated = validateGraphExtraction(response.output, inventory, chunk);
    first = { relationships: validated.relationships, usage: response.usage };
    await checkpoint.store.saveValidated({ identity: firstIdentity, output: { raw: response.output }, usage: [response.usage], attemptCount: 1 });
  }
  const completenessIdentity = graphCompletenessCheckpointIdentity(chunk, inventory, first.relationships, firstIdentity, providers.completeness, checkpoint);
  let completeness = await loadCompleteness(completenessIdentity, chunk, inventory, first.relationships, checkpoint);
  const completenessCheckpointStatus: "REUSE" | "RUN" = completeness ? "REUSE" : "RUN";
  if (!completeness) {
    const response = await runGraphCompletenessSweep(chunk, inventory, first.relationships, providers.completeness);
    const validated = validateGraphCompletenessSweep(response.output, inventory, chunk, firstPassKeys(first.relationships));
    completeness = { relationships: validated.novelRelationships, usage: response.usage };
    await checkpoint.store.saveValidated({ identity: completenessIdentity, output: { raw: response.output }, usage: [response.usage], attemptCount: 1 });
  }
  return { chunkId: chunk.id, firstPass: first.relationships, completeness: completeness.relationships, relationships: buildGraphCompletenessUnion(first.relationships, completeness.relationships), firstPassUsage: firstPassCheckpointStatus === "RUN" ? first.usage : null, completenessUsage: completenessCheckpointStatus === "RUN" ? completeness.usage : null, firstPassCheckpointStatus, completenessCheckpointStatus };
}

export async function planGraphChunks(chunks: PageChunk[], inventory: ValidatedExtractionInventoryOutput, providers: { extraction: StructuredModelProvider; completeness: StructuredModelProvider }, checkpoint: GraphCheckpointContext): Promise<GraphPlanItem[]> {
  const plan: GraphPlanItem[] = [];
  for (const chunk of chunks) {
    const firstIdentity = graphExtractionCheckpointIdentity(chunk, inventory, providers.extraction, checkpoint);
    let firstStatus = await checkpointStatus(checkpoint.store, firstIdentity);
    let first: ValidatedGraphRelationship[] | null = null;
    if (firstStatus.status === "REUSE") {
      const loaded = await loadFirstPass(firstIdentity, chunk, inventory, checkpoint);
      if (loaded) first = loaded.relationships; else firstStatus = { status: "INVALIDATED", reason: "stored graph extraction invalid" };
    }
    plan.push({ chunkId: chunk.id, operationType: "graph_extraction", ...firstStatus });
    if (!first) { plan.push({ chunkId: chunk.id, operationType: "graph_completeness", status: "RUN", reason: "dependent graph extraction will run first" }); continue; }
    const identity = graphCompletenessCheckpointIdentity(chunk, inventory, first, firstIdentity, providers.completeness, checkpoint);
    plan.push({ chunkId: chunk.id, operationType: "graph_completeness", ...(await checkpointStatus(checkpoint.store, identity)) });
  }
  return plan;
}

export async function runGraphChunksLimited(chunks: PageChunk[], inventory: ValidatedExtractionInventoryOutput, providers: { extraction: StructuredModelProvider; completeness: StructuredModelProvider }, checkpoint: GraphCheckpointContext, concurrency: number) {
  const results = new Array<GraphChunkResult>(chunks.length); let cursor = 0;
  async function worker() { while (cursor < chunks.length) { const index = cursor++; results[index] = await runGraphChunk(chunks[index], inventory, providers, checkpoint); } }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), chunks.length) }, () => worker()));
  return results;
}

function uniqueSources(sources: SourceEvidence[]) { const seen = new Set<string>(); return sources.filter((source) => { const key = `${source.page_number}:${source.supporting_text}`; if (seen.has(key)) return false; seen.add(key); return true; }); }

export function buildFinalGraphInventory(inventories: ValidatedExtractionInventoryOutput[]): ValidatedExtractionInventoryOutput {
  const grouped = new Map<string, ValidatedExtractionInventoryOutput["entities"]>();
  for (const entity of inventories.flatMap((inventory) => inventory.entities)) {
    const key = `${entity.type}:${normalizeName(entity.name)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), entity]);
  }
  const entities = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group], index) => ({ temporary_id: `graph_inventory_${index + 1}`, name: [...group].sort((left, right) => left.name.localeCompare(right.name))[0].name, type: group[0].type, sources: [uniqueSources(group.flatMap((entity) => entity.sources)).sort((left, right) => left.page_number - right.page_number || left.supporting_text.localeCompare(right.supporting_text))[0]] as [SourceEvidence] }));
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

export function buildLeanGraphCore(inventory: ValidatedExtractionInventoryOutput, chunks: PageChunk[], chunkResults: GraphChunkResult[]): CanonicalGraph {
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const entityById = new Map(inventory.entities.map((entity) => [entity.temporary_id, entity]));
  const byKey = new Map<string, CanonicalRelationship>();
  for (const result of chunkResults) for (const relationship of result.relationships) {
    const chunk = chunkById.get(result.chunkId); if (!chunk) throw new Error(`Missing graph chunk ${result.chunkId}`);
    const source = entityById.get(relationship.sourceInventoryId); const target = entityById.get(relationship.targetInventoryId);
    if (!source || !target) throw new Error("Validated graph relationship has an unknown final-inventory endpoint");
    const normalized = normalizeRelationshipFact(source.temporary_id, target.temporary_id, relationship.relationship);
    const existing = byKey.get(relationship.semanticKey);
    const provenance = relationshipPageExcerpt(chunk, relationship);
    if (existing) { existing.sources = uniqueSources([...existing.sources, provenance]); existing.candidateRelationshipIds.push(`${result.chunkId}:${relationship.semanticKey}`); if (!existing.normalization.originalRelationshipTypes.includes(relationship.relationship)) existing.normalization.originalRelationshipTypes.push(relationship.relationship); continue; }
    const presentation = relationshipPresentation([normalized]);
    byKey.set(relationship.semanticKey, { key: `relationship-${byKey.size + 1}`, sourceEntityKey: normalized.sourceId, targetEntityKey: normalized.targetId, relationshipType: presentation.relationshipType, description: "", confidence: 1, sources: [provenance], candidateRelationshipIds: [`${result.chunkId}:${relationship.semanticKey}`], normalization: { semanticType: normalized.semanticType, forwardLabel: presentation.forwardLabel, inverseLabel: presentation.inverseLabel, originalRelationshipTypes: [relationship.relationship], descriptions: [] } });
  }
  const relationships = [...byKey.values()];
  const hierarchy = buildLocationHierarchy(inventory.entities.filter((entity) => entity.type === "location").map((entity) => ({ id: entity.temporary_id, name: entity.name })), relationships.map((relationship) => ({ id: relationship.key, sourceId: relationship.sourceEntityKey, targetId: relationship.targetEntityKey, relationshipType: relationship.relationshipType, confidence: relationship.confidence })));
  return { entities: inventory.entities.map((entity) => ({ key: entity.temporary_id, name: entity.name, normalizedName: normalizeName(entity.name), type: entity.type, roles: [], roleSources: {}, aliases: [], summary: "", sources: [...entity.sources], candidateIds: [entity.temporary_id], reconciliationEvidence: [], mergeReason: "deterministic" as const })), relationships: relationships.filter((relationship) => !hierarchy.consideredRelationshipIds.has(relationship.key) || hierarchy.selectedRelationshipIds.has(relationship.key)), facts: [], factAggregationDiagnostics: emptyGraph, discardedRelationships: hierarchy.diagnostics.map((item) => ({ id: item.relationshipId, reason: item.reason })), locationHierarchyDiagnostics: hierarchy.diagnostics, candidateToCanonical: new Map(inventory.entities.map((entity) => [entity.temporary_id, entity.temporary_id])) };
}

export function graphAggregationCheckpointIdentity(graph: CanonicalGraph, graphResults: GraphChunkResult[], checkpoint: GraphCheckpointContext): AIOperationIdentity {
  return { campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null, providerId: "deterministic", modelId: "graph-core", processingMode: checkpoint.processingMode, stage: "extraction", operationType: "graph_aggregation", operationKey: "final", inputHash: semanticInputHash({ entities: graph.entities.map((entity) => [entity.key, entity.name, entity.type]), relationships: graph.relationships.map((relationship) => relationship.normalization.semanticType + ":" + relationship.sourceEntityKey + ":" + relationship.targetEntityKey) }), upstreamFingerprint: semanticInputHash(graphResults.map((result) => ({ chunkId: result.chunkId, first: result.firstPass.map((item) => item.semanticKey), completeness: result.completeness.map((item) => item.semanticKey) }))), behaviorVersion: GRAPH_CORE_BEHAVIOR_VERSION, schemaVersion: GRAPH_CORE_CONTRACT_VERSION };
}
