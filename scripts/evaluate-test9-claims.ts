/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/extraction-context";
import { claimCheckpointIdentity, claimTokenDiagnostics, planTest9ClaimRequests, runClaimExtraction, validateAndUnionClaims, type ClaimOutput } from "../lib/ai/claims-experiment";
import { createOpenAIStructuredModelProvider } from "../lib/ai/structured-model-provider";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";

loadEnvConfig(process.cwd());
const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const context = buildExtractionContext(cleanDocumentPagesForModel(fixture.pages).pages, inventory);
const requests = planTest9ClaimRequests(context);
const modelId = process.env.OPENAI_CLAIM_EXTRACTION_MODEL || "gpt-6-luna";
const fingerprint = extractionContextFingerprint(context);
const identities = requests.map((request) => claimCheckpointIdentity({ request, fixtureHash: fixture.fixture_hash, contextFingerprint: fingerprint, modelId }));
const outputAllowancePerCall = 2500;
const chunks = requests.map((request, index) => ({ requestId: request.requestId, pages: [...new Set(request.sourceSegments.map((segment) => segment.page))], segments: request.sourceSegments.length, entities: request.entities.length, tokens: claimTokenDiagnostics(request), checkpointIdentity: identities[index] }));
const input = chunks.reduce((sum, chunk) => sum + chunk.tokens.estimatedTokens.totalInput, 0);
const preflight = { fixtureHash: fixture.fixture_hash, modelId, behaviorVersion: "v0.6.7-claims-1", calls: requests.length, chunks, totals: {
  source: chunks.reduce((sum, chunk) => sum + chunk.tokens.estimatedTokens.source, 0),
  entity: chunks.reduce((sum, chunk) => sum + chunk.tokens.estimatedTokens.entity, 0),
  prompt: chunks.reduce((sum, chunk) => sum + chunk.tokens.estimatedTokens.prompt, 0),
  schema: chunks.reduce((sum, chunk) => sum + chunk.tokens.estimatedTokens.schema, 0),
  estimatedInput: input, outputAllowance: requests.length * outputAllowancePerCall, estimatedBudget: input + requests.length * outputAllowancePerCall,
} };
const preflightPath = join(directory, "claims-v067-preflight.json");
const progressPath = join(directory, "claims-v067-progress.json");
const resultPath = join(directory, "claims-v067-result.json");
const live = process.argv.includes("--live-luna");
const saved = process.argv.includes("--validate-saved");
if (live && saved) throw new Error("Choose one mode");
if (preflight.totals.estimatedBudget > 20_000) throw new Error(`Claim budget exceeds 20k: ${preflight.totals.estimatedBudget}`);

async function main() {
  writeFileSync(preflightPath, `${JSON.stringify(preflight, null, 2)}\n`);
  if (!live && !saved) { console.log(JSON.stringify({ preflightPath, preflight }, null, 2)); return; }
  if (live && (process.env.ALLOW_PAID_TEST9_CLAIMS_LUNA !== "1" || modelId !== "gpt-6-luna")) throw new Error("Explicit GPT-6 Luna Claim authorization and model required");
  type Completed = { requestId: string; identity: typeof identities[number]; output: ClaimOutput; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } };
  const progress: { fixtureHash: string; completed: Completed[] } = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { fixtureHash: fixture.fixture_hash, completed: [] };
  if (progress.fixtureHash !== fixture.fixture_hash || progress.completed.some((item) => JSON.stringify(item.identity) !== JSON.stringify(identities.find((identity) => identity.operationKey === item.requestId)))) throw new Error("Saved Claim checkpoint identity mismatch");
  if (live) {
    const { getOpenAIClient } = await import("../lib/ai/client");
    const provider = createOpenAIStructuredModelProvider(modelId, getOpenAIClient());
    for (const request of requests) {
      if (progress.completed.some((item) => item.requestId === request.requestId)) continue;
      const response = await runClaimExtraction(request, provider);
      progress.completed.push({ requestId: request.requestId, identity: identities.find((identity) => identity.operationKey === request.requestId)!, output: response.output, usage: response.usage });
      writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
    }
  }
  const validated = validateAndUnionClaims(progress.completed, requests);
  const touched = new Set(validated.claims.flatMap((claim) => claim.entityIds));
  const counts = { one: 0, two: 0, three: 0, fourPlus: 0 };
  for (const claim of validated.claims) counts[claim.entityIds.length === 1 ? "one" : claim.entityIds.length === 2 ? "two" : claim.entityIds.length === 3 ? "three" : "fourPlus"]++;
  const totalTokens = progress.completed.every((item) => item.usage.totalTokens !== null) ? progress.completed.reduce((sum, item) => sum + item.usage.totalTokens!, 0) : null;
  const participations = validated.claims.reduce((sum, claim) => sum + claim.entityIds.length, 0);
  const result = { preflight, proposed: validated.proposed, valid: validated.claims.length, rejected: validated.proposed - validated.claims.length - validated.duplicates,
    entityCounts: counts, entityParticipations: participations, distinctEntitiesTouched: touched.size,
    zeroClaimEntities: context.entities.filter((entity) => !touched.has(entity.canonicalId)).map((entity) => entity.name),
    averageEntitiesPerClaim: validated.claims.length ? participations / validated.claims.length : 0,
    duplicates: validated.duplicates, failures: { unknownParticipants: validated.unknownParticipants, ambiguousParticipants: validated.ambiguousParticipants, duplicateParticipants: validated.duplicateParticipants, invalidSegments: validated.invalidSegments, invalidPageSegments: validated.invalidPageSegments },
    actualUsage: progress.completed.map((item) => ({ requestId: item.requestId, usage: item.usage })), totalTokens,
    claimsPer1kTokens: totalTokens ? validated.claims.length * 1000 / totalTokens : null,
    entityParticipationsPer1kTokens: totalTokens ? participations * 1000 / totalTokens : null,
    claims: validated.claims };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ resultPath, result }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
