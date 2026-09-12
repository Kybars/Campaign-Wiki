import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXTRACTION_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { recallIdentityRules, recallReferenceEntities } from "../fixtures/recall-regression";

interface CrosswalkRow {
  test2: { id: string; name: string; type: string; normalized_name: string };
  test3: { name: string; type: string } | null;
  classification: string;
}

interface CrosswalkArtifact {
  generated_from: { model_calls: number; database_writes: number };
  source_comparison: {
    classification: string;
    page_rows: number;
    ordered_raw_text_sha256: string;
    ordered_normalized_text_sha256: string;
    equal_page_hashes: number;
  };
  summary: {
    test2_entities: number;
    test3_entities: number;
    test3_validated_candidates: number;
    test3_deterministic_groups: number;
    test3_canonical_entities: number;
    test2_classifications: Record<string, number>;
    test3_only_classifications: Record<string, number>;
  };
  test2_crosswalk: CrosswalkRow[];
  test3_only: Array<{ classification: string }>;
}

const artifact = JSON.parse(readFileSync(
  new URL("../docs/audits/test2_test3_entity_crosswalk.json", import.meta.url),
  "utf8",
)) as CrosswalkArtifact;

assert.equal(artifact.generated_from.model_calls, 0);
assert.equal(artifact.generated_from.database_writes, 0);
assert.equal(artifact.source_comparison.classification, "EQUIVALENT_CONTENT_WITH_FORMATTING_DIFFERENCES");
assert.equal(artifact.source_comparison.page_rows, 160);
assert.equal(artifact.source_comparison.equal_page_hashes, 160);
assert.equal(artifact.source_comparison.ordered_raw_text_sha256, "e19edeebb9511c277bf24bbca930767191d911d70d0704aeb1d50c3c7cd00a3a");
assert.equal(artifact.source_comparison.ordered_normalized_text_sha256, "4c6cdfd6a67e709d8310ac3673da3bc34920e81971cb54d47137bb2de239fe32");
assert.equal(artifact.summary.test2_entities, 156);
assert.equal(artifact.summary.test3_entities, 112);
assert.equal(artifact.summary.test3_validated_candidates, 202);
assert.equal(artifact.summary.test3_deterministic_groups, 118);
assert.equal(artifact.summary.test3_canonical_entities, 112);
assert.equal(artifact.test2_crosswalk.length, 156);
assert.equal(new Set(artifact.test2_crosswalk.map((row) => row.test2.id)).size, 156);
assert.equal(Object.values(artifact.summary.test2_classifications).reduce((total, count) => total + count, 0), 156);
assert.equal(Object.values(artifact.summary.test3_only_classifications).reduce((total, count) => total + count, 0), artifact.test3_only.length);
assert.equal(artifact.summary.test2_classifications.MATCHED_SAME_IDENTITY, 81);
assert.equal(artifact.summary.test2_classifications.MATCHED_RETYPED, 2);
assert.equal(artifact.summary.test2_classifications.MATCHED_RENAMED_OR_ALIAS, 15);
assert.equal(artifact.summary.test2_classifications.TEST2_DUPLICATE_CORRECTLY_REMOVED, 6);
assert.equal(artifact.summary.test2_classifications.MISSING_FROM_TEST3_EXTRACTION, 52);
assert.equal(artifact.summary.test2_classifications.PRESENT_IN_TEST3_CANDIDATES_BUT_LOST_IN_RECONCILIATION, 0);
assert.equal(artifact.summary.test2_classifications.AMBIGUOUS_REQUIRES_REVIEW, 0);
assert.match(EXTRACTION_SYSTEM_PROMPT, /Do not omit a clearly named, source-backed campaign entity/);
assert.match(EXTRACTION_SYSTEM_PROMPT, /check every supported entity category and every relationship endpoint/);

for (const reference of recallReferenceEntities) {
  const row = artifact.test2_crosswalk.find((candidate) =>
    candidate.test2.normalized_name === reference.name
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[’']/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  assert.ok(row, `Missing curated reference row for ${reference.name}`);
  assert.equal(row.classification === "MISSING_FROM_TEST3_EXTRACTION", reference.historicalTest3 === "missing");
  if (reference.historicalTest3 === "present") assert.equal(row.test3?.type, reference.expectedType);
  else assert.equal(row.test2.type, reference.expectedType);
}
for (const [left, right] of recallIdentityRules.mustRemainDistinct) {
  const leftRow = artifact.test2_crosswalk.find((row) => row.test2.normalized_name === left.toLocaleLowerCase("en-US"));
  const rightRow = artifact.test2_crosswalk.find((row) => row.test2.normalized_name === right.toLocaleLowerCase("en-US"));
  assert.ok(leftRow && rightRow && leftRow.test2.id !== rightRow.test2.id);
}
for (const rule of recallIdentityRules.mustMergeAndRetype) {
  const rows = artifact.test2_crosswalk.filter((row) => row.test2.name === rule.sourceName);
  assert.deepEqual(new Set(rows.map((row) => row.test2.type)), new Set(rule.sourceTypes));
  assert.equal(rows.filter((row) => row.classification === "MATCHED_RETYPED").length, 1);
  assert.equal(rows.filter((row) => row.classification === "TEST2_DUPLICATE_CORRECTLY_REMOVED").length, 1);
  assert.equal(rows.find((row) => row.test3)?.test3?.type, rule.canonicalType);
}
for (const rule of recallIdentityRules.mustMerge) {
  const rows = artifact.test2_crosswalk.filter((row) => rule.sourceNames.includes(row.test2.name as never));
  assert.equal(rows.length, rule.sourceNames.length);
  assert.equal(rows.filter((row) => row.classification === "TEST2_DUPLICATE_CORRECTLY_REMOVED").length, 1);
  assert.equal(rows.find((row) => row.test3)?.test3?.name, rule.canonicalName);
}

console.log(JSON.stringify({
  evaluation: "Test 2/Test 3 frozen recall crosswalk",
  modelCalls: 0,
  databaseReads: 0,
  databaseWrites: 0,
  test2Entities: artifact.summary.test2_entities,
  recalledTest2Identities: 98,
  missingFromTest3Extraction: artifact.summary.test2_classifications.MISSING_FROM_TEST3_EXTRACTION,
  lostInReconciliation: artifact.summary.test2_classifications.PRESENT_IN_TEST3_CANDIDATES_BUT_LOST_IN_RECONCILIATION,
  test3CanonicalEntities: artifact.summary.test3_canonical_entities,
  promptRecallGuard: "PASS",
  curatedReferenceEntities: recallReferenceEntities.length,
  curatedHistoricallyMissing: recallReferenceEntities.filter((entity) => entity.historicalTest3 === "missing").length,
  sourceTextModelEvaluation: "requires an explicitly authorized inference run",
  result: "PASS",
}, null, 2));
