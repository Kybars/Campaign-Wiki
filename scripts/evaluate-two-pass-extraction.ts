import assert from "node:assert/strict";
import { recallReferenceEntities } from "../fixtures/recall-regression";
import { planTwoPassExtraction } from "../lib/ai/extract";
import { memoryCheckpointStore } from "../lib/ai/operation-checkpoint";
import { assembleChunkExtraction, validateExtractionInventory, validateExtractionRich } from "../lib/ai/source-validation";
import type { ExtractionInventoryOutput, ExtractionRichOutput } from "../lib/ai/schemas";
import type { StructuredModelProvider } from "../lib/ai/structured-model-provider";

async function main() {
  const pageNumbers = [...new Set(recallReferenceEntities.map((item) => item.sourcePage))];
  const pages = pageNumbers.map((pageNumber) => ({ pageNumber, text: recallReferenceEntities.filter((item) => item.sourcePage === pageNumber).map((item) => `${item.name}. ${item.supportingText}`).join(" ") }));
  const chunk = { id: "curated-recall", pages, characterCount: pages.reduce((sum, page) => sum + page.text.length, 0) };
  const inventory: ExtractionInventoryOutput = { entities: recallReferenceEntities.map((item) => ({ name: item.name, type: item.expectedType, page: item.sourcePage })) };
  const validatedInventory = validateExtractionInventory(inventory, chunk);
  const rich: ExtractionRichOutput = { entities: validatedInventory.inventory.entities.map((entity) => ({ inventory_id: entity.temporary_id, type: entity.type, aliases: [], roles: [], summary: `${entity.name}.`, facts: [] })), relationships: [], suspected_inventory_misses: [] };
  const validatedRich = validateExtractionRich(rich, validatedInventory.inventory, pages);
  const assembled = assembleChunkExtraction(validatedInventory.inventory, validatedRich.rich);
  assert.equal(assembled.entities.length, recallReferenceEntities.length);

  const unavailable = async () => { throw new Error("deterministic evaluator must not call a model"); };
  const provider: StructuredModelProvider = { providerId: "local", modelId: "fixture-local", parseStructured: unavailable };
  const store = memoryCheckpointStore();
  const plan = await planTwoPassExtraction([chunk], { inventory: provider, rich: provider }, { campaignId: "fixture", documentId: "fixture", processingMode: "lean", store });
  assert.deepEqual(plan.map((item) => [item.operationType, item.status]), [["inventory", "RUN"], ["rich", "RUN"]]);
  console.log(JSON.stringify({
    evaluation: "deterministic two-pass extraction contract",
    modelCalls: 0,
    databaseReads: 0,
    databaseWrites: 0,
    curatedInventoryEntities: validatedInventory.inventory.entities.length,
    assembledEntities: assembled.entities.length,
    passBCanDeleteInventoryEntities: false,
    inventoryOperations: 1,
    richOperations: 1,
    totalExtractionOperations: 2,
    planner: plan,
    result: "PASS",
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
