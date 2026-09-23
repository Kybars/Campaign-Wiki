import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildExtractionContext } from "../lib/ai/compact-extraction-context";
import { COMPACT_RELATIONSHIP_SYSTEM_PROMPT, compactRelationshipOutputSchema, planCompactRelationshipRequests, serializeCompactRelationshipRequest, validateCompactRelationships } from "../lib/ai/compact-relationship-extraction";
import { extractionInventoryOutputSchema, type CandidateRelationship } from "../lib/ai/schemas";
import { validateAndUnionCompleteness } from "../lib/ai/inventory-completeness";
import { validateExtractionInventory } from "../lib/ai/source-validation";
import { normalizeName } from "../lib/graph/normalize";
import { loadWotbsGoldReference, loadWotbsStage1Fixture, scoreWotbsRelationships, WOTBS_STAGE1_EXPECTED_DIGEST, WOTBS_STAGE1_EXPECTED_MODEL } from "./wotbs-stage1";

const fixtureRoot = new URL("../fixtures/wotbs-stage1/", import.meta.url);
const inventoryRoot = new URL("../artifacts/wotbs-stage1-pass-b/", import.meta.url);
const resultRoot = new URL("../artifacts/wotbs-compact-graph/", import.meta.url);
const resultPath = new URL("manifest.json", resultRoot);
const endpoint = "http://localhost:11434";
const refinedSchema = z.object({ relationships: compactRelationshipOutputSchema.shape.relationships.max(80) }).strict();
const prompt = `${COMPACT_RELATIONSHIP_SYSTEM_PROMPT}
The integer before the first | on an entity line is that entity's exact ID. Copy that integer; do not infer IDs from row positions or names.
Before emitting an edge, verify the cited segment supports both chosen entity names or an unambiguous reference to them.
Keep r to 1–5 words that express only the semantic relation. Return at most 80 strongest unique relationships.`;

async function main() {
  if (existsSync(resultPath)) { console.log(readFileSync(resultPath, "utf8")); return; }
  const fixture = await loadWotbsStage1Fixture(fileURLToPath(new URL("source/WOTBS_STAGE1_SOURCE_pages_10-12.pdf", fixtureRoot)));
  const initial = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("initial-raw.json", inventoryRoot), "utf8")));
  const completeness = extractionInventoryOutputSchema.parse(JSON.parse(readFileSync(new URL("completeness-raw.json", inventoryRoot), "utf8")));
  const inventory = validateAndUnionCompleteness(validateExtractionInventory(initial, fixture.chunks[0]).inventory, completeness, fixture.chunks[0]).finalInventory;
  if (inventory.entities.length !== 42) throw new Error(`Expected frozen 42-entity inventory, got ${inventory.entities.length}`);
  const context = buildExtractionContext(fixture.pages, inventory);
  const requests = planCompactRelationshipRequests(context, 12_000);
  if (requests.length !== 1) throw new Error(`Expected one compact request for second fixture, got ${requests.length}`);
  const tagsResponse = await fetch(`${endpoint}/api/tags`);
  const tags = await tagsResponse.json() as { models?: Array<{ name?: string; digest?: string }> };
  const digest = tags.models?.find((model) => model.name === WOTBS_STAGE1_EXPECTED_MODEL)?.digest;
  if (digest !== WOTBS_STAGE1_EXPECTED_DIGEST) throw new Error(`Frozen Ollama digest mismatch: ${digest ?? "missing"}`);
  const serialized = serializeCompactRelationshipRequest(context, requests[0]);
  const started = performance.now();
  const response = await fetch(`${endpoint}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: WOTBS_STAGE1_EXPECTED_MODEL, stream: false, think: false, messages: [{ role: "system", content: prompt }, { role: "user", content: serialized.payload }], format: z.toJSONSchema(refinedSchema), options: { temperature: 0, num_ctx: 32768, num_predict: 6000 } }) });
  const envelope = await response.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  if (!response.ok) throw new Error(`Ollama second-fixture request failed (${response.status})`);
  const raw = refinedSchema.parse(JSON.parse(envelope.message?.content ?? ""));
  const validation = validateCompactRelationships(raw, context, requests[0]);
  const candidates: CandidateRelationship[] = validation.relationships.map((relationship, index) => ({ source_temporary_id: relationship.sourceCanonicalEntityId, target_temporary_id: relationship.targetCanonicalEntityId, relationship_type: relationship.relationship, description: relationship.relationship, confidence: 1, sources: [{ page_number: relationship.page, supporting_text: relationship.rawSource.text }], __index: index } as CandidateRelationship));
  const gold = loadWotbsGoldReference(fileURLToPath(new URL("evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", fixtureRoot)));
  const score = scoreWotbsRelationships(candidates, inventory, gold.reference);
  const inventoryNames = new Set(inventory.entities.map((entity) => normalizeName(entity.name)));
  const goldEntities = [...gold.reference.hard_entities, ...gold.reference.soft_entities];
  const endpointPresent = (name: string) => {
    const entity = goldEntities.find((candidate) => candidate.name === name);
    const aliases = entity && "aliases" in entity && Array.isArray(entity.aliases) ? entity.aliases.filter((alias): alias is string => typeof alias === "string") : [];
    return Boolean(entity && [entity.name, ...aliases].some((alias) => inventoryNames.has(normalizeName(alias))));
  };
  const eligible = gold.reference.core_relationships.filter((relationship) => endpointPresent(relationship.source) && endpointPresent(relationship.target));
  const eligibleKeys = new Set(eligible.map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`));
  const recovered = score.recovered.filter((relationship) => eligibleKeys.has(relationship));
  const inputTokens = envelope.prompt_eval_count ?? 0; const outputTokens = envelope.eval_count ?? 0; const totalTokens = inputTokens + outputTokens;
  const manifest = { fixture: "prior verified 42-entity graph fixture", strategies: { BEqualsC: true, reason: "source fits the 12,000-character bound in one request" }, model: WOTBS_STAGE1_EXPECTED_MODEL, digest, calls: 1, latencyMs: Math.round(performance.now() - started), inputTokens, outputTokens, totalTokens, proposed: raw.relationships.length, validUniqueRelationships: validation.relationships.length, invalidEntityIdRejections: validation.invalidEntityIdRejections, invalidSegmentIdRejections: validation.invalidSegmentIdRejections, duplicateRejections: validation.duplicateRejections, provenanceFailures: validation.invalidSegmentIdRejections, recovered: recovered.length, eligibleGold: eligible.length, recall: recovered.length / eligible.length, recallPer1kTokens: recovered.length / (totalTokens / 1000), recoveredRelationships: recovered, missedRelationships: eligible.map((relationship) => `${relationship.source} -> ${relationship.relation} -> ${relationship.target}`).filter((relationship) => !recovered.includes(relationship)), auditRows: validation.relationships.map((relationship) => ({ source: relationship.sourceName, relationship: relationship.relationship, target: relationship.targetName, page: relationship.page, evidence: relationship.rawSource.text })), safety: { ollamaCalls: 1, openAICalls: 0, retries: 0 } };
  mkdirSync(resultRoot, { recursive: true }); writeFileSync(resultPath, `${JSON.stringify(manifest, null, 2)}\n`); console.log(JSON.stringify(manifest, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
