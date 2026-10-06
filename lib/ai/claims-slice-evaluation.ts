import { claims41OutputSchema, type Claims41Request, type Claims41Output } from "./claims-4-1-experiment";
import type { DocumentPage } from "../pdf/types";
import { reconcileClaims41DocumentV232 } from "./claims-4-1-reconciliation-v2-3-2";
import type { InventorySources } from "./claims-inventory-ambiguity";

/** Read-only evaluator for future saved slice output; never dispatches a model. */
export function evaluateClaimsSlice(request: Claims41Request, output: Claims41Output, pages: DocumentPage[], furnitureKeys: string[], inventorySources: InventorySources = new Map()) {
  claims41OutputSchema.parse(output);
  const units = new Map(request.evidenceUnits.map(u => [u.unitId, u]));
  const rawPages = new Map(pages.map(p => [p.pageNumber, p.text]));
  const invalidSourceUnits = request.evidenceUnits.filter(u => rawPages.get(u.page)?.slice(u.rawSource.start, u.rawSource.end) !== u.rawSource.text).map(u => u.unitId);
  const flags = output.claims.flatMap((c, proposalIndex) => {
    const problems: string[] = [];
    if (c.evidence_unit_ids.some(id => !units.has(id))) problems.push("unknown_evidence");
    if (c.evidence_unit_ids.some(id => units.get(id)?.kind === "heading")) problems.push("heading_as_direct_evidence");
    const statement = c.statement.toLowerCase().replace(/\s+/gu, " ");
    if (furnitureKeys.some(k => k.length >= 8 && statement.includes(k))) problems.push("possible_furniture_claim");
    return problems.length ? [{ proposalIndex, problems }] : [];
  });
  const result = reconcileClaims41DocumentV232(output, request, undefined, inventorySources);
  const sourceComparison = request.evidenceUnits.filter(u => u.kind === "sentence").map(u => ({
    unitId: u.unitId, page: u.page, context: u.context, sourceText: u.text,
    proposedClaimIndexes: output.claims.flatMap((c, i) => c.evidence_unit_ids.includes(u.unitId) ? [i] : []),
    humanAudit: "Assess useful fact coverage, qualifiers, attribution and invented lore against this source; no count target.",
  }));
  const contextChecks = result.claims.flatMap(c => {
    const contexts = c.original.evidence_unit_ids.map(id => units.get(id)?.context ?? "");
    const expected = contexts.some(s => /(?:^| > )day_\d+(?:$| > )/u.test(s)) ? "scheduled" :
      contexts.some(s => /rumou?r/u.test(s)) ? "rumor" : contexts.some(s => /random_/u.test(s)) ? "conditional" : null;
    return expected ? [{ proposalIndex: c.proposalIndex, expected, actual: c.sourceStatus, matches: c.sourceStatus === expected,
      note: "Human review must account for propositions that describe a plan, condition or the schedule itself." }] : [];
  });
  return { invalidSourceUnits, flags, sourceComparison, contextChecks, reconciliation: result,
    humanReviewRequired: ["important narrative facts", "physical referent versus adventure/title", "source qualifiers", "no invented lore"], modelCalls: 0, apiCalls: 0 };
}
