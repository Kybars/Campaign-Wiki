import type { DocumentPage } from "@/lib/pdf/types";
import type { GraphInventory } from "@/lib/ai/entity-reconciliation";
import { claims2CheckpointIdentity, type Claims2Request } from "@/lib/ai/claims-2-experiment";
import type { BudgetReservation } from "@/lib/ai/experiment-budget";
import { extractionContextFingerprint, planTest10Claims2, sha256 } from "@/lib/ai/test10-claims2";
import type { Test10InventoryEntry } from "@/lib/ai/test10-claims2-v2";

export const TEST10_V3_BENCHMARK_VERSION = 3;
export const TEST10_V3_REQUEST_ID = "test10-sweetwater-claims2-v3-1";

export function test10V3DispatchStatus(reservation: BudgetReservation, knownEvaluationLimitations: string[]) {
  const fatalDispatchBlockers = reservation.fits ? [] : ["Configured token reservation does not fit the run or stage budget"];
  return { fatalDispatchBlockers, knownEvaluationLimitations, runnable: fatalDispatchBlockers.length === 0 };
}

export function planTest10Claims2V3(pages: DocumentPage[], entries: Test10InventoryEntry[]) {
  const inventory: GraphInventory = { entities: entries.map((entity) => ({ temporary_id: entity.id, name: entity.name, type: entity.type, aliases: entity.aliases, sources: [] })) };
  const base = planTest10Claims2(pages, inventory);
  const request: Claims2Request = { ...base.request, requestId: TEST10_V3_REQUEST_ID };
  return { context: base.context, contextFingerprint: extractionContextFingerprint(base.context), request };
}

export function test10V3Identity(args: { request: Claims2Request; fixtureHash: string; inventoryHash: string; worksheetHash: string; manifestHash: string; contextFingerprint: string; modelId: string }) {
  const base = claims2CheckpointIdentity(args);
  return { ...base, campaignId: "test10-sweetwater-v3-fixture", operationType: "test10_claims_2_experiment_v3", operationKey: TEST10_V3_REQUEST_ID,
    upstreamFingerprint: sha256(JSON.stringify({ fixtureHash: args.fixtureHash, inventoryHash: args.inventoryHash, worksheetHash: args.worksheetHash,
      manifestHash: args.manifestHash, contextFingerprint: args.contextFingerprint, benchmarkVersion: TEST10_V3_BENCHMARK_VERSION })) };
}
