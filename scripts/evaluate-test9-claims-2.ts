/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";
import { buildExtractionContext, extractionContextFingerprint } from "../lib/ai/extraction-context";
import { CLAIMS_2_BEHAVIOR_VERSION, claims2CheckpointIdentity, claims2TokenDiagnostics, planTest9Claims2Requests, runClaims2Extraction, validateAndUnionClaims2, type Claims2Output } from "../lib/ai/claims-2-experiment";
import { createOpenAIStructuredModelProvider } from "../lib/ai/structured-model-provider";
import { cleanDocumentPagesForModel } from "../lib/pdf/model-text";

loadEnvConfig(process.cwd());
const directory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")) as any;
const inventory: GraphInventory = { entities: fixture.inventory.map((entity: any) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) };
const context = buildExtractionContext(cleanDocumentPagesForModel(fixture.pages).pages, inventory);
const requests = planTest9Claims2Requests(context);
const modelId = "gpt-6-luna";
const fingerprint = extractionContextFingerprint(context);
const identities = requests.map((request) => claims2CheckpointIdentity({ request, fixtureHash: fixture.fixture_hash, contextFingerprint: fingerprint, modelId }));
const claims1 = JSON.parse(readFileSync(join(directory, "claims-v067-result.json"), "utf8")) as any;
if (claims1.totalTokens !== 13_733 || claims1.actualUsage.reduce((sum: number, item: any) => sum + item.usage.outputTokens, 0) !== 8_072) throw new Error("Frozen Claims-1 usage changed");
const chunks = requests.map((request, index) => ({ requestId: request.requestId, pages: [...new Set(request.evidenceUnits.map((unit) => unit.page))], units: request.evidenceUnits.length, entities: request.entities.length, tokens: claims2TokenDiagnostics(request), checkpointIdentity: identities[index] }));
const estimatedInput = chunks.reduce((sum, chunk) => sum + chunk.tokens.estimatedTokens.totalInput, 0);
const outputAllowance = 8_072;
const preflight = { fixtureHash: fixture.fixture_hash, modelId, behaviorVersion: CLAIMS_2_BEHAVIOR_VERSION, calls: requests.length, claims1ActualTokens: 13_733, claims1OutputTokens: 8_072,
  chunks, totals: { estimatedInput, outputAllowance, estimatedBudget: estimatedInput + outputAllowance, target: 16_000, hardStop: 20_000 } };
const preflightPath = join(directory, "claims2-v067-preflight.json");
const progressPath = join(directory, "claims2-v067-progress.json");
const resultPath = join(directory, "claims2-v067-result.json");
const live = process.argv.includes("--live-luna");
const saved = process.argv.includes("--validate-saved");
if (live && saved) throw new Error("Choose one mode");
if (preflight.totals.estimatedBudget > 20_000) throw new Error(`Claims-2 budget exceeds 20k: ${preflight.totals.estimatedBudget}`);

async function main() {
  writeFileSync(preflightPath, `${JSON.stringify(preflight, null, 2)}\n`);
  if (!live && !saved) { console.log(JSON.stringify({ preflightPath, preflight }, null, 2)); return; }
  if (live && process.env.ALLOW_PAID_TEST9_CLAIMS2_LUNA !== "1") throw new Error("Explicit two-call Claims-2 authorization required");
  type Completed = { requestId: string; identity: typeof identities[number]; output: Claims2Output; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } };
  const progress: { fixtureHash: string; completed: Completed[] } = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { fixtureHash: fixture.fixture_hash, completed: [] };
  if (progress.fixtureHash !== fixture.fixture_hash || progress.completed.some((item) => JSON.stringify(item.identity) !== JSON.stringify(identities.find((identity) => identity.operationKey === item.requestId)))) throw new Error("Saved Claims-2 checkpoint identity mismatch");
  if (live) {
    const { getOpenAIClient } = await import("../lib/ai/client");
    const provider = createOpenAIStructuredModelProvider(modelId, getOpenAIClient());
    for (const request of requests) {
      if (progress.completed.some((item) => item.requestId === request.requestId)) continue;
      const response = await runClaims2Extraction(request, provider);
      progress.completed.push({ requestId: request.requestId, identity: identities.find((identity) => identity.operationKey === request.requestId)!, output: response.output, usage: response.usage });
      writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
    }
  }
  const validated = validateAndUnionClaims2(progress.completed, requests);
  const touched = new Set(validated.claims.flatMap((claim) => claim.entityIds));
  const entityParticipations = validated.claims.reduce((sum, claim) => sum + claim.entityIds.length, 0);
  const totalTokens = progress.completed.every((item) => item.usage.totalTokens !== null) ? progress.completed.reduce((sum, item) => sum + item.usage.totalTokens!, 0) : null;
  const result = { preflight, claims1Baseline: { valid: claims1.valid, entityParticipations: claims1.entityParticipations, totalTokens: claims1.totalTokens, outputTokens: 8_072 },
    proposed: validated.proposed, valid: validated.claims.length, duplicates: validated.duplicates, entityParticipations, distinctEntitiesTouched: touched.size,
    failures: { invalidUnits: validated.invalidUnits, headingCitations: validated.headingCitations, nonadjacentUnits: validated.nonadjacentUnits, crossContextUnits: validated.crossContextUnits,
      unknownParticipants: validated.unknownParticipants, ambiguousParticipants: validated.ambiguousParticipants, duplicateParticipants: validated.duplicateParticipants },
    actualUsage: progress.completed.map((item) => ({ requestId: item.requestId, usage: item.usage })), totalTokens, claims: validated.claims };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ resultPath, summary: { valid: result.valid, entityParticipations, totalTokens, failures: result.failures } }, null, 2));
}
void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
