import type { DocumentPage } from "../pdf/types";
import { pageTextForModel } from "../pdf/model-text";
import { rawSliceForSemantic } from "../pdf/source-mapping";
import type { EvidenceUnit } from "./claims-2-experiment";
import type { GraphInventory } from "./entity-reconciliation";
import { HEROES } from "./claims-3-experiment";
import { planClaims41Request, serializeClaims41Request, CLAIMS_4_1_PROMPT, claims41OutputSchema, type Claims41Request } from "./claims-4-1-experiment";
import { semanticInputHash } from "./operation-checkpoint";
import { z } from "zod";

export const CLAIMS_DOCUMENT_VERSION = "claims-document-1";
export const CLAIMS_DOCUMENT_MODEL = "gpt-6-luna";
export const CLAIMS_INPUT_TARGET = 12_000;
export const CLAIMS_INPUT_MAXIMUM = 16_000;
export const CLAIMS_OUTPUT_CAP = 24_000;
export const INVENTORY_OUTPUT_CAP = 12_000;
export const COMPLETENESS_OUTPUT_CAP = 12_000;

export function assertClaimsDocumentModel(model: string) {
  if (model !== CLAIMS_DOCUMENT_MODEL) throw new Error("All document stages require gpt-6-luna");
}

export function assertDocumentModelPolicy(plans: Array<{ modelId: string }>) {
  const distinct = [...new Set(plans.map((plan) => plan.modelId))].sort();
  if (JSON.stringify(distinct) !== JSON.stringify([CLAIMS_DOCUMENT_MODEL])) throw new Error("Distinct planned model IDs must equal [gpt-6-luna]");
  return distinct;
}

/** Only explicit heading markup or short all-capital paragraphs are certain enough.
 * Everything else remains claim-bearing prose, including unknown participants. */
function isHeading(text: string) {
  return text.length <= 100 && (/^#{1,6}\s+\S/u.test(text) ||
    /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text) &&
    (/^[\p{L}\s'’—–-]+$/u.test(text) || /^(?:PART|CHAPTER|SECTION|APPENDIX)\s+[\dIVX]+[:. -]\s*[\p{L}\s'’—–-]+$/u.test(text)));
}

export function buildClaimsEvidenceUnits(pages: DocumentPage[]): EvidenceUnit[] {
  if (pages.some((page, index) => !Number.isInteger(page.pageNumber) || page.pageNumber < 1 ||
    index > 0 && page.pageNumber <= pages[index - 1].pageNumber)) throw new Error("Pages must be in unique source order");
  const units: EvidenceUnit[] = [];
  let context = "main";
  for (const page of pages) {
    let searchFrom = 0;
    // Cleaning joins PDF lines. Recover only confident standalone raw headings
    // still present in the cleaned stream, without changing page extraction.
    const headings = [...new Set(page.text.split(/\r?\n/u).map((text) => text.replace(/\s+/gu, " ").trim()).filter(isHeading))];
    const paragraphs = pageTextForModel(page).split(/\n\s*\n/gu).map((text) => text.replace(/\s+/gu, " ").trim()).filter(Boolean);
    for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
      const boundaries: Array<{ start: number; end: number; text: string; heading: boolean }> = [];
      for (const heading of headings) {
        let from = 0;
        while (from < paragraph.length) {
          const at = paragraph.indexOf(heading, from);
          if (at < 0) break;
          if ((at === 0 || paragraph[at - 1] === " ") && (at + heading.length === paragraph.length || paragraph[at + heading.length] === " "))
            boundaries.push({ start: at, end: at + heading.length, text: heading, heading: true });
          from = at + heading.length;
        }
      }
      boundaries.sort((a, b) => a.start - b.start || b.end - a.end);
      const runs: Array<{ text: string; heading: boolean }> = [];
      let cursor = 0;
      for (const boundary of boundaries) {
        if (boundary.start < cursor) continue;
        const preceding = paragraph.slice(cursor, boundary.start).trim();
        if (preceding) runs.push({ text: preceding, heading: false });
        runs.push(boundary); cursor = boundary.end;
      }
      const tail = paragraph.slice(cursor).trim();
      if (tail) runs.push({ text: tail, heading: isHeading(tail) && cursor === 0 });
      // Intl sentence segmentation preserves punctuation-only tails and abbreviations.
      const pieces = runs.flatMap((run) => run.heading ? [run] :
        [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(run.text)].map((part) => ({ text: part.segment.trim(), heading: false })).filter((part) => part.text));
      for (const [pieceIndex, { text, heading }] of pieces.entries()) {
        if (heading) context = text.replace(/^#{1,6}\s+/u, "");
        const mapped = rawSliceForSemantic(page.text, text, searchFrom);
        searchFrom = mapped.nextSearch;
        units.push({ unitId: `u-${page.pageNumber}-${paragraphIndex + 1}-${pieceIndex + 1}`,
          segmentId: `p-${page.pageNumber}-${paragraphIndex + 1}`, page: page.pageNumber,
          kind: heading ? "heading" : "sentence", text, context, order: units.length,
          rawSource: { page: page.pageNumber, start: mapped.rawStart, end: mapped.rawEnd, text: mapped.rawSlice } });
      }
    }
  }
  validateClaimsProvenance(units, pages);
  return units;
}

export function validateClaimsProvenance(units: EvidenceUnit[], pages: DocumentPage[]) {
  const byPage = new Map(pages.map((page) => [page.pageNumber, page]));
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) throw new Error("Duplicate evidence ID");
  for (const [index, unit] of units.entries()) {
    const raw = unit.rawSource;
    if (unit.order !== index || unit.page !== raw.page || raw.start < 0 || raw.end <= raw.start ||
      byPage.get(unit.page)?.text.slice(raw.start, raw.end) !== raw.text) throw new Error("Invalid evidence provenance/order");
  }
  return { verifiedUnits: units.length, invalidProvenanceCount: 0 };
}

export function documentClaimsRequest(units: EvidenceUnit[], inventory: GraphInventory, requestId: string): Claims41Request {
  const entities = inventory.entities.map((entity) => ({ canonicalId: entity.temporary_id, name: entity.name, type: entity.type, aliases: entity.aliases ?? [] }));
  if (entities.some((entity) => entity.canonicalId === HEROES.canonicalId)) throw new Error("Inventory collides with permanent Heroes identity");
  return planClaims41Request({ requestId, baselineRequestId: requestId, evidenceUnits: units, entities: [...entities, structuredClone(HEROES)] });
}

export function estimateClaimsInput(request: Claims41Request) {
  return Math.ceil((CLAIMS_4_1_PROMPT.length + serializeClaims41Request(request).payload.length +
    JSON.stringify(z.toJSONSchema(claims41OutputSchema)).length) / 4);
}

export function packClaimsRequests(units: EvidenceUnit[], inventory: GraphInventory, model = CLAIMS_DOCUMENT_MODEL,
  bounds = { target: CLAIMS_INPUT_TARGET, maximum: CLAIMS_INPUT_MAXIMUM }) {
  assertClaimsDocumentModel(model);
  if (bounds.target < 1 || bounds.maximum < bounds.target) throw new Error("Invalid Claims input bounds");
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length || units.some((unit, index) => unit.order !== index)) throw new Error("Invalid global unit order/IDs");
  const requests: Claims41Request[] = [];
  let current: EvidenceUnit[] = [];
  const make = (items: EvidenceUnit[]) => documentClaimsRequest(items, inventory,
    `claims4-1-doc-${String(requests.length + 1).padStart(4, "0")}-${semanticInputHash({ units: items, inventory }).slice(0, 12)}`);
  const flush = () => { if (current.length) { requests.push(make(current)); current = []; } };
  for (const unit of units) {
    if (estimateClaimsInput(make([unit])) > bounds.maximum) throw new Error(`Indivisible evidence/inventory exceeds hard input bound: ${unit.unitId}`);
    if (current.length && estimateClaimsInput(make([...current, unit])) > bounds.target) flush();
    current.push(unit);
  }
  flush();
  const ownership = requests.flatMap((request) => request.evidenceUnits.map((unit) => ({ unitId: unit.unitId, requestId: request.requestId, primary: unit.kind === "sentence" })));
  if (ownership.length !== units.length || new Set(ownership.map((item) => item.unitId)).size !== units.length ||
    ownership.some((item, index) => item.unitId !== units[index].unitId)) throw new Error("Claims ownership mismatch");
  return { requests, ownership, manifest: requests.map((request) => ({ requestId: request.requestId, modelId: model,
    estimatedInputTokens: estimateClaimsInput(request), maxOutputTokens: CLAIMS_OUTPUT_CAP,
    primaryUnitIds: request.evidenceUnits.filter((unit) => unit.kind === "sentence").map((unit) => unit.unitId),
    contextUnitIds: request.evidenceUnits.filter((unit) => unit.kind === "heading").map((unit) => unit.unitId) })) };
}
