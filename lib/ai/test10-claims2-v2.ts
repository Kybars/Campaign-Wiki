import type { DocumentPage } from "@/lib/pdf/types";
import type { GraphInventory } from "@/lib/ai/entity-reconciliation";
import { claims2CheckpointIdentity, type Claims2Request, type EvidenceUnit } from "@/lib/ai/claims-2-experiment";
import { extractionContextFingerprint, planTest10Claims2, sha256, test10Identity } from "@/lib/ai/test10-claims2";

export const TEST10_PLAN_VERSION = 2;
export const TEST10_INVENTORY_VERSION_V2 = 2;
export const TEST10_WORKSHEET_VERSION_V2 = 2;
export const TEST10_CHUNK_PAGES = [[6, 7, 8, 9], [10, 11, 12, 13]] as const;

export interface SourceScopedIdentification {
  reference: string;
  evidence: Array<{ physicalPdfPage: number; start: number; end: number; exactText: string }>;
}
export interface Test10InventoryEntry {
  id: string;
  name: string;
  type: "npc" | "deity" | "location" | "faction" | "item" | "event" | "quest" | "other";
  aliases: string[];
  sourceReference: { physicalPdfPage: number; start: number; end: number; exactText: string };
  sourceScopedIdentification?: SourceScopedIdentification[];
}

export function planTest10Claims2V2(pages: DocumentPage[], entries: Test10InventoryEntry[]) {
  const inventory: GraphInventory = { entities: entries.map((entity) => ({ temporary_id: entity.id, name: entity.name, type: entity.type, aliases: entity.aliases, sources: [] })) };
  const base = planTest10Claims2(pages, inventory);
  const units: EvidenceUnit[] = base.request.evidenceUnits.map((unit) => ({ ...unit }));
  // The heading at the end of page 10 is a features sidebar. Page 11 opens
  // with the S1 mold encounter, before the S2 heading begins.
  const s2Order = units.find((unit) => unit.page === 11 && unit.kind === "heading" && unit.text === "[S2] The Room of Sorrow")?.order;
  if (s2Order === undefined) throw new Error("Missing S2 boundary in Test 10 source structure");
  for (const unit of units) if (unit.page === 11 && unit.order < s2Order) unit.context = "[S1] Rotted Pantry";
  const requests: Claims2Request[] = TEST10_CHUNK_PAGES.map((chunkPages, index) => ({
    requestId: `test10-sweetwater-claims2-v2-${index + 1}`,
    evidenceUnits: units.filter((unit) => (chunkPages as readonly number[]).includes(unit.page)),
    entities: base.context.entities,
  }));
  const coverage = requests.flatMap((request) => request.evidenceUnits.map((unit) => unit.unitId));
  if (coverage.length !== units.length || new Set(coverage).size !== units.length) throw new Error("Test 10 evidence coverage is incomplete or duplicated");

  const contextGaps: Array<{ kind: string; requestId: string; entityId?: string; reference?: string; pages: number[]; explanation: string }> = [];
  for (const [index, request] of requests.entries()) {
    const chunkPages = TEST10_CHUNK_PAGES[index];
    const text = pages.filter((page) => (chunkPages as readonly number[]).includes(page.pageNumber)).map((page) => page.text).join("\n").toLocaleLowerCase("en-US");
    for (const entity of entries) for (const identification of entity.sourceScopedIdentification ?? []) {
      const evidencePages = [...new Set(identification.evidence.map((item) => item.physicalPdfPage))];
      if (text.includes(identification.reference.toLocaleLowerCase("en-US")) && evidencePages.every((page) => !(chunkPages as readonly number[]).includes(page))) {
        contextGaps.push({ kind: "source_scoped_identity_outside_chunk", requestId: request.requestId, entityId: entity.id, reference: identification.reference,
          pages: evidencePages, explanation: "The existing Claims-2 request has canonical names and aliases but no source-scoped identity-evidence channel. The reference is present here; its identity evidence is outside this chunk." });
      }
    }
  }
  const p6 = units.filter((unit) => unit.page === 6);
  const p7 = units.filter((unit) => unit.page === 7);
  if (p6.length && p7.length && /^\p{Ll}/u.test(p7[0].text) && p6.at(-1)?.context !== p7[0].context) {
    contextGaps.push({ kind: "interrupted_page_continuation", requestId: requests[0].requestId, pages: [6, 7],
      explanation: "A page 6 sidebar intervenes between 'Each day' and the page 7 continuation. Claims-2 validates two-unit citations only when adjacent; this evidence is not adjacent." });
  }
  return { context: base.context, contextFingerprint: extractionContextFingerprint(base.context), requests, units, contextGaps };
}

export function test10V2Identity(args: { request: Claims2Request; fixtureHash: string; inventoryHash: string; manifestHash: string; contextFingerprint: string; modelId: string }) {
  const base = claims2CheckpointIdentity(args);
  return { ...test10Identity(args), operationType: "test10_claims_2_experiment_v2", operationKey: args.request.requestId,
    inputHash: base.inputHash,
    upstreamFingerprint: sha256(JSON.stringify({ fixtureHash: args.fixtureHash, inventoryHash: args.inventoryHash, manifestHash: args.manifestHash,
      contextFingerprint: args.contextFingerprint, planVersion: TEST10_PLAN_VERSION, inventoryVersion: TEST10_INVENTORY_VERSION_V2 })) };
}
