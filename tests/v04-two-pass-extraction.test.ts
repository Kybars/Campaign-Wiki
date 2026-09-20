import { describe, expect, it, vi } from "vitest";
import { completenessCheckpointIdentity, extractChunk, finalInventoryIdentity, inventoryCheckpointIdentity, planTwoPassExtraction, richFactsCheckpointIdentity, richRelationshipsCheckpointIdentity, type ExtractionProviders } from "@/lib/ai/extract";
import { EXTRACTION_INVENTORY_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_CONTRACT_VERSION } from "@/lib/ai/operation-checkpoint";
import { assembleChunkExtraction, deterministicInventoryId, groundInventoryIdentity, validateExtractionInventory, validateExtractionRich } from "@/lib/ai/source-validation";
import { memoryCheckpointStore, type ValidatedCheckpoint } from "@/lib/ai/operation-checkpoint";
import { extractionInventoryOutputSchema, type ExtractionInventoryOutput, type ExtractionRichOutput } from "@/lib/ai/schemas";
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
  ["Mira Vale", "npc", sentences[0]], ["Tomas Reed", "npc", sentences[1]], ["Ashfall", "location", sentences[2]],
  ["Moon Gate", "location", sentences[3]], ["Dawn Compact", "faction", sentences[4]], ["Ember Key", "item", sentences[5]],
  ["Recover the Ember Key", "quest", sentences[6]], ["Moon Gate Siege", "event", sentences[7]], ["Salu", "deity", sentences[8]],
  ["Ashfall Compact", "other", sentences[9]],
].map(([name, type]) => ({ name, type: type as ExtractionInventoryOutput["entities"][number]["type"], page: 1 })) };
const validatedInventory = validateExtractionInventory(inventory, chunk).inventory;
const fieldByType = { npc: "occupation", location: "place_kind", faction: "purpose", item: "item_type", quest: "objective", event: "what_happened", deity: "domain", other: "detail" } as const;
const rich: ExtractionRichOutput = {
  entities: validatedInventory.entities.map((entity) => ({ inventory_id: entity.temporary_id, type: entity.type, aliases: [], roles: [], summary: `${entity.name} is source-backed.`, facts: [{ temporary_id: `${entity.temporary_id}-fact`, field_key: fieldByType[entity.type], content: entity.name, sources: entity.sources }] })),
  relationships: [
    { source_temporary_id: validatedInventory.entities.find((entity) => entity.name === "Moon Gate")!.temporary_id, target_temporary_id: validatedInventory.entities.find((entity) => entity.name === "Ashfall")!.temporary_id, relationship_type: "located_in", description: "The gate is in Ashfall.", confidence: 1, sources: source(sentences[3]) },
  ],
  suspected_inventory_misses: [],
};
const compactFacts = { aliases: [], facts: validatedInventory.entities.map((entity) => ({ entity_id: entity.temporary_id, fact_type: fieldByType[entity.type], value: entity.name, support_span_ids: ["p1_s001"] })) };
const compactRelationships = { relationships: rich.relationships.map((relationship) => ({ source_id: relationship.source_temporary_id, type: relationship.relationship_type, target_id: relationship.target_temporary_id, support_span_ids: ["p1_s001"] })) };
const usage = (model: string) => ({ model, responseId: null, inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2, totalTokens: 12, estimatedCostUsd: null });
const provider = (modelId: string, parseStructured: StructuredModelProvider["parseStructured"]): StructuredModelProvider => ({ providerId: "openai", modelId, parseStructured });
const responder = (inventoryOutput = inventory) => vi.fn(async ({ schemaName }: { schemaName: string }) => ({ output: schemaName === "extraction_inventory_output" ? inventoryOutput : schemaName === "extraction_inventory_completeness_output" ? { entities: [] } : schemaName === "compact_rich_facts_output" ? compactFacts : compactRelationships, providerId: "openai" as const, modelId: "model", responseId: null, usage: usage("model") }));
const context = (store = memoryCheckpointStore()) => ({ campaignId: "campaign", documentId: "document", processingMode: "lean", store });
const checkpoint = (store: ReturnType<typeof memoryCheckpointStore>, operationType: string) => [...store.validated.values()].find((item) => item.identity.operationType === operationType)!;

describe("v0.4 two-pass extraction contract", () => {
  it("preserves dense inventory breadth independently of rich volume", () => {
    const validatedInventory = validateExtractionInventory(inventory, chunk).inventory;
    const sparseRich = { ...rich, entities: rich.entities.map((entity) => ({ ...entity, facts: [] })), relationships: [] };
    const validatedRich = validateExtractionRich(sparseRich, validatedInventory, chunk.pages).rich;
    const assembled = assembleChunkExtraction(validatedInventory, validatedRich);
    expect(assembled.entities).toHaveLength(inventory.entities.length);
    expect(assembled.entities.map((entity) => entity.name).sort()).toEqual(inventory.entities.map((entity) => entity.name).sort());
  });

  it("deduplicates compact identities, preserves omitted rich entities, and rejects unknown endpoints", () => {
    expect(validateExtractionInventory({ entities: [inventory.entities[0], inventory.entities[0]] }, chunk).inventory.entities).toHaveLength(1);
    expect(assembleChunkExtraction(validatedInventory, validateExtractionRich({ ...rich, entities: rich.entities.slice(1) }, validatedInventory, chunk.pages).rich).entities).toHaveLength(inventory.entities.length);
    expect(() => validateExtractionRich({ ...rich, relationships: [{ ...rich.relationships[0], target_temporary_id: "unknown" }] }, validatedInventory, chunk.pages)).toThrow(/Unknown relationship endpoint/);
  });

  it("A: reuses inventory and reruns rich after a rich-pass failure", async () => {
    const store = memoryCheckpointStore();
    let failRich = true;
    const parse = vi.fn(async ({ schemaName }: { schemaName: string }) => {
      if (schemaName === "compact_rich_facts_output" && failRich) throw new Error("rich failed");
      return { output: schemaName === "extraction_inventory_output" ? inventory : schemaName === "extraction_inventory_completeness_output" ? { entities: [] } : schemaName === "compact_rich_facts_output" ? compactFacts : compactRelationships, providerId: "openai" as const, modelId: "model", responseId: null, usage: usage("model") };
    });
    await expect(extractChunk(chunk, provider("model", parse as never), context(store))).rejects.toThrow("rich failed");
    failRich = false; parse.mockClear();
    const resumed = await extractChunk(chunk, provider("model", parse as never), context(store));
    expect(resumed).toMatchObject({ inventoryCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE", richCheckpointStatus: "RUN" });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("B/C: corrupt initial checkpoint reruns only the initial stage when validated output is unchanged; corrupt rich reuses final inventory", async () => {
    const store = memoryCheckpointStore();
    await extractChunk(chunk, provider("model", responder() as never), context(store));
    const inventoryEntry = checkpoint(store, "inventory") as ValidatedCheckpoint<{ rawInventory: ExtractionInventoryOutput; inventory: typeof validatedInventory }>;
    inventoryEntry.output.rawInventory = { entities: [{ ...inventory.entities[0], page: 99 }] };
    const rerunBoth = await extractChunk(chunk, provider("model", responder() as never), context(store));
    expect(rerunBoth).toMatchObject({ inventoryCheckpointStatus: "RUN", completenessCheckpointStatus: "REUSE", richCheckpointStatus: "REUSE" });
    const richEntry = checkpoint(store, "rich_facts") as ValidatedCheckpoint<{ rawFacts: typeof compactFacts }>;
    richEntry.output.rawFacts = { aliases: [], facts: [{ ...compactFacts.facts[0], entity_id: "unknown" }] };
    const rerunRich = await extractChunk(chunk, provider("model", responder() as never), context(store));
    expect(rerunRich).toMatchObject({ inventoryCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE", richCheckpointStatus: "REUSE" });
    expect(JSON.stringify(rerunRich.extraction.entities)).not.toContain('"temporary_id":"unknown"');
  });

  it("D/E: initial changes invalidate completeness and rich, while completeness/rich-only changes preserve initial reuse", async () => {
    const store = memoryCheckpointStore();
    const firstProviders: ExtractionProviders = { inventory: provider("inventory-a", responder() as never), rich: provider("rich-a", responder() as never) };
    await extractChunk(chunk, firstProviders, context(store));
    const inventoryModelChanged: ExtractionProviders = { inventory: provider("inventory-b", responder() as never), rich: provider("rich-a", responder() as never) };
    await expect(extractChunk(chunk, inventoryModelChanged, context(store))).resolves.toMatchObject({ inventoryCheckpointStatus: "RUN", completenessCheckpointStatus: "RUN", richCheckpointStatus: "RUN" });

    const secondStore = memoryCheckpointStore();
    await extractChunk(chunk, firstProviders, context(secondStore));
    const completenessModelChanged: ExtractionProviders = { inventory: provider("inventory-a", responder() as never), completeness: provider("completeness-b", responder() as never), rich: provider("rich-a", responder() as never) };
    await expect(extractChunk(chunk, completenessModelChanged, context(secondStore))).resolves.toMatchObject({ inventoryCheckpointStatus: "REUSE", completenessCheckpointStatus: "RUN", richCheckpointStatus: "RUN" });
    const thirdStore = memoryCheckpointStore();
    await extractChunk(chunk, firstProviders, context(thirdStore));
    const richModelChanged: ExtractionProviders = { inventory: provider("inventory-a", responder() as never), rich: provider("rich-b", responder() as never) };
    await expect(extractChunk(chunk, richModelChanged, context(thirdStore))).resolves.toMatchObject({ inventoryCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE", richCheckpointStatus: "RUN" });

    const baseIdentity = inventoryCheckpointIdentity(chunk, firstProviders.inventory, context(store));
    const completeness = completenessCheckpointIdentity(chunk, validatedInventory, baseIdentity, firstProviders.inventory, context(store));
    const final = finalInventoryIdentity(chunk, validatedInventory, baseIdentity, completeness);
    const baseRich = richFactsCheckpointIdentity(chunk, validatedInventory, final, firstProviders.rich!, context(store));
    const baseRelationships = richRelationshipsCheckpointIdentity(chunk, validatedInventory, final, firstProviders.rich!, context(store));
    const changedFactsModel = richFactsCheckpointIdentity(chunk, validatedInventory, final, provider("facts-b", responder() as never), context(store));
    const changedRelationshipsModel = richRelationshipsCheckpointIdentity(chunk, validatedInventory, final, provider("relationships-b", responder() as never), context(store));
    expect(changedFactsModel.modelId).not.toBe(baseRich.modelId);
    expect(changedRelationshipsModel.modelId).not.toBe(baseRelationships.modelId);
    expect(changedFactsModel.upstreamFingerprint).toBe(baseRich.upstreamFingerprint);
    expect(changedRelationshipsModel.upstreamFingerprint).toBe(baseRelationships.upstreamFingerprint);
    for (const changed of [{ behaviorVersion: "changed" }, { schemaVersion: 99 }, { inputHash: "changed" }]) {
      expect(richFactsCheckpointIdentity(chunk, validatedInventory, { ...final, ...changed }, firstProviders.rich!, context(store)).upstreamFingerprint).not.toBe(baseRich.upstreamFingerprint);
      expect(richRelationshipsCheckpointIdentity(chunk, validatedInventory, { ...final, ...changed }, firstProviders.rich!, context(store)).upstreamFingerprint).not.toBe(baseRelationships.upstreamFingerprint);
    }
  });

  it("F: both validated passes remain reusable after later work fails", async () => {
    const store = memoryCheckpointStore();
    await extractChunk(chunk, provider("model", responder() as never), context(store));
    expect(() => { throw new Error("persistence failed"); }).toThrow("persistence failed");
    await expect(extractChunk(chunk, provider("model", responder() as never), context(store))).resolves.toMatchObject({ inventoryCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE", richCheckpointStatus: "REUSE" });
  });

  it("keeps compact rich substage checkpoints independent", async () => {
    const store = memoryCheckpointStore();
    const base: ExtractionProviders = {
      inventory: provider("inventory", responder() as never),
      facts: provider("facts-a", responder() as never),
      relationships: provider("relationships-a", responder() as never),
    };
    await extractChunk(chunk, base, context(store));
    await expect(extractChunk(chunk, { ...base, facts: provider("facts-b", responder() as never) }, context(store))).resolves.toMatchObject({
      inventoryCheckpointStatus: "REUSE",
      completenessCheckpointStatus: "REUSE",
      factsCheckpointStatus: "RUN",
      relationshipsCheckpointStatus: "REUSE",
    });

    const secondStore = memoryCheckpointStore();
    await extractChunk(chunk, base, context(secondStore));
    await expect(extractChunk(chunk, { ...base, relationships: provider("relationships-b", responder() as never) }, context(secondStore))).resolves.toMatchObject({
      inventoryCheckpointStatus: "REUSE",
      completenessCheckpointStatus: "REUSE",
      factsCheckpointStatus: "REUSE",
      relationshipsCheckpointStatus: "RUN",
    });
  });

  it("plans N initial plus N completeness plus N rich operations and reports substage reuse independently", async () => {
    const store = memoryCheckpointStore();
    const providers = { inventory: provider("inventory", responder() as never), rich: provider("rich", responder() as never) };
    const fresh = await planTwoPassExtraction([chunk, { ...chunk, id: "dense-2" }], providers, context(store));
    expect(fresh).toHaveLength(8);
    expect(fresh.filter((item) => item.operationType === "inventory")).toHaveLength(2);
    expect(fresh.filter((item) => item.operationType === "inventory_completeness")).toHaveLength(2);
    expect(fresh.filter((item) => item.operationType === "rich_facts")).toHaveLength(2);
    expect(fresh.filter((item) => item.operationType === "rich_relationships")).toHaveLength(2);
    await extractChunk(chunk, providers, context(store));
    expect(await planTwoPassExtraction([chunk], providers, context(store))).toEqual([
      expect.objectContaining({ operationType: "inventory", status: "REUSE" }),
      expect.objectContaining({ operationType: "inventory_completeness", status: "REUSE" }),
      expect.objectContaining({ operationType: "rich_facts", status: "REUSE" }),
      expect.objectContaining({ operationType: "rich_relationships", status: "REUSE" }),
    ]);
  });
});

describe("two-pass curated recall regression", () => {
  it("retains every curated identity through assembly and preserves merge/distinctness semantics", () => {
    const pages = [...new Set(recallReferenceEntities.map((item) => item.sourcePage))].map((pageNumber) => ({ pageNumber, text: recallReferenceEntities.filter((item) => item.sourcePage === pageNumber).map((item) => `${item.name}. ${item.supportingText}`).join(" ") }));
    const curatedInventory: ExtractionInventoryOutput = { entities: recallReferenceEntities.map((item) => ({ name: item.name, type: item.expectedType, page: item.sourcePage })) };
    curatedInventory.entities.push({ name: "Cay Naja", type: "other", page: 94 });
    const curatedChunk = { id: "curated", pages, characterCount: pages.reduce((sum, page) => sum + page.text.length, 0) };
    const authoritative = validateExtractionInventory(curatedInventory, curatedChunk).inventory;
    const curatedRich: ExtractionRichOutput = { entities: authoritative.entities.map((entity) => ({ inventory_id: entity.temporary_id, type: entity.type, aliases: [], roles: [], summary: `${entity.name}.`, facts: [] })), relationships: [], suspected_inventory_misses: [] };
    const assembled = assembleChunkExtraction(authoritative, validateExtractionRich(curatedRich, authoritative, pages).rich);
    expect(assembled.entities).toHaveLength(curatedInventory.entities.length);
    const aggregate = aggregateCandidates([{ chunkId: "curated", ...assembled }]);
    const groups = buildDeterministicGroups(aggregate);
    const jeanas = groups.find((group) => group.candidates.some((candidate) => candidate.name === "Jeanas Clocker"))!;
    const jesper = groups.find((group) => group.candidates.some((candidate) => candidate.name === "Jesper Clocker"))!;
    expect(jeanas.id).not.toBe(jesper.id);
    const cayGroups = groups.filter((group) => group.candidates.some((candidate) => candidate.name === "Cay Naja"));
    const graph = buildCanonicalGraph(aggregate, { canonical_entities: [{ canonical_id: "cay", name: "Cay Naja", group_ids: cayGroups.map((group) => group.id), type: "deity", roles: [], aliases: [], summary: "God of death.", identity_evidence: [authoritative.entities.find((entity) => entity.name === "Cay Naja")!.sources[0]] }] });
    expect(graph.entities.filter((entity) => entity.name === "Cay Naja")).toHaveLength(1);
    expect(graph.entities.filter((entity) => ["Jeanas Clocker", "Jesper Clocker"].includes(entity.name))).toHaveLength(2);
  });

  it("enforces the identity-page schema and deterministic location-sensitive IDs", () => {
    expect(() => extractionInventoryOutputSchema.parse({ entities: [{ name: "Mira", type: "npc" }] })).toThrow();
    expect(() => extractionInventoryOutputSchema.parse({ entities: [{ name: "Mira", type: "enemy", page: 1 }] })).toThrow();
    expect(() => extractionInventoryOutputSchema.parse({ entities: [{ name: "Mira", type: "npc", page: 0 }] })).toThrow();
    expect(() => extractionInventoryOutputSchema.parse({ entities: [{ ...inventory.entities[0], temporary_id: "model-id", aliases: ["Alias"], roles: [], summary: "prose" }] })).toThrow();
    const reversed = validateExtractionInventory({ entities: [...inventory.entities].reverse() }, chunk).inventory;
    expect(reversed).toEqual(validatedInventory);
    expect(JSON.parse(JSON.stringify(reversed))).toEqual(reversed);
    const repeated = { id: "repeated", pages: [{ pageNumber: 1, text: "Echo appears here in one scene." }, { pageNumber: 2, text: "Echo appears here in another scene." }], characterCount: 65 };
    const occurrences = validateExtractionInventory({ entities: [{ name: "Echo", type: "npc", page: 1 }, { name: "Echo", type: "npc", page: 2 }] }, repeated).inventory;
    expect(new Set(occurrences.entities.map((entity) => entity.temporary_id)).size).toBe(2);
  });

  it("grounds evidence deterministically and keeps IDs independent from excerpt formatting", () => {
    const exact = groundInventoryIdentity({ name: "Moon Gate", type: "location", page: 1 }, chunk.pages);
    expect(exact).toMatchObject({ strategy: "exact_normalized_name", source: { page_number: 1 } });
    expect(exact.source?.supporting_text).toContain("Moon Gate");
    const inferred = groundInventoryIdentity({ name: "Assassination of Mira Vale", type: "event", page: 1 }, [{ pageNumber: 1, text: "Mira Vale was assassinated during the Ashfall uprising." }]);
    expect(inferred).toMatchObject({ strategy: "inferred_event_or_quest_tokens", source: { page_number: 1 } });
    expect(groundInventoryIdentity({ name: "Invented Stranger", type: "npc", page: 1 }, chunk.pages)).toMatchObject({ source: null, strategy: null });
    const fingerprint = "f".repeat(64);
    expect(deterministicInventoryId(fingerprint, "npc", "Mira Vale", 1)).toBe(deterministicInventoryId(fingerprint, "npc", "Mira Vale", 1));
    expect(deterministicInventoryId(fingerprint, "npc", "Echo", 1)).not.toBe(deterministicInventoryId(fingerprint, "quest", "Echo", 1));
  });

  it("uses the cleaned-model-text identity-page checkpoint behavior and invalidates older inventory identity", async () => {
    expect(EXTRACTION_INVENTORY_CONTRACT_VERSION).toBe(3);
    expect(EXTRACTION_INVENTORY_BEHAVIOR_VERSION).toBe("v0.6.1-semantic-text-inventory-1");
    const store = memoryCheckpointStore();
    const current = inventoryCheckpointIdentity(chunk, provider("model", responder() as never), context(store));
    const v2 = { ...current, behaviorVersion: "v0.4-compact-inventory-2", schemaVersion: 2 };
    await store.saveValidated({ identity: v2, output: {}, usage: [], attemptCount: 1 });
    await expect(store.inspect!(current)).resolves.toMatchObject({ status: "INVALIDATED" });
  });
});
