import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { blockReplayNetwork } from "./offline-network-guard";

async function main() {
  const networkAudit = blockReplayNetwork();
  const { sha256, verifyAcceptanceBundle } = await import("../lib/ai/claims-offline-replay");
  const { extractPdfPages } = await import("../lib/pdf/extract-text");
  const { cleanDocumentPagesForModel } = await import("../lib/pdf/model-text");
  const { buildClaimsEvidenceUnits, validateClaimsProvenance, packClaimsRequests } = await import("../lib/ai/claims-document-source");
  const { annotateSourceStructure } = await import("../lib/ai/claims-source-structure");
  const { normalizeClaimsInventoryV231 } = await import("../lib/ai/claims-inventory-normalization");
  const { serializeClaims41Request, claims41PromptHash, claims41SchemaHash, CLAIMS_4_1_PROMPT, claims41OutputSchema } = await import("../lib/ai/claims-4-1-experiment");
  const { z } = await import("zod");
  const pdf = "fixtures/private/narrative-dev/Tales_of_the_Demon_Lord_no_bkgd_v6-5-16 (1).pdf";
  const sourceHash = "07f3bda14d7375f3da6f008aa499bc0fe2ee90e7183e11f2a64eeeb96fdf3377";
  const target = resolve(process.argv[2] ?? "fixtures/private/tales-source-cleaning-v0613-v1");
  if (!target.startsWith(resolve("fixtures/private") + "\\") && !target.startsWith(resolve("fixtures/private") + "/")) throw new Error("Private output required");
  if (existsSync(target)) throw new Error("Refusing historical overwrite");
  const bytes = readFileSync(pdf); if (sha256(bytes) !== sourceHash) throw new Error("Source hash mismatch");
  const acceptance = verifyAcceptanceBundle("fixtures/private/tales-full-claims-acceptance-v1", "eb970869b2b54ea72d7a5a220a8120abda8b43fd6e6cd149337e1f699b399621");
  const raw = await extractPdfPages(bytes), snapshot = structuredClone(raw);
  // Instrument only the private baseline copy to expose the old removal reasons.
  const baselineCode = execFileSync("git", ["show", "935bab6:lib/pdf/model-text.ts"], { encoding: "utf8" });
  const instrumented = baselineCode.replace("let removedLineCount = 0;", "let removedLineCount = 0; const removedFragments: Array<{page:number;lineIndex:number;rawText:string;reason:string}> = [];")
    .replace("removedLineCount += 1; return", 'removedLineCount += 1; removedFragments.push({page:page.pageNumber,lineIndex:index,rawText:line,reason:barePageOrnament(line)?"page_ornament":headerIndexes.has(index)?"recurring_header":"recurring_footer"}); return')
    .replace("return { pages: cleaned, removedLineCount };", "return { pages: cleaned, removedLineCount, removedFragments };");
  mkdirSync(target);
  writeFileSync(join(target, "baseline-cleaner.ts"), instrumented, { flag: "wx" });
  const oldModule = await import(pathToFileURL(join(target, "baseline-cleaner.ts")).href);
  const old = oldModule.cleanDocumentPagesForModel(raw) as ReturnType<typeof cleanDocumentPagesForModel>;
  const current = cleanDocumentPagesForModel(raw);
  if (!isDeepStrictEqual(raw, snapshot) || !isDeepStrictEqual(raw.map(p => p.text), current.pages.map(p => p.text))) throw new Error("Raw source mutated");
  const oldUnits = buildClaimsEvidenceUnits(old.pages), oldStructure = annotateSourceStructure(oldUnits);
  const newUnits = buildClaimsEvidenceUnits(current.pages), structure = annotateSourceStructure(newUnits);
  const provenance = validateClaimsProvenance(structure.units, raw);
  const summary = (clean: typeof current, units: typeof newUnits, headings: typeof structure) => ({
    rawPages: raw.length, rawCharacters: raw.reduce((n, p) => n + p.text.length, 0), modelCharacters: clean.pages.reduce((n, p) => n + p.modelText!.length, 0),
    removedFragments: clean.removedLineCount, countsByReason: Object.fromEntries([...new Set(clean.removedFragments.map(f => f.reason))].map(reason => [reason, clean.removedFragments.filter(f => f.reason === reason).length])),
    evidenceUnits: units.length, structuralHeadings: headings.hierarchy.length, provenanceErrors: validateClaimsProvenance(units, raw).invalidProvenanceCount,
  });
  const compact = (s: string) => s.toLowerCase().replace(/\s+/gu, " ").trim();
  // Acceptance-only strings; production cleaner has no book/customer names.
  const book = "tales of the demon lord";
  const chapterKeys = ["city in shadow", "the curious case of the errant swine", "the moon spire", "in the name of love", "shadows in the mist", "off the rails", "prince of darkness", "the end is near"];
  const contamination = (units: typeof newUnits) => ({ bookTitle: units.filter(u => compact(u.text).includes(book) &&
    u.rawSource.text.split(/\r?\n/u).some(s => /^tales of the demon lord(?:\s+\d+)?$/u.test(compact(s)))).map(u => u.unitId),
    naturalBookMentions: units.filter(u => compact(u.text).includes(book) &&
      !u.rawSource.text.split(/\r?\n/u).some(s => /^tales of the demon lord(?:\s+\d+)?$/u.test(compact(s)))).map(u => u.unitId),
    watermark: units.filter(u => /\bOrder\s*#/iu.test(u.text)).map(u => u.unitId) });
  const bookFragments = (units: typeof newUnits) => units.filter(u => compact(u.text).includes(book)).reduce((n, u) => n +
    u.rawSource.text.split(/\r?\n/u).filter(s => /^tales of the demon lord(?:\s+\d+)?$/u.test(compact(s))).length, 0);
  if (contamination(newUnits).bookTitle.length || contamination(newUnits).watermark.length) throw new Error("Furniture remains in model evidence");
  const remainingOrnaments = current.pages.flatMap(p => p.modelText!.split(/\n\s*\n/u).filter(s => /^(?:page\s+)?\d+$/iu.test(s.trim())).map(text => ({ page: p.pageNumber, text })));
  if (remainingOrnaments.length) throw new Error("Standalone furniture ornament remains");
  const chapterRemovalAudit = current.removedFragments.filter(f => chapterKeys.some(k => compact(f.rawText).includes(k)));
  const expectedChapterFurniture = raw.flatMap(p => p.text.split(/\r?\n/u).flatMap((text, lineIndex, lines) => {
    const key = compact(text), matches = chapterKeys.some(k => key === k || key.startsWith(k + " ") && /Order\s*#/iu.test(text));
    const layer = lineIndex < 2 || [lineIndex - 5, lineIndex - 4, lineIndex - 3, lineIndex - 2, lineIndex - 1, lineIndex + 1, lineIndex + 2, lineIndex + 3, lineIndex + 4, lineIndex + 5]
      .some(i => i >= 0 && i < lines.length && (compact(lines[i]).startsWith(book) || /Order\s*#/iu.test(lines[i])));
    return matches && layer ? [{ page: p.pageNumber, lineIndex, text }] : [];
  }));
  if (expectedChapterFurniture.some(f => !current.removedFragments.some(r => r.page === f.page && r.lineIndex === f.lineIndex))) throw new Error("Expected recurring chapter layer survived");
  const furnitureOverlap = (units: typeof newUnits) => chapterRemovalAudit.filter(f => units.some(u => u.page === f.page &&
    u.rawSource.start < f.end && u.rawSource.end > f.start && compact(u.text).includes(compact(f.rawText)))).length;
  if (furnitureOverlap(newUnits)) throw new Error("Intrusive running chapter title remains in model evidence");
  if (current.removedFragments.some(f => newUnits.some(u => u.page === f.page && u.rawSource.start < f.end && u.rawSource.end > f.start))) throw new Error("Evidence crossed a removed layer");
  for (const f of current.removedFragments) if (raw.find(p => p.pageNumber === f.page)!.text.slice(f.start, f.end) !== f.rawText) throw new Error("Invalid removal offset");
  const page7 = current.pages.find(p => p.pageNumber === 7)!;
  for (const s of ["minor healing (4)", "cure (2)", "moderate healing (1)"]) if (!page7.modelText!.includes(s)) throw new Error(`Spell lost: ${s}`);
  if ((page7.modelText!.match(/Life minor healing/gu) ?? []).length !== 1) throw new Error("Duplicate spell overlay retained");
  const checks = {
    rumors: structure.units.some(u => u.page === 19 && /rumors/u.test(u.context)),
    days: [1, 2, 3].every(n => structure.units.some(u => u.page === 30 && u.context.includes(`day_${n}`))),
    random: structure.units.some(u => /random_/u.test(u.context)),
    runningTitleSuppressed: !structure.hierarchy.some(h => compact(h.text) === book),
    boundedStatblocks: !structure.units.some((u, i) => /^(?:magic|attack_options|special_actions)$/u.test(u.context) && structure.units[i + 1]?.context === u.context),
    hierarchy: structure.hierarchy.some(h => h.path.length > 1), rawUnchanged: true, page7SpellsPreserved: true, page7OverlayRemoved: true,
  };
  if (Object.values(checks).some(v => !v)) throw new Error(`Source structural assertion failed: ${JSON.stringify(checks)}`);
  const inventoryReview = acceptance.read<{ finalInventory: import("../lib/ai/entity-reconciliation").GraphInventory }>("inventory-review.v1.json");
  const normalized = normalizeClaimsInventoryV231(inventoryReview.finalInventory, structure.units);
  const inventoryHash = sha256(JSON.stringify(normalized.inventory));
  const slices = [{ id: "gibbering-fever-rumors", pages: [19, 20], purpose: "outbreak facts, source-labeled rumors and disease references" },
    { id: "moon-spire", pages: [21, 22], purpose: "tower establishment and physical coreferences versus adventure/title" },
    { id: "verge-days", pages: [29, 30], purpose: "Day 1/2/3 schedule, plans/conditions and random events" }].map(slice => {
      // Annotate each isolated slice independently, avoiding an unrelated heading
      // inherited from an excluded preceding page. Full-document inventory stays global.
      const sliceStructure = annotateSourceStructure(buildClaimsEvidenceUnits(current.pages.filter(p => slice.pages.includes(p.pageNumber))));
      const evidence = sliceStructure.units;
      const packed = packClaimsRequests(evidence, normalized.inventory, "gpt-6-luna", { target: 16000, maximum: 16000 });
      return { ...slice, structure: sliceStructure, evidence, requests: packed.requests, manifest: packed.manifest.map(p => ({ ...p, maxRetries: 0 })),
        contexts: [...new Set(evidence.map(u => u.context))], inventoryHash, futureCallCount: packed.requests.length,
        serialization: packed.requests.map(r => ({ requestId: r.requestId, ...serializeClaims41Request(r) })) };
    });
  const suspicious = (clean: typeof current) => clean.pages.flatMap(p => {
    const removed = new Set(clean.removedFragments.filter(f => f.page === p.pageNumber).map(f => f.lineIndex));
    const lines = p.text.split(/\r?\n/u);
    return lines.flatMap((s, i) => {
      const line = s.replace(/\s+/gu, " ").trim();
      return line.length >= 12 && !removed.has(i) && lines.some((other, j) => j !== i && !removed.has(j) && other.replace(/\s+/gu, " ").trim() === line) &&
        [i - 2, i - 1, i + 1, i + 2].some(j => removed.has(j)) ? [{ page: p.pageNumber, lineIndex: i, rawText: s, reason: "exact duplicate adjacent to a removed layer; requires human inspection" }] : [];
    });
  });
  const report = { sourceHash, baseline: "935bab6c24705e57789bc1a2aab5a48f6b84d664", baselineCleanerHash: sha256(baselineCode),
    old: { ...summary(old, oldUnits, oldStructure), contamination: { ...contamination(oldUnits), intrusiveBookFragments: bookFragments(oldUnits), intrusiveChapterFragments: furnitureOverlap(oldUnits) }, suspiciousDuplicateFragments: suspicious(old).length },
    current: { ...summary(current, newUnits, structure), contamination: { ...contamination(newUnits), intrusiveBookFragments: bookFragments(newUnits), intrusiveChapterFragments: furnitureOverlap(newUnits) }, suspiciousDuplicateFragments: suspicious(current).length },
    checks, provenance, inventoryEntities: normalized.inventory.entities.length, inventoryMerges: normalized.merges.length,
    inventoryHash, promptHash: claims41PromptHash(), schemaHash: claims41SchemaHash(), reconciliation: "claims-4-1-reconciliation-2.3.2",
    totalFutureCalls: slices.reduce((n, s) => n + s.futureCallCount, 0), modelIds: ["gpt-6-luna"], modelCalls: 0, apiCalls: networkAudit(),
    historicalClaimsReplayed: false, status: "prepared-not-authorized-or-executed" };
  if (report.promptHash !== "d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58" ||
    report.schemaHash !== "16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb") throw new Error("Frozen Claims hash changed");
  const artifacts: string[] = ["baseline-cleaner.ts"];
  const write = (file: string, value: unknown) => { writeFileSync(join(target, file), JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); artifacts.push(file); };
  write("raw-pages.v1.json", raw); write("old-cleaning.v1.json", old); write("new-cleaning.v1.json", current);
  write("old-structure.v1.json", oldStructure); write("new-structure.v1.json", structure);
  write("source-audit.v1.json", report); write("chapter-removals.v1.json", chapterRemovalAudit);
  write("remaining-duplicates.v1.json", { old: suspicious(old), current: suspicious(current) });
  write("page7-audit.v1.json", { old: old.pages.find(p => p.pageNumber === 7), current: page7, removed: current.removedFragments.filter(f => f.page === 7), units: structure.units.filter(u => u.page === 7) });
  write("glued-page-samples.v1.json", [3, 6, 19, 21, 23, 30].map(page => ({ page, old: old.pages.find(p => p.pageNumber === page), current: current.pages.find(p => p.pageNumber === page), removed: current.removedFragments.filter(f => f.page === page) })));
  write("global-inventory.v1.json", normalized); write("live-slice-plan.v1.json", slices);
  write("frozen-claims-contract.v1.json", { system: CLAIMS_4_1_PROMPT, schema: z.toJSONSchema(claims41OutputSchema), schemaName: "claims41_document_output", promptHash: report.promptHash, schemaHash: report.schemaHash });
  write("human-audit.v1.json", { required: ["outbreak facts covered", "source rumors remain rumors", "physical tower versus adventure identity", "Day 1/2/3 scheduled", "random events conditional", "no invalid provenance", "no heading direct evidence", "no furniture claims", "no invented lore"], sourceVsNewExtraction: true, oldClaimCountTargets: false, executorIncluded: false });
  const manifest = { classification: "private/local-only", sourceHash, artifacts: artifacts.map(path => {
    const bytes = readFileSync(join(target, path)); return { path, bytes: bytes.length, sha256: sha256(bytes) };
  }) };
  write("MANIFEST.json", manifest); write("MANIFEST.sha256.json", { sha256: sha256(readFileSync(join(target, "MANIFEST.json"))) });
  verifyAcceptanceBundle(target, sha256(readFileSync(join(target, "MANIFEST.json"))));
  console.log(JSON.stringify({ ...report, slices: slices.map(s => ({ id: s.id, pages: s.pages, requests: s.manifest })), manifestHash: sha256(readFileSync(join(target, "MANIFEST.json"))) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
