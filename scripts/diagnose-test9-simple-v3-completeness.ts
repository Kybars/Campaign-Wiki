/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zodTextFormat } from "openai/helpers/zod";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext } from "../lib/ai/extraction-context";
import { planSimpleGraphV3Completeness, serializeSimpleGraphV3CompletenessRequest, SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT, validateSimpleGraphV3Completeness } from "../lib/ai/simple-graph-v3-completeness";
import { planSimpleGraphV3Requests, simpleGraphV3OutputSchema, validateSimpleGraphV3, type ValidSimpleGraphV3Relationship } from "../lib/ai/simple-graph-v3";
import { normalizeName } from "../lib/graph/normalize";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";
import { classifyRelationshipScoringMatch } from "./wotbs-stage1";

const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const gold = JSON.parse(readFileSync(join(directory, "next-experiment-gold.json"), "utf8")) as any;
const progress = JSON.parse(readFileSync(join(directory, "simple-v3-progress.json"), "utf8")) as any;
const completenessProgress = JSON.parse(readFileSync(join(directory, "simple-v3-completeness-progress.json"), "utf8")) as any;
const audit = JSON.parse(readFileSync(join(directory, "simple-v3-nongold-audit.json"), "utf8")) as any;
const artifactPath = join(directory, "simple-v3-completeness-call-diagnostic.md");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const context = buildExtractionContext(cleanDocumentPagesForModel(fixture.pages).pages, inventory);
const firstPassRequest = planSimpleGraphV3Requests(context)[0];
const firstPass = validateSimpleGraphV3(progress.completed[0].output, firstPassRequest).relationships;
const entityIdsByName = new Map<string, string>();
for (const entity of inventory.entities) for (const name of [entity.name, ...(entity.aliases ?? [])]) entityIdsByName.set(normalizeName(name), entity.temporary_id);

function matchesGold(relationship: ValidSimpleGraphV3Relationship) {
  return gold.relationships.some((reference: any) => {
    const sourceId = entityIdsByName.get(normalizeName(reference.source));
    const targetId = entityIdsByName.get(normalizeName(reference.target));
    if (!sourceId || !targetId || !relationship.provenance.some((item) => reference.pages.includes(item.page))) return false;
    return classifyRelationshipScoringMatch(
      { sourceId: relationship.sourceCanonicalId, targetId: relationship.targetCanonicalId, relationshipType: relationship.relationshipType },
      { sourceId, targetId, relationshipType: reference.relationship },
    ) !== "NO_MATCH";
  });
}

const decisions = new Map(audit.decisions.map((decision: any) => [decision.key, decision]));
const accepted = firstPass.filter((relationship) => {
  if (matchesGold(relationship)) return true;
  const key = `${relationship.sourceName}|${relationship.relationship}|${relationship.targetName}|${relationship.provenance[0].segmentId}`;
  return (decisions.get(key) as any)?.classification === "VALID_USEFUL";
});
const plan = planSimpleGraphV3Completeness(context, accepted);
if (plan.requests.length !== 1) throw new Error(`Expected one saved-call request, found ${plan.requests.length}`);
const request = plan.requests[0];
const serialized = serializeSimpleGraphV3CompletenessRequest(request);
if (sha256(SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT) !== "f4ac1833d7283e16b5a63897a2edc9faf6aef103f211bc2f0d1aefe11973d139"
  || sha256(serialized.payload) !== "6d1af72e5d18b3c67f8f9bccc51d6e17b551ec48d1d3ded26de0f21650fbbb36") {
  throw new Error("The current contract differs from the historical saved call; preserve its frozen diagnostic artifact");
}
const schemaName = "simple_graph_v3_completeness_output";
const responseFormat = zodTextFormat(simpleGraphV3OutputSchema, schemaName);
const saved = completenessProgress.completed.find((item: any) => item.requestId === request.requestId);
if (!saved) throw new Error(`Saved response missing ${request.requestId}`);
const replay = validateSimpleGraphV3Completeness(saved.output, request);
const providerEnvelope = {
  model: saved.usage.model,
  input: [
    { role: "system", content: SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT },
    { role: "user", content: serialized.payload },
  ],
  text: { format: responseFormat },
};
const diagnostics = {
  requestId: request.requestId,
  promptSha256: sha256(SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT),
  payloadSha256: sha256(serialized.payload),
  schemaSha256: sha256(JSON.stringify(responseFormat)),
  targetCount: request.targets.length,
  entityCount: request.entities.length,
  existingRelationshipCount: request.existingRelationships.length,
  segmentIds: request.sourceSegments.map((segment) => segment.segmentId),
  semanticCharacters: request.sourceSegments.reduce((sum, segment) => sum + segment.semanticText.length, 0),
  actualUsage: saved.usage,
  requestSettings: {
    api: "OpenAI Responses API responses.parse",
    maxOutputTokens: "not supplied",
    reasoning: "not supplied; provider/model default",
    temperature: "not supplied; provider/model default",
    retries: "harness/provider client configuration not persisted in saved progress",
  },
  responseState: {
    responseId: saved.usage.responseId,
    parsedStructuredOutputWasPresent: true,
    status: "not persisted by StructuredModelProvider",
    incompleteDetails: "not persisted by StructuredModelProvider",
  },
  savedOutput: saved.output,
  originalSavedValidation: saved.validation,
  normalizedReplay: {
    proposed: replay.proposed,
    accepted: replay.relationships.length,
    invalidSegmentRejections: replay.invalidSegmentRejections,
    relationships: replay.relationships,
  },
};

const markdown = `# Simple V3 completeness saved-call diagnostic

Generated deterministically from the saved fixture, planner, prompt, schema, and response. No model/API call was made.

## Request and response metadata

\`\`\`json
${JSON.stringify(diagnostics, null, 2)}
\`\`\`

## Exact provider request envelope

Fields absent from this JSON were not supplied by \`createOpenAIStructuredModelProvider\`.

\`\`\`json
${JSON.stringify(providerEnvelope, null, 2)}
\`\`\`

## Exact system instructions

\`\`\`text
${SIMPLE_GRAPH_V3_COMPLETENESS_SYSTEM_PROMPT}
\`\`\`

## Exact user payload

\`\`\`text
${serialized.payload}
\`\`\`

## Exact structured-output format

\`\`\`json
${JSON.stringify(responseFormat, null, 2)}
\`\`\`
`;

writeFileSync(artifactPath, markdown);
console.log(JSON.stringify({ artifactPath, diagnostics }, null, 2));
