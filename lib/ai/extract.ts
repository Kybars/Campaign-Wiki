import { buildCompletenessSweepInput, INVENTORY_COMPLETENESS_SYSTEM_PROMPT, validateAndUnionCompleteness } from "@/lib/ai/inventory-completeness";
import { buildInventoryInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { assembleCompactRich, buildCompactRichInput, COMPACT_RICH_FACTS_SYSTEM_PROMPT, COMPACT_RICH_RELATIONSHIPS_SYSTEM_PROMPT, compactRichFactsOutputSchema, compactRichRelationshipsOutputSchema, createDeterministicSourceSpans, SOURCE_SPAN_VERSION, validateCompactRichFacts, validateCompactRichRelationships, type CompactRichFactsOutput, type CompactRichRelationshipsOutput } from "@/lib/ai/rich-kernel";
import { chunkExtractionSchema, extractionInventoryOutputSchema, validatedExtractionInventoryOutputSchema, type ChunkExtraction, type ExtractionInventoryOutput, type ExtractionRichOutput, type ValidatedExtractionInventoryOutput } from "@/lib/ai/schemas";
import { assembleChunkExtraction, validateExtractionInventory, validatedInventoryFingerprint, validateExtractionRich, type ValidationDiagnostic } from "@/lib/ai/source-validation";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { getProcessingEnv } from "@/lib/env";
import type { PageChunk } from "@/lib/pdf/types";
import { EXTRACTION_INVENTORY_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_COMPLETENESS_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_COMPLETENESS_CONTRACT_VERSION, EXTRACTION_INVENTORY_CONTRACT_VERSION, EXTRACTION_INVENTORY_FINAL_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_FINAL_CONTRACT_VERSION, EXTRACTION_RICH_FACTS_BEHAVIOR_VERSION, EXTRACTION_RICH_FACTS_CONTRACT_VERSION, EXTRACTION_RICH_RELATIONSHIPS_BEHAVIOR_VERSION, EXTRACTION_RICH_RELATIONSHIPS_CONTRACT_VERSION, modelInputHash, semanticInputHash, type AIOperationCheckpointStore, type AIOperationIdentity, type CheckpointPlanStatus } from "@/lib/ai/operation-checkpoint";

export interface ExtractionProviders {
  inventory: StructuredModelProvider;
  completeness?: StructuredModelProvider;
  rich?: StructuredModelProvider;
  facts?: StructuredModelProvider;
  relationships?: StructuredModelProvider;
}

interface NormalizedExtractionProviders {
  inventory: StructuredModelProvider;
  completeness: StructuredModelProvider;
  facts: StructuredModelProvider;
  relationships: StructuredModelProvider;
}

export interface ExtractedChunk {
  chunkId: string;
  rawInitialInventory: ExtractionInventoryOutput;
  rawCompletenessInventory: ExtractionInventoryOutput;
  rawInventory: ExtractionInventoryOutput;
  initialInventory: ValidatedExtractionInventoryOutput;
  inventory: ValidatedExtractionInventoryOutput;
  rawFacts: CompactRichFactsOutput;
  rawRelationships: CompactRichRelationshipsOutput;
  rawRichExtraction: ExtractionRichOutput;
  richExtraction: ExtractionRichOutput;
  rawExtraction: ChunkExtraction;
  extraction: ChunkExtraction;
  inventoryDiagnostics: ValidationDiagnostic[];
  completenessDiagnostics: ValidationDiagnostic[];
  richDiagnostics: ValidationDiagnostic[];
  diagnostics: ValidationDiagnostic[];
  initialInventoryUsage: ModelCallUsage;
  completenessUsage: ModelCallUsage;
  factsUsage: ModelCallUsage;
  relationshipsUsage: ModelCallUsage;
  inventoryUsage: ModelCallUsage;
  richUsage: ModelCallUsage;
  usage: ModelCallUsage;
  inventoryCheckpointStatus: "REUSE" | "RUN";
  completenessCheckpointStatus: "REUSE" | "RUN";
  factsCheckpointStatus: "REUSE" | "RUN";
  relationshipsCheckpointStatus: "REUSE" | "RUN";
  richCheckpointStatus: "REUSE" | "RUN";
  checkpointStatus: "REUSE" | "RUN";
}

export interface ExtractionCheckpointContext {
  campaignId: string;
  documentId: string;
  processingMode: string;
  store: AIOperationCheckpointStore;
}

/** The active lean graph path deliberately stops after Pass A's final inventory. */
export interface InventoryExtractedChunk {
  chunkId: string;
  rawInitialInventory: ExtractionInventoryOutput;
  rawCompletenessInventory: ExtractionInventoryOutput;
  initialInventory: ValidatedExtractionInventoryOutput;
  inventory: ValidatedExtractionInventoryOutput;
  inventoryDiagnostics: ValidationDiagnostic[];
  completenessDiagnostics: ValidationDiagnostic[];
  initialInventoryUsage: ModelCallUsage;
  completenessUsage: ModelCallUsage;
  inventoryUsage: ModelCallUsage;
  inventoryCheckpointStatus: "REUSE" | "RUN";
  completenessCheckpointStatus: "REUSE" | "RUN";
}

const emptyUsage = (model: string): ModelCallUsage => ({ model, responseId: null, inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null });
const sumKnown = (left: number | null, right: number | null) => left == null || right == null ? null : left + right;

function combinedUsage(left: ModelCallUsage, right: ModelCallUsage): ModelCallUsage {
  return {
    model: left.model === right.model ? right.model : left.model + " + " + right.model,
    responseId: null,
    inputTokens: sumKnown(left.inputTokens, right.inputTokens),
    cachedInputTokens: sumKnown(left.cachedInputTokens, right.cachedInputTokens),
    cacheWriteTokens: sumKnown(left.cacheWriteTokens, right.cacheWriteTokens),
    outputTokens: sumKnown(left.outputTokens, right.outputTokens),
    totalTokens: sumKnown(left.totalTokens, right.totalTokens),
    estimatedCostUsd: sumKnown(left.estimatedCostUsd, right.estimatedCostUsd),
  };
}

function normalizeProviders(provider: StructuredModelProvider | ExtractionProviders): NormalizedExtractionProviders {
  if (!("inventory" in provider)) return { inventory: provider, completeness: provider, facts: provider, relationships: provider };
  const facts = provider.facts ?? provider.rich;
  const relationships = provider.relationships ?? provider.rich;
  if (!facts || !relationships) throw new Error("Extraction providers require facts and relationships providers (or a shared rich provider)");
  return { inventory: provider.inventory, completeness: provider.completeness ?? provider.inventory, facts, relationships };
}

function normalizeInventoryProviders(provider: StructuredModelProvider | Pick<ExtractionProviders, "inventory" | "completeness">): Pick<NormalizedExtractionProviders, "inventory" | "completeness"> {
  return "inventory" in provider
    ? { inventory: provider.inventory, completeness: provider.completeness ?? provider.inventory }
    : { inventory: provider, completeness: provider };
}

async function resolveProviders(provider?: StructuredModelProvider | ExtractionProviders): Promise<NormalizedExtractionProviders> {
  if (provider) return normalizeProviders(provider);
  const runtime = await import("@/lib/ai/structured-model-provider-runtime");
  const inventory = runtime.getStructuredModelProvider("extraction_inventory");
  const rich = runtime.getStructuredModelProvider("extraction_rich");
  return { inventory, completeness: inventory, facts: rich, relationships: rich };
}

async function resolveInventoryProviders(provider?: StructuredModelProvider | Pick<ExtractionProviders, "inventory" | "completeness">): Promise<Pick<NormalizedExtractionProviders, "inventory" | "completeness">> {
  if (provider) return normalizeInventoryProviders(provider);
  const runtime = await import("@/lib/ai/structured-model-provider-runtime");
  const inventory = runtime.getStructuredModelProvider("extraction_inventory");
  return { inventory, completeness: inventory };
}

export function inventoryCheckpointIdentity(chunk: PageChunk, provider: StructuredModelProvider, checkpoint: ExtractionCheckpointContext): AIOperationIdentity {
  const payload = buildInventoryInput(chunk);
  return {
    campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null,
    providerId: provider.providerId, modelId: provider.modelId, processingMode: "core", stage: "extraction",
    operationType: "inventory", operationKey: chunk.id, inputHash: modelInputHash(EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload),
    upstreamFingerprint: semanticInputHash(chunk.pages), behaviorVersion: EXTRACTION_INVENTORY_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_INVENTORY_CONTRACT_VERSION,
  };
}

export function inventoryDependencyFingerprint(inventory: ValidatedExtractionInventoryOutput, identity: AIOperationIdentity): string {
  return semanticInputHash({ inventory, inventoryIdentity: identity });
}

export function completenessCheckpointIdentity(chunk: PageChunk, initial: ValidatedExtractionInventoryOutput, initialIdentity: AIOperationIdentity, provider: StructuredModelProvider, checkpoint: ExtractionCheckpointContext): AIOperationIdentity {
  return {
    campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null,
    providerId: provider.providerId, modelId: provider.modelId, processingMode: "core", stage: "extraction",
    operationType: "inventory_completeness", operationKey: chunk.id,
    inputHash: modelInputHash(INVENTORY_COMPLETENESS_SYSTEM_PROMPT, buildCompletenessSweepInput(chunk, initial)),
    upstreamFingerprint: inventoryDependencyFingerprint(initial, initialIdentity),
    behaviorVersion: EXTRACTION_INVENTORY_COMPLETENESS_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_INVENTORY_COMPLETENESS_CONTRACT_VERSION,
  };
}

export function finalInventoryIdentity(chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, initialIdentity: AIOperationIdentity, completenessIdentity: AIOperationIdentity): AIOperationIdentity {
  return {
    campaignId: initialIdentity.campaignId, documentId: initialIdentity.documentId, sourceExtractionCacheId: null,
    providerId: completenessIdentity.providerId, modelId: completenessIdentity.modelId, processingMode: "core", stage: "extraction",
    operationType: "inventory_final", operationKey: chunk.id,
    inputHash: semanticInputHash({ inventoryFingerprint: validatedInventoryFingerprint(inventory), initialIdentity, completenessIdentity }),
    upstreamFingerprint: semanticInputHash({ initialIdentity, completenessIdentity }),
    behaviorVersion: EXTRACTION_INVENTORY_FINAL_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_INVENTORY_FINAL_CONTRACT_VERSION,
  };
}

function richUpstreamFingerprint(chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, finalIdentity: AIOperationIdentity): string {
  return semanticInputHash({ finalInventory: inventoryDependencyFingerprint(inventory, finalIdentity), sourceSpanVersion: SOURCE_SPAN_VERSION, spans: createDeterministicSourceSpans(chunk) });
}

export function richFactsCheckpointIdentity(chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, finalIdentity: AIOperationIdentity, provider: StructuredModelProvider, checkpoint: ExtractionCheckpointContext): AIOperationIdentity {
  const payload = buildCompactRichInput(inventory, createDeterministicSourceSpans(chunk));
  return {
    campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null,
    providerId: provider.providerId, modelId: provider.modelId, processingMode: "core", stage: "extraction",
    operationType: "rich_facts", operationKey: chunk.id, inputHash: modelInputHash(COMPACT_RICH_FACTS_SYSTEM_PROMPT, payload),
    upstreamFingerprint: richUpstreamFingerprint(chunk, inventory, finalIdentity),
    behaviorVersion: EXTRACTION_RICH_FACTS_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_RICH_FACTS_CONTRACT_VERSION,
  };
}

export function richRelationshipsCheckpointIdentity(chunk: PageChunk, inventory: ValidatedExtractionInventoryOutput, finalIdentity: AIOperationIdentity, provider: StructuredModelProvider, checkpoint: ExtractionCheckpointContext): AIOperationIdentity {
  const payload = buildCompactRichInput(inventory, createDeterministicSourceSpans(chunk));
  return {
    campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null,
    providerId: provider.providerId, modelId: provider.modelId, processingMode: "core", stage: "extraction",
    operationType: "rich_relationships", operationKey: chunk.id, inputHash: modelInputHash(COMPACT_RICH_RELATIONSHIPS_SYSTEM_PROMPT, payload),
    upstreamFingerprint: richUpstreamFingerprint(chunk, inventory, finalIdentity),
    behaviorVersion: EXTRACTION_RICH_RELATIONSHIPS_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_RICH_RELATIONSHIPS_CONTRACT_VERSION,
  };
}

function uncheckpointedIdentity(chunk: PageChunk, provider: StructuredModelProvider, operationType: string, behaviorVersion: string, schemaVersion: number): AIOperationIdentity {
  return { campaignId: "uncheckpointed", documentId: "uncheckpointed", sourceExtractionCacheId: null, providerId: provider.providerId, modelId: provider.modelId, processingMode: "core", stage: "extraction", operationType, operationKey: chunk.id, inputHash: semanticInputHash({ operationType, chunk }), upstreamFingerprint: semanticInputHash(chunk.pages), behaviorVersion, schemaVersion };
}

function rawFinalInventory(inventory: ValidatedExtractionInventoryOutput): ExtractionInventoryOutput {
  return { entities: inventory.entities.map((entity) => ({ name: entity.name, type: entity.type, page: entity.sources[0].page_number })) };
}

type InitialCheckpointOutput = { rawInventory: ExtractionInventoryOutput; inventory: ValidatedExtractionInventoryOutput };
type CompletenessCheckpointOutput = { rawCompletenessInventory: ExtractionInventoryOutput; inventory: ValidatedExtractionInventoryOutput };
type FactsCheckpointOutput = { rawFacts: CompactRichFactsOutput };
type RelationshipsCheckpointOutput = { rawRelationships: CompactRichRelationshipsOutput };

function validInitial(cached: InitialCheckpointOutput, chunk: PageChunk) {
  const raw = extractionInventoryOutputSchema.parse(cached.rawInventory);
  const validated = validateExtractionInventory(raw, chunk);
  const stored = validatedExtractionInventoryOutputSchema.parse(cached.inventory);
  if (validatedInventoryFingerprint(validated.inventory) !== validatedInventoryFingerprint(stored)) throw new Error("stored initial inventory does not match compact model output");
  return { raw, ...validated };
}

function validCompleteness(cached: CompletenessCheckpointOutput, initial: ValidatedExtractionInventoryOutput, chunk: PageChunk) {
  const raw = extractionInventoryOutputSchema.parse(cached.rawCompletenessInventory);
  const union = validateAndUnionCompleteness(initial, raw, chunk);
  const stored = validatedExtractionInventoryOutputSchema.parse(cached.inventory);
  if (validatedInventoryFingerprint(union.finalInventory) !== validatedInventoryFingerprint(stored)) throw new Error("stored completeness inventory does not match deterministic union");
  return { raw, ...union };
}

export async function extractChunk(chunk: PageChunk, provider?: StructuredModelProvider | ExtractionProviders, checkpoint?: ExtractionCheckpointContext): Promise<ExtractedChunk> {
  const providers = await resolveProviders(provider);
  const initialIdentity = checkpoint ? inventoryCheckpointIdentity(chunk, providers.inventory, checkpoint) : undefined;
  let rawInitialInventory: ExtractionInventoryOutput | undefined; let initialInventory: ValidatedExtractionInventoryOutput | undefined;
  let initialDiagnostics: ValidationDiagnostic[] = []; let initialUsage = emptyUsage(providers.inventory.modelId); let inventoryCheckpointStatus: "REUSE" | "RUN" = "RUN";
  if (initialIdentity) {
    const cached = await checkpoint!.store.load<InitialCheckpointOutput>(initialIdentity);
    if (cached) try {
      const valid = validInitial(cached.output, chunk); rawInitialInventory = valid.raw; initialInventory = valid.inventory; initialDiagnostics = valid.diagnostics;
      initialUsage = cached.usage[0] ?? initialUsage; inventoryCheckpointStatus = "REUSE";
    } catch (error) { await checkpoint!.store.saveFailed(initialIdentity, cached.usage, "Stored initial inventory invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount); }
  }
  if (!initialInventory) {
    const response = await providers.inventory.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: buildInventoryInput(chunk), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
    rawInitialInventory = response.output; const valid = validateExtractionInventory(response.output, chunk); initialInventory = valid.inventory; initialDiagnostics = valid.diagnostics; initialUsage = response.usage;
    if (initialIdentity) await checkpoint!.store.saveValidated({ identity: initialIdentity, output: { rawInventory: rawInitialInventory, inventory: initialInventory }, usage: [response.usage], attemptCount: 1 });
  }

  const dependencyInitial = initialIdentity ?? uncheckpointedIdentity(chunk, providers.inventory, "inventory", EXTRACTION_INVENTORY_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_CONTRACT_VERSION);
  const completenessIdentity = checkpoint ? completenessCheckpointIdentity(chunk, initialInventory, dependencyInitial, providers.completeness, checkpoint) : undefined;
  let rawCompletenessInventory: ExtractionInventoryOutput | undefined; let inventory: ValidatedExtractionInventoryOutput | undefined;
  let completenessDiagnostics: ValidationDiagnostic[] = []; let completenessUsage = emptyUsage(providers.completeness.modelId); let completenessCheckpointStatus: "REUSE" | "RUN" = "RUN";
  if (completenessIdentity) {
    const cached = await checkpoint!.store.load<CompletenessCheckpointOutput>(completenessIdentity);
    if (cached) try {
      const valid = validCompleteness(cached.output, initialInventory, chunk); rawCompletenessInventory = valid.raw; inventory = valid.finalInventory; completenessDiagnostics = valid.diagnostics;
      completenessUsage = cached.usage[0] ?? completenessUsage; completenessCheckpointStatus = "REUSE";
    } catch (error) { await checkpoint!.store.saveFailed(completenessIdentity, cached.usage, "Stored completeness invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount); }
  }
  if (!inventory) {
    const response = await providers.completeness.parseStructured({ system: INVENTORY_COMPLETENESS_SYSTEM_PROMPT, payload: buildCompletenessSweepInput(chunk, initialInventory), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_completeness_output" });
    rawCompletenessInventory = response.output; const valid = validateAndUnionCompleteness(initialInventory, response.output, chunk); inventory = valid.finalInventory; completenessDiagnostics = valid.diagnostics; completenessUsage = response.usage;
    if (completenessIdentity) await checkpoint!.store.saveValidated({ identity: completenessIdentity, output: { rawCompletenessInventory, inventory }, usage: [response.usage], attemptCount: 1 });
  }

  const dependencyCompleteness = completenessIdentity ?? uncheckpointedIdentity(chunk, providers.completeness, "inventory_completeness", EXTRACTION_INVENTORY_COMPLETENESS_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_COMPLETENESS_CONTRACT_VERSION);
  const finalIdentity = finalInventoryIdentity(chunk, inventory, dependencyInitial, dependencyCompleteness);
  const spans = createDeterministicSourceSpans(chunk); const richPayload = buildCompactRichInput(inventory, spans);

  const factsIdentity = checkpoint ? richFactsCheckpointIdentity(chunk, inventory, finalIdentity, providers.facts, checkpoint) : undefined;
  let rawFacts: CompactRichFactsOutput | undefined; let factsValidation: ReturnType<typeof validateCompactRichFacts> | undefined;
  let factsUsage = emptyUsage(providers.facts.modelId); let factsCheckpointStatus: "REUSE" | "RUN" = "RUN";
  if (factsIdentity) {
    const cached = await checkpoint!.store.load<FactsCheckpointOutput>(factsIdentity);
    if (cached) try {
      rawFacts = compactRichFactsOutputSchema.parse(cached.output.rawFacts); factsValidation = validateCompactRichFacts(rawFacts, inventory, spans);
      factsUsage = cached.usage[0] ?? factsUsage; factsCheckpointStatus = "REUSE";
    } catch (error) { await checkpoint!.store.saveFailed(factsIdentity, cached.usage, "Stored rich facts invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount); }
  }
  if (!factsValidation) {
    const response = await providers.facts.parseStructured({ system: COMPACT_RICH_FACTS_SYSTEM_PROMPT, payload: richPayload, schema: compactRichFactsOutputSchema, schemaName: "compact_rich_facts_output" });
    rawFacts = response.output; factsValidation = validateCompactRichFacts(rawFacts, inventory, spans); factsUsage = response.usage;
    if (factsIdentity) await checkpoint!.store.saveValidated({ identity: factsIdentity, output: { rawFacts }, usage: [response.usage], attemptCount: 1 });
  }

  const relationshipsIdentity = checkpoint ? richRelationshipsCheckpointIdentity(chunk, inventory, finalIdentity, providers.relationships, checkpoint) : undefined;
  let rawRelationships: CompactRichRelationshipsOutput | undefined; let relationshipsValidation: ReturnType<typeof validateCompactRichRelationships> | undefined;
  let relationshipsUsage = emptyUsage(providers.relationships.modelId); let relationshipsCheckpointStatus: "REUSE" | "RUN" = "RUN";
  if (relationshipsIdentity) {
    const cached = await checkpoint!.store.load<RelationshipsCheckpointOutput>(relationshipsIdentity);
    if (cached) try {
      rawRelationships = compactRichRelationshipsOutputSchema.parse(cached.output.rawRelationships); relationshipsValidation = validateCompactRichRelationships(rawRelationships, inventory, spans);
      relationshipsUsage = cached.usage[0] ?? relationshipsUsage; relationshipsCheckpointStatus = "REUSE";
    } catch (error) { await checkpoint!.store.saveFailed(relationshipsIdentity, cached.usage, "Stored rich relationships invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount); }
  }
  if (!relationshipsValidation) {
    const response = await providers.relationships.parseStructured({ system: COMPACT_RICH_RELATIONSHIPS_SYSTEM_PROMPT, payload: richPayload, schema: compactRichRelationshipsOutputSchema, schemaName: "compact_rich_relationships_output" });
    rawRelationships = response.output; relationshipsValidation = validateCompactRichRelationships(rawRelationships, inventory, spans); relationshipsUsage = response.usage;
    if (relationshipsIdentity) await checkpoint!.store.saveValidated({ identity: relationshipsIdentity, output: { rawRelationships }, usage: [response.usage], attemptCount: 1 });
  }

  const rawRichExtraction = assembleCompactRich(inventory, factsValidation, relationshipsValidation);
  const validatedRich = validateExtractionRich(rawRichExtraction, inventory, chunk.pages);
  const richExtraction = validatedRich.rich;
  const extraction = chunkExtractionSchema.parse(assembleChunkExtraction(inventory, richExtraction));
  const inventoryUsage = combinedUsage(initialUsage, completenessUsage); const richUsage = combinedUsage(factsUsage, relationshipsUsage);
  const richDiagnostics = validatedRich.diagnostics;
  const kernelDiagnostics: ValidationDiagnostic[] = [...factsValidation.diagnostics, ...relationshipsValidation.diagnostics].map((item) => ({ kind: item.kind === "relationship" ? "relationship" : item.kind === "fact" ? "fact" : "entity", identifier: item.identifier, reason: item.reason }));
  const richCheckpointStatus = factsCheckpointStatus === "REUSE" && relationshipsCheckpointStatus === "REUSE" ? "REUSE" : "RUN";
  return {
    chunkId: chunk.id, rawInitialInventory: rawInitialInventory!, rawCompletenessInventory: rawCompletenessInventory!, rawInventory: rawFinalInventory(inventory),
    initialInventory, inventory, rawFacts: rawFacts!, rawRelationships: rawRelationships!, rawRichExtraction, richExtraction, rawExtraction: extraction, extraction,
    inventoryDiagnostics: initialDiagnostics, completenessDiagnostics, richDiagnostics: [...kernelDiagnostics, ...richDiagnostics],
    diagnostics: [...initialDiagnostics, ...completenessDiagnostics, ...kernelDiagnostics, ...richDiagnostics],
    initialInventoryUsage: initialUsage, completenessUsage, factsUsage, relationshipsUsage, inventoryUsage, richUsage, usage: combinedUsage(inventoryUsage, richUsage),
    inventoryCheckpointStatus, completenessCheckpointStatus, factsCheckpointStatus, relationshipsCheckpointStatus, richCheckpointStatus,
    checkpointStatus: inventoryCheckpointStatus === "REUSE" && completenessCheckpointStatus === "REUSE" && richCheckpointStatus === "REUSE" ? "REUSE" : "RUN",
  };
}

export async function extractInventoryChunk(chunk: PageChunk, provider?: StructuredModelProvider | Pick<ExtractionProviders, "inventory" | "completeness">, checkpoint?: ExtractionCheckpointContext): Promise<InventoryExtractedChunk> {
  const providers = await resolveInventoryProviders(provider);
  const initialIdentity = checkpoint ? inventoryCheckpointIdentity(chunk, providers.inventory, checkpoint) : undefined;
  let rawInitialInventory: ExtractionInventoryOutput | undefined;
  let initialInventory: ValidatedExtractionInventoryOutput | undefined;
  let inventoryDiagnostics: ValidationDiagnostic[] = [];
  let initialInventoryUsage = emptyUsage(providers.inventory.modelId);
  let inventoryCheckpointStatus: "REUSE" | "RUN" = "RUN";
  if (initialIdentity) {
    const cached = await checkpoint!.store.load<InitialCheckpointOutput>(initialIdentity);
    if (cached) try {
      const valid = validInitial(cached.output, chunk);
      rawInitialInventory = valid.raw; initialInventory = valid.inventory; inventoryDiagnostics = valid.diagnostics;
      initialInventoryUsage = cached.usage[0] ?? initialInventoryUsage; inventoryCheckpointStatus = "REUSE";
    } catch (error) {
      await checkpoint!.store.saveFailed(initialIdentity, cached.usage, "Stored initial inventory invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount);
    }
  }
  if (!initialInventory) {
    const response = await providers.inventory.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: buildInventoryInput(chunk), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" });
    rawInitialInventory = response.output;
    const valid = validateExtractionInventory(response.output, chunk);
    initialInventory = valid.inventory; inventoryDiagnostics = valid.diagnostics; initialInventoryUsage = response.usage;
    if (initialIdentity) await checkpoint!.store.saveValidated({ identity: initialIdentity, output: { rawInventory: rawInitialInventory, inventory: initialInventory }, usage: [response.usage], attemptCount: 1 });
  }

  const dependencyInitial = initialIdentity ?? uncheckpointedIdentity(chunk, providers.inventory, "inventory", EXTRACTION_INVENTORY_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_CONTRACT_VERSION);
  const completenessIdentity = checkpoint ? completenessCheckpointIdentity(chunk, initialInventory, dependencyInitial, providers.completeness, checkpoint) : undefined;
  let rawCompletenessInventory: ExtractionInventoryOutput | undefined;
  let inventory: ValidatedExtractionInventoryOutput | undefined;
  let completenessDiagnostics: ValidationDiagnostic[] = [];
  let completenessUsage = emptyUsage(providers.completeness.modelId);
  let completenessCheckpointStatus: "REUSE" | "RUN" = "RUN";
  if (completenessIdentity) {
    const cached = await checkpoint!.store.load<CompletenessCheckpointOutput>(completenessIdentity);
    if (cached) try {
      const valid = validCompleteness(cached.output, initialInventory, chunk);
      rawCompletenessInventory = valid.raw; inventory = valid.finalInventory; completenessDiagnostics = valid.diagnostics;
      completenessUsage = cached.usage[0] ?? completenessUsage; completenessCheckpointStatus = "REUSE";
    } catch (error) {
      await checkpoint!.store.saveFailed(completenessIdentity, cached.usage, "Stored completeness invalid: " + (error instanceof Error ? error.message : "unknown"), cached.attemptCount);
    }
  }
  if (!inventory) {
    const response = await providers.completeness.parseStructured({ system: INVENTORY_COMPLETENESS_SYSTEM_PROMPT, payload: buildCompletenessSweepInput(chunk, initialInventory), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_completeness_output" });
    rawCompletenessInventory = response.output;
    const valid = validateAndUnionCompleteness(initialInventory, response.output, chunk);
    inventory = valid.finalInventory; completenessDiagnostics = valid.diagnostics; completenessUsage = response.usage;
    if (completenessIdentity) await checkpoint!.store.saveValidated({ identity: completenessIdentity, output: { rawCompletenessInventory, inventory }, usage: [response.usage], attemptCount: 1 });
  }
  return { chunkId: chunk.id, rawInitialInventory: rawInitialInventory!, rawCompletenessInventory: rawCompletenessInventory!, initialInventory, inventory, inventoryDiagnostics, completenessDiagnostics, initialInventoryUsage, completenessUsage, inventoryUsage: combinedUsage(initialInventoryUsage, completenessUsage), inventoryCheckpointStatus, completenessCheckpointStatus };
}

export interface ExtractionPlanItem { chunkId: string; operationType: "inventory" | "inventory_completeness" | "rich_facts" | "rich_relationships"; status: CheckpointPlanStatus; reason: string }

async function checkpointStatus(store: AIOperationCheckpointStore, identity: AIOperationIdentity) {
  return store.inspect ? store.inspect(identity) : store.load(identity).then((item) => item ? { status: "REUSE" as const, reason: "exact validated identity" } : { status: "RUN" as const, reason: "no compatible validated checkpoint" });
}

export async function planTwoPassExtraction(chunks: PageChunk[], provider: StructuredModelProvider | ExtractionProviders, checkpoint: ExtractionCheckpointContext): Promise<ExtractionPlanItem[]> {
  const providers = normalizeProviders(provider); const plan: ExtractionPlanItem[] = [];
  for (const chunk of chunks) {
    const initialIdentity = inventoryCheckpointIdentity(chunk, providers.inventory, checkpoint); let initialStatus = await checkpointStatus(checkpoint.store, initialIdentity); let initial: ValidatedExtractionInventoryOutput | undefined;
    if (initialStatus.status === "REUSE") try { const cached = await checkpoint.store.load<InitialCheckpointOutput>(initialIdentity); if (!cached) throw new Error("initial disappeared"); initial = validInitial(cached.output, chunk).inventory; } catch (error) { initialStatus = { status: "INVALIDATED", reason: "stored initial invalid: " + (error instanceof Error ? error.message : "unknown") }; }
    plan.push({ chunkId: chunk.id, operationType: "inventory", ...initialStatus });
    if (!initial) {
      plan.push({ chunkId: chunk.id, operationType: "inventory_completeness", status: "RUN", reason: "dependent initial inventory will run first" }, { chunkId: chunk.id, operationType: "rich_facts", status: "RUN", reason: "dependent final inventory will run first" }, { chunkId: chunk.id, operationType: "rich_relationships", status: "RUN", reason: "dependent final inventory will run first" }); continue;
    }
    const completenessIdentity = completenessCheckpointIdentity(chunk, initial, initialIdentity, providers.completeness, checkpoint); let completenessStatus = await checkpointStatus(checkpoint.store, completenessIdentity); let final: ValidatedExtractionInventoryOutput | undefined;
    if (completenessStatus.status === "REUSE") try { const cached = await checkpoint.store.load<CompletenessCheckpointOutput>(completenessIdentity); if (!cached) throw new Error("completeness disappeared"); final = validCompleteness(cached.output, initial, chunk).finalInventory; } catch (error) { completenessStatus = { status: "INVALIDATED", reason: "stored completeness invalid: " + (error instanceof Error ? error.message : "unknown") }; }
    plan.push({ chunkId: chunk.id, operationType: "inventory_completeness", ...completenessStatus });
    if (!final) {
      plan.push({ chunkId: chunk.id, operationType: "rich_facts", status: "RUN", reason: "dependent final inventory will run first" }, { chunkId: chunk.id, operationType: "rich_relationships", status: "RUN", reason: "dependent final inventory will run first" }); continue;
    }
    const finalIdentity = finalInventoryIdentity(chunk, final, initialIdentity, completenessIdentity);
    plan.push({ chunkId: chunk.id, operationType: "rich_facts", ...(await checkpointStatus(checkpoint.store, richFactsCheckpointIdentity(chunk, final, finalIdentity, providers.facts, checkpoint))) });
    plan.push({ chunkId: chunk.id, operationType: "rich_relationships", ...(await checkpointStatus(checkpoint.store, richRelationshipsCheckpointIdentity(chunk, final, finalIdentity, providers.relationships, checkpoint))) });
  }
  return plan;
}

export async function planInventoryExtraction(chunks: PageChunk[], provider: StructuredModelProvider | Pick<ExtractionProviders, "inventory" | "completeness">, checkpoint: ExtractionCheckpointContext): Promise<ExtractionPlanItem[]> {
  const providers = normalizeInventoryProviders(provider);
  const plan: ExtractionPlanItem[] = [];
  for (const chunk of chunks) {
    const initialIdentity = inventoryCheckpointIdentity(chunk, providers.inventory, checkpoint);
    let initialStatus = await checkpointStatus(checkpoint.store, initialIdentity);
    let initial: ValidatedExtractionInventoryOutput | undefined;
    if (initialStatus.status === "REUSE") try {
      const cached = await checkpoint.store.load<InitialCheckpointOutput>(initialIdentity);
      if (!cached) throw new Error("initial disappeared");
      initial = validInitial(cached.output, chunk).inventory;
    } catch (error) { initialStatus = { status: "INVALIDATED", reason: "stored initial invalid: " + (error instanceof Error ? error.message : "unknown") }; }
    plan.push({ chunkId: chunk.id, operationType: "inventory", ...initialStatus });
    if (!initial) { plan.push({ chunkId: chunk.id, operationType: "inventory_completeness", status: "RUN", reason: "dependent initial inventory will run first" }); continue; }
    const completeIdentity = completenessCheckpointIdentity(chunk, initial, initialIdentity, providers.completeness, checkpoint);
    plan.push({ chunkId: chunk.id, operationType: "inventory_completeness", ...(await checkpointStatus(checkpoint.store, completeIdentity)) });
  }
  return plan;
}

export async function extractInventoryChunksLimited(chunks: PageChunk[], concurrency?: number, provider?: StructuredModelProvider | Pick<ExtractionProviders, "inventory" | "completeness">, checkpoint?: ExtractionCheckpointContext) {
  const providers = await resolveInventoryProviders(provider);
  const configuredConcurrency = concurrency ?? (providers.inventory.providerId === "local" ? getProcessingEnv().LOCAL_AI_EXTRACTION_CONCURRENCY : getProcessingEnv().AI_EXTRACTION_CONCURRENCY);
  const results = new Array<InventoryExtractedChunk>(chunks.length); let cursor = 0;
  async function worker() { while (cursor < chunks.length) { const index = cursor++; results[index] = await extractInventoryChunk(chunks[index], { inventory: providers.inventory, completeness: providers.completeness }, checkpoint); } }
  await Promise.all(Array.from({ length: Math.min(configuredConcurrency, chunks.length) }, () => worker()));
  return results;
}

export async function extractChunksLimited(chunks: PageChunk[], concurrency?: number, onExtracted?: (result: ExtractedChunk, chunk: PageChunk, index: number) => Promise<void>, provider?: StructuredModelProvider | ExtractionProviders, checkpoint?: ExtractionCheckpointContext) {
  const providers = await resolveProviders(provider);
  const configuredConcurrency = concurrency ?? (providers.inventory.providerId === "local" ? getProcessingEnv().LOCAL_AI_EXTRACTION_CONCURRENCY : getProcessingEnv().AI_EXTRACTION_CONCURRENCY);
  const results = new Array<ExtractedChunk>(chunks.length); let cursor = 0;
  async function worker() { while (cursor < chunks.length) { const index = cursor++; const result = await extractChunk(chunks[index], { ...providers, rich: providers.facts }, checkpoint); if (onExtracted) await onExtracted(result, chunks[index], index); results[index] = result; } }
  await Promise.all(Array.from({ length: Math.min(configuredConcurrency, chunks.length) }, () => worker()));
  return results;
}
