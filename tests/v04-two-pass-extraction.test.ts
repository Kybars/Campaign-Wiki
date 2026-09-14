import { describe, expect, it, vi } from "vitest";
import { extractChunk, inventoryCheckpointIdentity, planTwoPassExtraction, richCheckpointIdentity, type ExtractionProviders } from "@/lib/ai/extract";
import { assembleChunkExtraction, validateExtractionInventory, validateExtractionRich } from "@/lib/ai/source-validation";
import { memoryCheckpointStore, type ValidatedCheckpoint } from "@/lib/ai/operation-checkpoint";
import type { ExtractionInventoryOutput, ExtractionRichOutput } from "@/lib/ai/schemas";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { aggregateCandidates } from "@/lib/graph/aggregate";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { recallReferenceEntities } from "@/fixtures/recall-regression";

const sentences = [
  "Mira Vale is a hunter of Ashfall.", "Tomas Reed guards the Moon Gate.", "Ashfall is a mountain town.", "The Moon Gate stands inside Ashfall.",
  "The Dawn Compact protects Ashfall.", "The Ember Key opens the Moon Gate.", "Recover the Ember Key is a quest from Mira Vale.",
  "The Moon Gate Siege damaged the Moon Gate.", "Salu is the goddess of life.", "The town charter is called the Ashfall Compact.",
];
const chunk = { id: "dense", pages: [{ pageNumber: 1, text: sentences.join(" ") }], characterCount: sentences.join(" ").length };
const source = (supporting_text: string) => [{ page_number: 1, supporting_text }];
const inventory: ExtractionInventoryOutput = { entities: [
  ["mira", "Mira Vale", "npc", sentences[0]], ["tomas", "Tomas Reed", "npc", sentences[1]], ["ashfall", "Ashfall", "location", sentences[2]],
  ["gate", "Moon Gate", "location", sentences[3]], ["compact", "Dawn Compact", "faction", sentences[4]], ["key", "Ember Key", "item", sentences[5]],
  ["quest", "Recover the Ember Key", "quest", sentences[6]], ["siege", "Moon Gate Siege", "event", sentences[7]], ["salu", "Salu", "deity", sentences[8]],
  ["charter", "Ashfall Compact", "other", sentences[9]],
].map(([temporary_id, name, type, evidence]) => ({ temporary_id, name, type: type as ExtractionInventoryOutput["entities"][number]["type"], aliases: [], sources: source(evidence) })) };
const fieldByType = { npc: "occupation", location: "place_kind", faction: "purpose", item: "item_type", quest: "objective", event: "what_happened", deity: "domain", other: "detail" } as const;
const rich: ExtractionRichOutput = {
  entities: inventory.entities.map((entity) => ({ inventory_id: entity.temporary_id, type: entity.type, roles: [], summary: `${entity.name} is source-backed.`, facts: [{ temporary_id: `${entity.temporary_id}-fact`, field_key: fieldByType[entity.type], content: entity.name, sources: entity.sources }] })),
  relationships: [
    { source_temporary_id: "gate", target_temporary_id: "ashfall", relationship_type: "located_in", description: "The gate is in Ashfall.", confidence: 1, sources: source(sentences[3]) },
    { source_temporary_id: "compact", target_temporary_id: "ashfall", relationship_type: "protects", description: "The compact protects Ashfall.", confidence: 1, sources: source(sentences[4]) },
    { source_temporary_id: "key", target_temporary_id: "gate", relationship_type: "opens", description: "The key opens the gate.", confidence: 1, sources: source(sentences[5]) },
    { source_temporary_id: "quest", target_temporary_id: "mira", relationship_type: "questgiver", description: "Mira gives the quest.", confidence: 1, sources: source(sentences[6]) },
  ],
  suspected_inventory_misses: [],
};
const usage = (model: string) => ({ model, responseId: null, inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2, totalTokens: 12, estimatedCostUsd: null });
const provider = (modelId: string, parseStructured: StructuredModelProvider["parseStructured"]): StructuredModelProvider => ({ providerId: "openai", modelId, parseStructured });
const responder = (inventoryOutput = inventory, richOutput = rich) => vi.fn(async ({ schemaName }: { schemaName: string }) => ({ output: schemaName === "extraction_inventory_output" ? inventoryOutput : richOutput, providerId: "openai" as const, modelId: "model", responseId: null, usage: usage("model") }));
const context = (store = memoryCheckpointStore()) => ({ campaignId: "campaign", documentId: "document", processingMode: "lean", store });
const checkpoint = (store: ReturnType<typeof memoryCheckpointStore>, operationType: string) => [...store.validated.values()].find((item) => item.identity.operationType === operationType)!;

describe("v0.4 two-pass extraction contract", () => {
  it("preserves dense inventory breadth independently of rich volume", () => {
    const validatedInventory = validateExtractionInventory(inventory, chunk.pages).inventory;
    const sparseRich = { ...rich, entities: rich.entities.map((entity) => ({ ...entity, facts: [] })), relationships: [] };
    const validatedRich = validateExtractionRich(sparseRich, validatedInventory, chunk.pages).rich;
    const assembled = assembleChunkExtraction(validatedInventory, validatedRich);
    expect(assembled.entities).toHaveLength(inventory.entities.length);
    expect(assembled.entities.map((entity) => entity.name)).toEqual(inventory.entities.map((entity) => entity.name));
  });

  it("fails closed for duplicate/unknown IDs and omitted inventory coverage", () => {
    expect(() => validateExtractionInventory({ entities: [inventory.entities[0], inventory.entities[0]] }, chunk.pages)).toThrow(/Duplicate inventory ID/);
    expect(() => validateExtractionRich({ ...rich, entities: rich.entities.slice(1) }, inventory, chunk.pages)).toThrow(/omitted inventory IDs/);
    expect(() => validateExtractionRich({ ...rich, relationships: [{ ...rich.relationships[0], target_temporary_id: "unknown" }] }, inventory, chunk.pages)).toThrow(/Unknown relationship endpoint/);
  });

  it("A: reuses inventory and reruns rich after a rich-pass failure", async () => {
    const store = memoryCheckpointStore();
    let failRich = true;
    const parse = vi.fn(async ({ schemaName }: { schemaName: string }) => {
      if (schemaName === "extraction_rich_output" && failRich) throw new Error("rich failed");
      return { output: schemaName === "extraction_inventory_output" ? inventory : rich, providerId: "openai" as const, modelId: "model", responseId: null, usage: usage("model") };
    });
    await expect(extractChunk(chunk, provider("model", parse as never), context(store))).rejects.toThrow("rich failed");
    failRich = false; parse.mockClear();
    const resumed = await extractChunk(chunk, provider("model", parse as never), context(store));
    expect(resumed).toMatchObject({ inventoryCheckpointStatus: "REUSE", richCheckpointStatus: "RUN" });
    expect(parse).toHaveBeenCalledOnce();
  });

  it("B/C: corrupt inventory invalidates both passes; corrupt rich reuses inventory", async () => {
    const store = memoryCheckpointStore();
    await extractChunk(chunk, provider("model", responder() as never), context(store));
    const inventoryEntry = checkpoint(store, "inventory") as ValidatedCheckpoint<{ rawInventory: ExtractionInventoryOutput }>;
    inventoryEntry.output.rawInventory = { entities: [inventory.entities[0], inventory.entities[0]] };
    const rerunBoth = await extractChunk(chunk, provider("model", responder() as never), context(store));
    expect(rerunBoth).toMatchObject({ inventoryCheckpointStatus: "RUN", richCheckpointStatus: "RUN" });
    const richEntry = checkpoint(store, "rich") as ValidatedCheckpoint<{ rawRichExtraction: ExtractionRichOutput }>;
    richEntry.output.rawRichExtraction = { ...rich, entities: [] };
    const rerunRich = await extractChunk(chunk, provider("model", responder() as never), context(store));
    expect(rerunRich).toMatchObject({ inventoryCheckpointStatus: "REUSE", richCheckpointStatus: "RUN" });
  });

  it("D/E: inventory identity changes invalidate rich, while a rich-only model change preserves inventory", async () => {
    const store = memoryCheckpointStore();
    const firstProviders: ExtractionProviders = { inventory: provider("inventory-a", responder() as never), rich: provider("rich-a", responder() as never) };
    await extractChunk(chunk, firstProviders, context(store));
    const inventoryModelChanged: ExtractionProviders = { inventory: provider("inventory-b", responder() as never), rich: provider("rich-a", responder() as never) };
    await expect(extractChunk(chunk, inventoryModelChanged, context(store))).resolves.toMatchObject({ inventoryCheckpointStatus: "RUN", richCheckpointStatus: "RUN" });

    const secondStore = memoryCheckpointStore();
    await extractChunk(chunk, firstProviders, context(secondStore));
    const richModelChanged: ExtractionProviders = { inventory: provider("inventory-a", responder() as never), rich: provider("rich-b", responder() as never) };
    await expect(extractChunk(chunk, richModelChanged, context(secondStore))).resolves.toMatchObject({ inventoryCheckpointStatus: "REUSE", richCheckpointStatus: "RUN" });

    const baseIdentity = inventoryCheckpointIdentity(chunk, firstProviders.inventory, context(store));
    const baseRich = richCheckpointIdentity(chunk, inventory, baseIdentity, firstProviders.rich, context(store));
    for (const changed of [{ behaviorVersion: "changed" }, { schemaVersion: 99 }, { inputHash: "changed" }]) {
      expect(richCheckpointIdentity(chunk, inventory, { ...baseIdentity, ...changed }, firstProviders.rich, context(store)).upstreamFingerprint).not.toBe(baseRich.upstreamFingerprint);
    }
  });

  it("F: both validated passes remain reusable after later work fails", async () => {
    const store = memoryCheckpointStore();
    await extractChunk(chunk, provider("model", responder() as never), context(store));
    expect(() => { throw new Error("persistence failed"); }).toThrow("persistence failed");
    await expect(extractChunk(chunk, provider("model", responder() as never), context(store))).resolves.toMatchObject({ inventoryCheckpointStatus: "REUSE", richCheckpointStatus: "REUSE" });
  });

  it("plans N inventory plus N rich operations and reports substage reuse independently", async () => {
    const store = memoryCheckpointStore();
    const providers = { inventory: provider("inventory", responder() as never), rich: provider("rich", responder() as never) };
    const fresh = await planTwoPassExtraction([chunk, { ...chunk, id: "dense-2" }], providers, context(store));
    expect(fresh).toHaveLength(4);
    expect(fresh.filter((item) => item.operationType === "inventory")).toHaveLength(2);
    expect(fresh.filter((item) => item.operationType === "rich")).toHaveLength(2);
    await extractChunk(chunk, providers, context(store));
    expect(await planTwoPassExtraction([chunk], providers, context(store))).toEqual([
      expect.objectContaining({ operationType: "inventory", status: "REUSE" }),
      expect.objectContaining({ operationType: "rich", status: "REUSE" }),
    ]);
  });
});

describe("two-pass curated recall regression", () => {
  it("retains every curated identity through assembly and preserves merge/distinctness semantics", () => {
    const pages = [...new Set(recallReferenceEntities.map((item) => item.sourcePage))].map((pageNumber) => ({ pageNumber, text: recallReferenceEntities.filter((item) => item.sourcePage === pageNumber).map((item) => item.supportingText).join(" ") }));
    const curatedInventory: ExtractionInventoryOutput = { entities: recallReferenceEntities.map((item, index) => ({ temporary_id: `ref-${index}`, name: item.name, type: item.expectedType, aliases: [], sources: [{ page_number: item.sourcePage, supporting_text: item.supportingText }] })) };
    curatedInventory.entities.push({ temporary_id: "cay-other", name: "Cay Naja", type: "other", aliases: [], sources: [{ page_number: 94, supporting_text: "their god of death, Cay Naja" }] });
    const curatedRich: ExtractionRichOutput = { entities: curatedInventory.entities.map((entity) => ({ inventory_id: entity.temporary_id, type: entity.type, roles: [], summary: `${entity.name}.`, facts: [] })), relationships: [], suspected_inventory_misses: [] };
    const assembled = assembleChunkExtraction(validateExtractionInventory(curatedInventory, pages).inventory, validateExtractionRich(curatedRich, curatedInventory, pages).rich);
    expect(assembled.entities).toHaveLength(curatedInventory.entities.length);
    const aggregate = aggregateCandidates([{ chunkId: "curated", ...assembled }]);
    const groups = buildDeterministicGroups(aggregate);
    const jeanas = groups.find((group) => group.candidates.some((candidate) => candidate.name === "Jeanas Clocker"))!;
    const jesper = groups.find((group) => group.candidates.some((candidate) => candidate.name === "Jesper Clocker"))!;
    expect(jeanas.id).not.toBe(jesper.id);
    const cayGroups = groups.filter((group) => group.candidates.some((candidate) => candidate.name === "Cay Naja"));
    const graph = buildCanonicalGraph(aggregate, { canonical_entities: [{ canonical_id: "cay", name: "Cay Naja", group_ids: cayGroups.map((group) => group.id), type: "deity", roles: [], aliases: [], summary: "God of death.", identity_evidence: [{ page_number: 94, supporting_text: "their god of death, Cay Naja" }] }] });
    expect(graph.entities.filter((entity) => entity.name === "Cay Naja")).toHaveLength(1);
    expect(graph.entities.filter((entity) => ["Jeanas Clocker", "Jesper Clocker"].includes(entity.name))).toHaveLength(2);
  });
});
