import { createHash } from "node:crypto";
import type { DocumentPage } from "@/lib/pdf/types";
import type { GraphInventory } from "@/lib/ai/entity-reconciliation";
import { extractionContextFingerprint, type ExtractionContext } from "@/lib/ai/extraction-context";
import { claims2CheckpointIdentity, type Claims2Request, type EvidenceUnit } from "@/lib/ai/claims-2-experiment";

export const TEST10_PAGES = [6, 7, 8, 9, 10, 11, 12, 13] as const;
export const TEST10_FIXTURE_VERSION = 1;
export const TEST10_INVENTORY_VERSION = 1;

export function sha256(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex"); }
export function fixtureHash(pages: DocumentPage[]) { return sha256(JSON.stringify({ version: TEST10_FIXTURE_VERSION, pages })); }

const sourceHeadings: Record<number, string[]> = {
  6: ["Intro d uction", "Background", "Ul lae", "The Wor ld of\nThe Demonplague"],
  7: ["Adventure\nSynopsis", "Adventure Hook"],
  8: ["Sweetwater Vil lage\nRuins", "Phalin and Callia"],
  9: ["Trapdoor", "Treasure"],
  10: ["Temple Catacombs", "Areas of the\nCatacombs", "[S1] Rotted Pantry", "Cat acombs Features"],
  11: ["[S2] The Room of Sorrow", "[S3] The Crypts"],
  12: ["Altar.", "Interment Niches.", "Secret Door.", "[S4] Putrid Moss", "[S5] Treasure Room", "Treasure."],
  13: ["Conclusion"],
};
const pageSection: Record<number, string> = { 6: "Introduction / Background", 7: "Background / Adventure Synopsis / Adventure Hook", 8: "Sweetwater Village Ruins / Phalin and Callia", 9: "Sweetwater Village Ruins / Trapdoor", 10: "Temple Catacombs / Rotted Pantry", 11: "Temple Catacombs / Room of Sorrow / Crypts", 12: "Temple Catacombs / Crypts / Putrid Moss / Treasure Room", 13: "Conclusion" };

function unitsForPage(page: DocumentPage, initialOrder: number): EvidenceUnit[] {
  const units: EvidenceUnit[] = [];
  const modelEnd = page.pageNumber === 11 && page.text.endsWith("T empl e Cat acombs Level 1")
    ? page.text.lastIndexOf("T empl e Cat acombs Level 1") : page.text.length;
  const headingSpans = sourceHeadings[page.pageNumber].map((label) => {
    const start = page.text.indexOf(label);
    if (start < 0 || (start > 0 && page.text[start - 1] !== "\n")) throw new Error(`Missing structural heading on page ${page.pageNumber}: ${label}`);
    return { start, end: start + label.length, label: label.replace(/\s+/gu, " ") };
  }).sort((a, b) => a.start - b.start);
  let section = page.pageNumber === 9 ? "Phalin and Callia" : page.pageNumber === 7 ? "Background" : page.pageNumber === 12 ? "[S3] The Crypts" : pageSection[page.pageNumber];
  function add(start: number, end: number, kind: EvidenceUnit["kind"]) {
    const part = page.text.slice(start, end);
    const left = part.search(/\S/u);
    if (left < 0) return;
    start += left;
    end = start + part.slice(left).trimEnd().length;
    const raw = page.text.slice(start, end);
    const normal = raw.replace(/\s+/gu, " ");
    units.push({ unitId: `p${page.pageNumber}.u${String(units.length + 1).padStart(3, "0")}`, segmentId: `p${page.pageNumber}`, page: page.pageNumber,
      kind, text: normal, rawSource: { page: page.pageNumber, start, end, text: raw }, context: section, order: initialOrder + units.length });
  }
  function sentences(start: number, end: number) {
    const block = page.text.slice(start, end);
    for (const match of block.matchAll(/[^.!?]+(?:[.!?]+|$)/gu)) add(start + (match.index ?? 0), start + (match.index ?? 0) + match[0].length, "sentence");
  }
  let cursor = /^\d+ [^\n]+\n/u.test(page.text) ? page.text.indexOf("\n") + 1 : 0;
  for (const heading of headingSpans) {
    sentences(cursor, heading.start);
    section = heading.label;
    add(heading.start, heading.end, "heading");
    cursor = heading.end;
  }
  sentences(cursor, modelEnd);
  return units;
}

export function planTest10Claims2(pages: DocumentPage[], inventory: GraphInventory) {
  if (pages.length !== TEST10_PAGES.length || pages.some((page, i) => page.pageNumber !== TEST10_PAGES[i])) throw new Error("Test 10 requires exactly physical PDF pages 6–13");
  // The production segment mapper cannot map this PDF's irregular extracted spacing.
  // Preserve the full raw page instead of normalizing away source characters.
  const context: ExtractionContext = { entities: inventory.entities.map((entity) => ({ canonicalId: entity.temporary_id, name: entity.name, type: entity.type, aliases: entity.aliases ?? [] })),
    sourceSegments: pages.map((page) => ({ segmentId: `p${page.pageNumber}`, page: page.pageNumber, semanticText: page.text,
      rawSource: { page: page.pageNumber, start: 0, end: page.text.length, text: page.text } })) };
  const evidenceUnits: EvidenceUnit[] = [];
  for (const page of pages) evidenceUnits.push(...unitsForPage(page, evidenceUnits.length));
  const request: Claims2Request = { requestId: "test10-sweetwater-claims2-v1-1", evidenceUnits, entities: context.entities };
  return { context, request };
}

export function test10Identity(args: { request: Claims2Request; fixtureHash: string; inventoryHash: string; contextFingerprint: string; modelId: string }) {
  const base = claims2CheckpointIdentity(args);
  return { ...base, campaignId: "test10-sweetwater-fixture", operationType: "test10_claims_2_experiment", upstreamFingerprint: sha256(JSON.stringify({ base: base.upstreamFingerprint, inventoryHash: args.inventoryHash, contextFingerprint: args.contextFingerprint, fixtureVersion: TEST10_FIXTURE_VERSION, inventoryVersion: TEST10_INVENTORY_VERSION })) };
}

export { extractionContextFingerprint };
