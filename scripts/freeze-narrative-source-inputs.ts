import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanReadingPages } from "../lib/pdf/reading-source";

const root = join(process.cwd(), "fixtures", "private", "narrative-dev");
const tournament = join(root, "tournament");
const savedPath = join(tournament, "paid-progress-narrative-adaptive-5.json");
const frozenPath = join(root, "cleaned-source-inputs-v1.json");
const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

const source = JSON.parse(readFileSync(join(root, "campaign_wiki_DEV_source.json"), "utf8")) as {
  samples: Array<{ code: string; selectedPages: number[] }>;
};
const plan = JSON.parse(readFileSync(join(tournament, "plan.json"), "utf8")) as {
  sampleInputHashes: Array<{ sample: string; rawPageHash: string }>;
};
const savedBytes = readFileSync(savedPath);
const saved = JSON.parse(savedBytes.toString("utf8")) as {
  checkpoints: Array<{ key: string; validationSourcePages?: Array<{ physicalPdfPage: number; text: string }> }>;
};
const runningLines: Record<string, string[]> = {
  SW: [],
  WOTBS: ["War of the Burning Sky Campaign Guide • Campaign Saga Overview"],
  TALES: ["tales of the demon lord", "in the name of love", "in the name of love in the name of love in the name of love"],
};

const samples = source.samples.map(sample => {
  const checkpoint = saved.checkpoints.find(item => item.key === `extract:narrative_first:${sample.code}`);
  const rawPages = checkpoint?.validationSourcePages;
  if (!rawPages || JSON.stringify(rawPages.map(page => page.physicalPdfPage)) !== JSON.stringify(sample.selectedPages)) {
    throw new Error(`Saved raw physical pages do not match the selected window: ${sample.code}`);
  }
  const rawPageHash = hash(JSON.stringify(rawPages));
  if (plan.sampleInputHashes.find(item => item.sample === sample.code)?.rawPageHash !== rawPageHash) {
    throw new Error(`Saved raw pages differ from the original input identity: ${sample.code}`);
  }
  const pages = cleanReadingPages(rawPages.map(page => ({ pageNumber: page.physicalPdfPage, text: page.text })), runningLines[sample.code]);
  for (const page of pages) {
    let priorRawEnd = 0;
    for (const passage of page.passages) {
      const rawLine = page.rawText.slice(passage.rawStart, passage.rawEnd);
      if (page.text.slice(passage.cleanStart, passage.cleanEnd) !== passage.text
        || !rawLine || rawLine.includes("\n") || passage.rawStart < priorRawEnd) {
        throw new Error(`Unmapped passage on physical page ${page.pageNumber}`);
      }
      priorRawEnd = passage.rawEnd;
    }
  }
  const sourcePayload = `SOURCE PAGES\n\n${pages.map(page => `<campaign-page number="${page.pageNumber}">\n${page.text}\n</campaign-page>`).join("\n\n")}`;
  return {
    sample: sample.code,
    selectedPages: sample.selectedPages,
    rawPageHash,
    sourcePayloadHash: hash(sourcePayload),
    sourcePayload,
    pages: pages.map(page => ({
      physicalPdfPage: page.pageNumber,
      rawText: page.rawText,
      rawTextHash: hash(page.rawText),
      text: page.text,
      passages: page.passages,
      removedLines: page.removedLines,
    })),
  };
});
const frozen = {
  version: "narrative-cleaned-inputs-1",
  sourceCheckpointSha256: hash(savedBytes),
  cleanerSha256: hash(readFileSync(join(process.cwd(), "lib", "pdf", "reading-source.ts"))),
  groundingSha256: hash(readFileSync(join(process.cwd(), "lib", "ai", "narrative-tournament.ts"))),
  verbatimVerifierSha256: hash(readFileSync(join(process.cwd(), "lib", "ai", "graph-extraction.ts"))),
  validation: "Original PDF.js page text; no cleaned quote is accepted as verbatim evidence.",
  samples,
};
writeFileSync(frozenPath, `${JSON.stringify(frozen, null, 2)}\n`);
console.log(JSON.stringify({ path: frozenPath, samples: samples.map(({ sample, selectedPages, rawPageHash, sourcePayloadHash, pages }) => ({
  sample, selectedPages, rawPageHash, sourcePayloadHash,
  removedLines: pages.reduce((sum, page) => sum + page.removedLines.length, 0),
  passages: pages.reduce((sum, page) => sum + page.passages.length, 0),
})) }));
