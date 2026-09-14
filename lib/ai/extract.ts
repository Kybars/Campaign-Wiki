import { buildInventoryInput, buildRichExtractionInput, EXTRACTION_INVENTORY_SYSTEM_PROMPT, EXTRACTION_RICH_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { chunkExtractionSchema, extractionInventoryOutputSchema, extractionRichOutputSchema, type ChunkExtraction, type ExtractionInventoryOutput, type ExtractionRichOutput } from "@/lib/ai/schemas";
import { assembleChunkExtraction, validateExtractionInventory, validateExtractionRich, type ValidationDiagnostic } from "@/lib/ai/source-validation";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { getProcessingEnv } from "@/lib/env";
import type { PageChunk } from "@/lib/pdf/types";
import { EXTRACTION_INVENTORY_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_CONTRACT_VERSION, EXTRACTION_RICH_BEHAVIOR_VERSION, EXTRACTION_RICH_CONTRACT_VERSION, modelInputHash, semanticInputHash, type AIOperationCheckpointStore, type AIOperationIdentity, type CheckpointPlanStatus } from "@/lib/ai/operation-checkpoint";

export interface ExtractionProviders { inventory: StructuredModelProvider; rich: StructuredModelProvider }

export interface ExtractedChunk {
  chunkId: string;
  rawInventory: ExtractionInventoryOutput;
  inventory: ExtractionInventoryOutput;
  rawRichExtraction: ExtractionRichOutput;
  richExtraction: ExtractionRichOutput;
  rawExtraction: ChunkExtraction;
  extraction: ChunkExtraction;
  inventoryDiagnostics: ValidationDiagnostic[];
  richDiagnostics: ValidationDiagnostic[];
  diagnostics: ValidationDiagnostic[];
  inventoryUsage: ModelCallUsage;
  richUsage: ModelCallUsage;
  usage: ModelCallUsage;
  inventoryCheckpointStatus: "REUSE" | "RUN";
  richCheckpointStatus: "REUSE" | "RUN";
  checkpointStatus: "REUSE" | "RUN";
}

export interface ExtractionCheckpointContext {
  campaignId: string;
  documentId: string;
  processingMode: string;
  store: AIOperationCheckpointStore;
}

const emptyUsage = (model: string): ModelCallUsage => ({ model, responseId: null, inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null });
const sumKnown = (left: number | null, right: number | null) => left == null || right == null ? null : left + right;

function combinedUsage(inventory: ModelCallUsage, rich: ModelCallUsage): ModelCallUsage {
  return {
    model: inventory.model === rich.model ? rich.model : `${inventory.model} + ${rich.model}`,
    responseId: null,
    inputTokens: sumKnown(inventory.inputTokens, rich.inputTokens),
    cachedInputTokens: sumKnown(inventory.cachedInputTokens, rich.cachedInputTokens),
    cacheWriteTokens: sumKnown(inventory.cacheWriteTokens, rich.cacheWriteTokens),
    outputTokens: sumKnown(inventory.outputTokens, rich.outputTokens),
    totalTokens: sumKnown(inventory.totalTokens, rich.totalTokens),
    estimatedCostUsd: sumKnown(inventory.estimatedCostUsd, rich.estimatedCostUsd),
  };
}

function normalizeProviders(provider: StructuredModelProvider | ExtractionProviders): ExtractionProviders {
  return "inventory" in provider ? provider : { inventory: provider, rich: provider };
}

async function resolveProviders(provider?: StructuredModelProvider | ExtractionProviders): Promise<ExtractionProviders> {
  if (provider) return normalizeProviders(provider);
  const runtime = await import("@/lib/ai/structured-model-provider-runtime");
  return { inventory: runtime.getStructuredModelProvider("extraction_inventory"), rich: runtime.getStructuredModelProvider("extraction_rich") };
}

export function inventoryCheckpointIdentity(chunk: PageChunk, provider: StructuredModelProvider, checkpoint: ExtractionCheckpointContext): AIOperationIdentity {
  const payload = buildInventoryInput(chunk);
  return {
    campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null,
    providerId: provider.providerId, modelId: provider.modelId, processingMode: "core",
    stage: "extraction", operationType: "inventory", operationKey: chunk.id,
    inputHash: modelInputHash(EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload), upstreamFingerprint: semanticInputHash(chunk.pages),
    behaviorVersion: EXTRACTION_INVENTORY_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_INVENTORY_CONTRACT_VERSION,
  };
}

export function inventoryDependencyFingerprint(inventory: ExtractionInventoryOutput, identity: AIOperationIdentity): string {
  return semanticInputHash({ inventory, inventoryIdentity: identity });
}

export function richCheckpointIdentity(chunk: PageChunk, inventory: ExtractionInventoryOutput, inventoryIdentity: AIOperationIdentity, provider: StructuredModelProvider, checkpoint: ExtractionCheckpointContext): AIOperationIdentity {
  const payload = buildRichExtractionInput(chunk, inventory);
  return {
    campaignId: checkpoint.campaignId, documentId: checkpoint.documentId, sourceExtractionCacheId: null,
    providerId: provider.providerId, modelId: provider.modelId, processingMode: "core",
    stage: "extraction", operationType: "rich", operationKey: chunk.id,
    inputHash: modelInputHash(EXTRACTION_RICH_SYSTEM_PROMPT, payload), upstreamFingerprint: inventoryDependencyFingerprint(inventory, inventoryIdentity),
    behaviorVersion: EXTRACTION_RICH_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_RICH_CONTRACT_VERSION,
  };
}

function uncheckpointedIdentity(chunk: PageChunk, provider: StructuredModelProvider): AIOperationIdentity {
  return {
    campaignId: "uncheckpointed", documentId: "uncheckpointed", sourceExtractionCacheId: null,
    providerId: provider.providerId, modelId: provider.modelId, processingMode: "core", stage: "extraction",
    operationType: "inventory", operationKey: chunk.id, inputHash: modelInputHash(EXTRACTION_INVENTORY_SYSTEM_PROMPT, buildInventoryInput(chunk)),
    upstreamFingerprint: semanticInputHash(chunk.pages), behaviorVersion: EXTRACTION_INVENTORY_BEHAVIOR_VERSION, schemaVersion: EXTRACTION_INVENTORY_CONTRACT_VERSION,
  };
}

export async function extractChunk(chunk: PageChunk, provider?: StructuredModelProvider | ExtractionProviders, checkpoint?: ExtractionCheckpointContext): Promise<ExtractedChunk> {
  const providers = await resolveProviders(provider);
  const inventoryIdentity = checkpoint ? inventoryCheckpointIdentity(chunk, providers.inventory, checkpoint) : undefined;
  let rawInventory: ExtractionInventoryOutput | undefined;
  let inventory: ExtractionInventoryOutput | undefined;
  let inventoryDiagnostics: ValidationDiagnostic[] = [];
  let inventoryUsage = emptyUsage(providers.inventory.modelId);
  let inventoryCheckpointStatus: "REUSE" | "RUN" = "RUN";
  let forceRichRun = false;

  if (inventoryIdentity) {
    const cached = await checkpoint!.store.load<{ rawInventory: ExtractionInventoryOutput }>(inventoryIdentity);
    if (cached) {
      try {
        rawInventory = extractionInventoryOutputSchema.parse(cached.output.rawInventory);
        const validated = validateExtractionInventory(rawInventory, chunk.pages);
        inventory = validated.inventory;
        inventoryDiagnostics = validated.diagnostics;
        inventoryUsage = cached.usage[0] ?? inventoryUsage;
        inventoryCheckpointStatus = "REUSE";
      } catch (error) {
        forceRichRun = true;
        await checkpoint!.store.saveFailed(inventoryIdentity, cached.usage, `Stored inventory checkpoint invalid: ${error instanceof Error ? error.message : "unknown validation failure"}`, cached.attemptCount);
      }
    }
  }

  if (!inventory) {
    const response = await providers.inventory.parseStructured({ system: EXTRACTION_INVENTORY_SYSTEM_PROMPT, payload: buildInventoryInput(chunk), schema: extractionInventoryOutputSchema, schemaName: "extraction_inventory_output" }).catch(async (error) => {
      if (inventoryIdentity) await checkpoint!.store.saveFailed(inventoryIdentity, [], error instanceof Error ? error.message : "Inventory provider failure", 1);
      throw error;
    });
    rawInventory = response.output;
    try {
      const validated = validateExtractionInventory(response.output, chunk.pages);
      inventory = validated.inventory;
      inventoryDiagnostics = validated.diagnostics;
    } catch (error) {
      if (inventoryIdentity) await checkpoint!.store.saveFailed(inventoryIdentity, [response.usage], error instanceof Error ? error.message : "Invalid inventory output", 1);
      throw error;
    }
    inventoryUsage = response.usage;
    if (inventoryIdentity) await checkpoint!.store.saveValidated({ identity: inventoryIdentity, output: { rawInventory, inventory, diagnostics: inventoryDiagnostics }, usage: [response.usage], attemptCount: 1 });
  }

  const dependencyIdentity = inventoryIdentity ?? uncheckpointedIdentity(chunk, providers.inventory);
  const richIdentity = checkpoint ? richCheckpointIdentity(chunk, inventory, dependencyIdentity, providers.rich, checkpoint) : undefined;
  let rawRichExtraction: ExtractionRichOutput | undefined;
  let richExtraction: ExtractionRichOutput | undefined;
  let richDiagnostics: ValidationDiagnostic[] = [];
  let richUsage = emptyUsage(providers.rich.modelId);
  let richCheckpointStatus: "REUSE" | "RUN" = "RUN";

  if (richIdentity && !forceRichRun) {
    const cached = await checkpoint!.store.load<{ rawRichExtraction: ExtractionRichOutput }>(richIdentity);
    if (cached) {
      try {
        rawRichExtraction = extractionRichOutputSchema.parse(cached.output.rawRichExtraction);
        const validated = validateExtractionRich(rawRichExtraction, inventory, chunk.pages);
        richExtraction = validated.rich;
        richDiagnostics = validated.diagnostics;
        richUsage = cached.usage[0] ?? richUsage;
        richCheckpointStatus = "REUSE";
      } catch (error) {
        await checkpoint!.store.saveFailed(richIdentity, cached.usage, `Stored rich checkpoint invalid: ${error instanceof Error ? error.message : "unknown validation failure"}`, cached.attemptCount);
      }
    }
  }

  if (!richExtraction) {
    const response = await providers.rich.parseStructured({ system: EXTRACTION_RICH_SYSTEM_PROMPT, payload: buildRichExtractionInput(chunk, inventory), schema: extractionRichOutputSchema, schemaName: "extraction_rich_output" }).catch(async (error) => {
      if (richIdentity) await checkpoint!.store.saveFailed(richIdentity, [], error instanceof Error ? error.message : "Rich extraction provider failure", 1);
      throw error;
    });
    rawRichExtraction = response.output;
    try {
      const validated = validateExtractionRich(response.output, inventory, chunk.pages);
      richExtraction = validated.rich;
      richDiagnostics = validated.diagnostics;
    } catch (error) {
      if (richIdentity) await checkpoint!.store.saveFailed(richIdentity, [response.usage], error instanceof Error ? error.message : "Invalid rich extraction output", 1);
      throw error;
    }
    richUsage = response.usage;
    if (richIdentity) await checkpoint!.store.saveValidated({ identity: richIdentity, output: { rawRichExtraction, richExtraction, diagnostics: richDiagnostics }, usage: [response.usage], attemptCount: 1 });
  }

  const extraction = chunkExtractionSchema.parse(assembleChunkExtraction(inventory, richExtraction));
  const diagnostics = [...inventoryDiagnostics, ...richDiagnostics];
  return {
    chunkId: chunk.id, rawInventory: rawInventory!, inventory, rawRichExtraction: rawRichExtraction!, richExtraction,
    rawExtraction: extraction, extraction, inventoryDiagnostics, richDiagnostics, diagnostics,
    inventoryUsage, richUsage, usage: combinedUsage(inventoryUsage, richUsage),
    inventoryCheckpointStatus, richCheckpointStatus,
    checkpointStatus: inventoryCheckpointStatus === "REUSE" && richCheckpointStatus === "REUSE" ? "REUSE" : "RUN",
  };
}

export interface ExtractionPlanItem { chunkId: string; operationType: "inventory" | "rich"; status: CheckpointPlanStatus; reason: string }

export async function planTwoPassExtraction(chunks: PageChunk[], provider: StructuredModelProvider | ExtractionProviders, checkpoint: ExtractionCheckpointContext): Promise<ExtractionPlanItem[]> {
  const providers = normalizeProviders(provider);
  const plan: ExtractionPlanItem[] = [];
  for (const chunk of chunks) {
    const inventoryIdentity = inventoryCheckpointIdentity(chunk, providers.inventory, checkpoint);
    let inventoryStatus = checkpoint.store.inspect ? await checkpoint.store.inspect(inventoryIdentity) : await checkpoint.store.load(inventoryIdentity) ? { status: "REUSE" as const, reason: "exact validated identity" } : { status: "RUN" as const, reason: "no compatible validated checkpoint" };
    let inventory: ExtractionInventoryOutput | undefined;
    if (inventoryStatus.status === "REUSE") {
      try {
        const cached = await checkpoint.store.load<{ rawInventory: ExtractionInventoryOutput }>(inventoryIdentity);
        if (!cached) throw new Error("validated checkpoint disappeared during planning");
        inventory = validateExtractionInventory(extractionInventoryOutputSchema.parse(cached.output.rawInventory), chunk.pages).inventory;
      } catch (error) {
        inventoryStatus = { status: "INVALIDATED", reason: `stored inventory checkpoint invalid: ${error instanceof Error ? error.message : "unknown validation failure"}` };
      }
    }
    plan.push({ chunkId: chunk.id, operationType: "inventory", ...inventoryStatus });
    if (!inventory) {
      plan.push({ chunkId: chunk.id, operationType: "rich", status: inventoryStatus.status === "INVALIDATED" ? "INVALIDATED" : "RUN", reason: "dependent inventory will run before rich extraction" });
      continue;
    }
    const richIdentity = richCheckpointIdentity(chunk, inventory, inventoryIdentity, providers.rich, checkpoint);
    let richStatus = checkpoint.store.inspect ? await checkpoint.store.inspect(richIdentity) : await checkpoint.store.load(richIdentity) ? { status: "REUSE" as const, reason: "exact validated identity" } : { status: "RUN" as const, reason: "no compatible validated checkpoint" };
    if (richStatus.status === "REUSE") {
      try {
        const cached = await checkpoint.store.load<{ rawRichExtraction: ExtractionRichOutput }>(richIdentity);
        if (!cached) throw new Error("validated checkpoint disappeared during planning");
        validateExtractionRich(extractionRichOutputSchema.parse(cached.output.rawRichExtraction), inventory, chunk.pages);
      } catch (error) {
        richStatus = { status: "INVALIDATED", reason: `stored rich checkpoint invalid: ${error instanceof Error ? error.message : "unknown validation failure"}` };
      }
    }
    plan.push({ chunkId: chunk.id, operationType: "rich", ...richStatus });
  }
  return plan;
}

export async function extractChunksLimited(chunks: PageChunk[], concurrency?: number, onExtracted?: (result: ExtractedChunk, chunk: PageChunk, index: number) => Promise<void>, provider?: StructuredModelProvider | ExtractionProviders, checkpoint?: ExtractionCheckpointContext) {
  const providers = await resolveProviders(provider);
  const configuredConcurrency = concurrency ?? (providers.inventory.providerId === "local" ? getProcessingEnv().LOCAL_AI_EXTRACTION_CONCURRENCY : getProcessingEnv().AI_EXTRACTION_CONCURRENCY);
  const results = new Array<ExtractedChunk>(chunks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor++;
      const result = await extractChunk(chunks[index], providers, checkpoint);
      if (onExtracted) await onExtracted(result, chunks[index], index);
      results[index] = result;
    }
  }
  await Promise.all(Array.from({ length: Math.min(configuredConcurrency, chunks.length) }, () => worker()));
  return results;
}
