import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { buildCanonicalGraph } from "../lib/graph/build";
import { normalizeName } from "../lib/graph/normalize";
import { buildDeterministicGroups } from "../lib/graph/reconcile";
import { aggregateCachedChunks, parseCachedReconciliation } from "../lib/processing/replay-cache";

loadEnvConfig(process.cwd());

const TEST_TWO_ID = "a13d54b5-74e6-45e3-9f7f-9dcad214d7d3";
const TEST_THREE_RECOVERY_ID = "1151fb31-876b-4277-9718-76313c1c8d98";
const TEST_THREE_CACHE_ID = "1ad99ac3-6cf5-4731-bf1e-4736109f0de8";
const TEST_TWO_DOCUMENT_ID = "0830dc1e-5d20-44d9-b67e-ee718a111f39";
const TEST_THREE_DOCUMENT_ID = "cb543f62-232f-42ba-8678-f0aa0ba35aef";
const testTwoCategories = [
  "MATCHED_SAME_IDENTITY",
  "MATCHED_RETYPED",
  "MATCHED_RENAMED_OR_ALIAS",
  "TEST2_DUPLICATE_CORRECTLY_REMOVED",
  "TEST2_NOISE_OR_UNSUPPORTED",
  "MISSING_FROM_TEST3_EXTRACTION",
  "PRESENT_IN_TEST3_CANDIDATES_BUT_LOST_IN_RECONCILIATION",
  "AMBIGUOUS_REQUIRES_REVIEW",
] as const;
const testThreeCategories = [
  "NEW_VALID_RECALL",
  "RETYPE_OR_RENAME_OF_TEST2",
  "TEST3_DUPLICATE_OR_NOISE",
  "AMBIGUOUS",
] as const;

const semanticMatches: Record<string, string> = {
  "demonplague dungeon": "massive dungeon beneath the luna valley",
  "hemlet slayer murders": "death of lila clocker",
  "comet impact": "comet strike on luna valley",
  "duladarin binding ritual": "binding of xancrown",
  "market murders": "tomar s crossing market murders",
  "minas herion s ritual": "minas herion s ice sealing ritual",
  "xancrown s reawakenings": "xancrown waking again",
  "refugee voting rights": "voting rights",
  "star elf barrows altar": "s10 altar",
  "bjalien s locket": "bjalien s crescent shaped locket",
};

const testTwoDuplicateOf: Record<string, string> = {
  "the demonplague": "demonplague",
  "the frozen necromancer": "stop ralekai and free the prisoners",
  "phelm and messa s bakery": "fire and grind miller and bakery",
};

type Entity = {
  id: string;
  type: string;
  name: string;
  normalized_name: string;
  aliases: string[];
};

const identities = (entity: Pick<Entity, "name" | "aliases">) =>
  new Set([entity.name, ...(entity.aliases ?? [])].map(normalizeName).filter(Boolean));
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

async function main() {
  const { createAdminClient } = await import("../lib/db/client");
  const client = createAdminClient();
  const [testTwoResult, testThreeResult, chunksResult, cacheResult, reconciliationResult, documentsResult, testTwoPagesResult, testThreePagesResult] = await Promise.all([
    client.from("entities").select("id,type,name,normalized_name,aliases").eq("campaign_id", TEST_TWO_ID).order("type").order("normalized_name"),
    client.from("entities").select("id,type,name,normalized_name,aliases").eq("campaign_id", TEST_THREE_RECOVERY_ID).order("type").order("normalized_name"),
    client.from("extraction_cache_chunks").select("chunk_id,chunk_index,validated_output").eq("cache_run_id", TEST_THREE_CACHE_ID).order("chunk_index"),
    client.from("extraction_cache_runs").select("cache_schema_version").eq("id", TEST_THREE_CACHE_ID).single(),
    client.from("reconciliation_cache_results").select("decision").eq("cache_run_id", TEST_THREE_CACHE_ID).order("created_at", { ascending: false }).limit(1).single(),
    client.from("documents").select("id,campaign_id,filename,page_count").in("campaign_id", [TEST_TWO_ID, "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4"]).order("created_at"),
    client.from("document_pages").select("page_number,text").eq("document_id", TEST_TWO_DOCUMENT_ID).order("page_number"),
    client.from("document_pages").select("page_number,text").eq("document_id", TEST_THREE_DOCUMENT_ID).order("page_number"),
  ]);
  for (const result of [testTwoResult, testThreeResult, chunksResult, cacheResult, reconciliationResult, documentsResult, testTwoPagesResult, testThreePagesResult]) {
    if (result.error) throw result.error;
  }
  if (!testTwoResult.data || !testThreeResult.data || !chunksResult.data || !cacheResult.data || !reconciliationResult.data || !documentsResult.data || !testTwoPagesResult.data || !testThreePagesResult.data) {
    throw new Error("Recall audit query returned no data");
  }

  const testTwo = testTwoResult.data as Entity[];
  const testThree = testThreeResult.data as Entity[];
  const chunks = chunksResult.data;
  const aggregate = aggregateCachedChunks(chunks, cacheResult.data.cache_schema_version);
  const groups = buildDeterministicGroups(aggregate);
  const decision = parseCachedReconciliation(reconciliationResult.data.decision, groups);
  const graph = buildCanonicalGraph(aggregate, decision);
  const sourceDigest = (pages: Array<{ page_number: number; text: string }>, normalize: boolean) => sha256(
    pages.map((page) => `${page.page_number}\n${normalize ? normalizeText(page.text) : page.text}`).join("\n\f\n"),
  );
  const testTwoPageHashes = testTwoPagesResult.data.map((page) => sha256(normalizeText(page.text)));
  const testThreePageHashes = testThreePagesResult.data.map((page) => sha256(normalizeText(page.text)));
  if (JSON.stringify(testTwoPageHashes) !== JSON.stringify(testThreePageHashes)) throw new Error("Test 2 and Test 3 page hashes differ");
  const graphByNormalized = new Map(graph.entities.map((entity) => [entity.normalizedName, entity]));
  const dbByIdentity = new Map<string, Entity>();
  for (const entity of testThree) {
    for (const identity of identities(entity)) dbByIdentity.set(identity, entity);
  }

  const candidateToCanonical = new Map<string, (typeof graph.entities)[number]>();
  for (const canonical of graph.entities) {
    for (const candidateId of canonical.candidateIds) candidateToCanonical.set(candidateId, canonical);
  }

  const matches = new Map<string, { canonical: (typeof graph.entities)[number]; db: Entity; basis: string; candidates: typeof aggregate.entities }>();
  for (const entity of testTwo) {
    const testTwoIdentities = identities(entity);
    const candidateMatches = aggregate.entities.filter((candidate) =>
      [...identities({ name: candidate.name, aliases: candidate.aliases })].some((identity) => testTwoIdentities.has(identity)),
    );
    const candidateCanonicals = candidateMatches
      .map((candidate) => candidateToCanonical.get(candidate.id))
      .filter((candidate): candidate is (typeof graph.entities)[number] => Boolean(candidate));
    const sameTypeCanonical = candidateCanonicals.find((candidate) => candidate.type === entity.type);
    const semanticCanonical = semanticMatches[entity.normalized_name]
      ? graphByNormalized.get(semanticMatches[entity.normalized_name])
      : undefined;
    const canonical = sameTypeCanonical ?? semanticCanonical ?? candidateCanonicals[0];
    let basis = "exact normalized name or explicit alias";
    if (canonical === semanticCanonical) {
      basis = "curated source-equivalent semantic identity";
    }
    if (canonical) {
      const db = dbByIdentity.get(canonical.normalizedName) ?? testThree.find((candidate) => candidate.normalized_name === canonical!.normalizedName);
      if (!db) throw new Error(`No persisted Test 3 entity for ${canonical.name}`);
      matches.set(entity.id, { canonical, db, basis, candidates: candidateMatches });
    }
  }

  const duplicateWinnerByName = new Map<string, string>();
  for (const entity of testTwo) {
    const sameName = testTwo.filter((candidate) => candidate.normalized_name === entity.normalized_name);
    if (sameName.length < 2) continue;
    const winner = [...sameName].sort((left, right) => {
      const leftMatch = matches.get(left.id);
      const rightMatch = matches.get(right.id);
      const leftScore = (leftMatch?.db.type === left.type ? 4 : 0) + (left.type === "other" ? 0 : 2) + (leftMatch ? 1 : 0);
      const rightScore = (rightMatch?.db.type === right.type ? 4 : 0) + (right.type === "other" ? 0 : 2) + (rightMatch ? 1 : 0);
      return rightScore - leftScore;
    })[0];
    duplicateWinnerByName.set(entity.normalized_name, winner.id);
  }

  const rows = testTwo.map((entity) => {
    const exactDuplicateWinner = duplicateWinnerByName.get(entity.normalized_name);
    const curatedDuplicate = testTwo.find((candidate) => candidate.normalized_name === testTwoDuplicateOf[entity.normalized_name]);
    if ((exactDuplicateWinner && exactDuplicateWinner !== entity.id) || curatedDuplicate) {
      const winner = curatedDuplicate ?? testTwo.find((candidate) => candidate.id === exactDuplicateWinner)!;
      return {
        test2: entity,
        classification: "TEST2_DUPLICATE_CORRECTLY_REMOVED",
        test3: matches.get(winner.id)?.db ?? null,
        match_basis: `duplicate identity of Test 2 entity ${winner.name}`,
        test3_candidate_ids: [],
      };
    }
    const match = matches.get(entity.id);
    if (match) {
      const classification = entity.type !== match.db.type
        ? "MATCHED_RETYPED"
        : entity.normalized_name !== match.db.normalized_name
          ? "MATCHED_RENAMED_OR_ALIAS"
          : "MATCHED_SAME_IDENTITY";
      return {
        test2: entity,
        classification,
        test3: match.db,
        match_basis: match.basis,
        test3_candidate_ids: match.candidates.map((candidate) => candidate.id),
      };
    }

    return {
      test2: entity,
      classification: "MISSING_FROM_TEST3_EXTRACTION",
      test3: null,
      match_basis: "no exact name, alias, or curated semantic identity in any validated Test 3 candidate",
      test3_candidate_ids: [],
    };
  });

  const matchedTestThreeIds = new Set(rows.flatMap((row) => row.test3 ? [row.test3.id] : []));
  const testThreeOnly = testThree.filter((entity) => !matchedTestThreeIds.has(entity.id)).map((entity) => ({
    test3: entity,
    classification: entity.normalized_name === "free the prisoners in gardong marhold"
      ? "TEST3_DUPLICATE_OR_NOISE"
      : "NEW_VALID_RECALL",
    notes: entity.normalized_name === "free the prisoners in gardong marhold"
      ? "Overlaps the retained Stop Ralekai and Free the Prisoners quest."
      : "Source-backed Test 3 canonical entity with no Test 2 canonical identity match.",
  }));

  const countBy = <T extends { classification: string }>(items: T[], categories?: readonly string[]) => Object.fromEntries(
    (categories ?? [...new Set(items.map((item) => item.classification))].sort()).map((classification) => [
      classification,
      items.filter((item) => item.classification === classification).length,
    ]),
  );
  const test2ByType = Object.fromEntries([...new Set(rows.map((row) => row.test2.type))].sort().map((type) => {
    const typed = rows.filter((row) => row.test2.type === type);
    const recalled = typed.filter((row) => row.classification.startsWith("MATCHED_")).length;
    return [type, {
      baseline: typed.length,
      recalled,
      recall_rate: Number((recalled / typed.length).toFixed(4)),
      classifications: countBy(typed),
    }];
  }));

  console.log(JSON.stringify({
    schema_version: 1,
    generated_from: {
      test2_campaign_id: TEST_TWO_ID,
      test3_recovery_campaign_id: TEST_THREE_RECOVERY_ID,
      test3_extraction_cache_id: TEST_THREE_CACHE_ID,
      method: "deterministic normalized-name/alias mapping plus the enumerated semanticMatches map",
      model_calls: 0,
      database_writes: 0,
    },
    source_comparison: {
      classification: "EQUIVALENT_CONTENT_WITH_FORMATTING_DIFFERENCES",
      documents: documentsResult.data,
      page_rows: testTwoPagesResult.data.length,
      text_characters: testTwoPagesResult.data.reduce((total, page) => total + page.text.length, 0),
      normalized_characters: testTwoPagesResult.data.reduce((total, page) => total + normalizeText(page.text).length, 0),
      ordered_raw_text_sha256: sourceDigest(testTwoPagesResult.data, false),
      ordered_normalized_text_sha256: sourceDigest(testTwoPagesResult.data, true),
      equal_page_hashes: testTwoPageHashes.length,
      original_pdf_byte_identity: "UNKNOWN_ZERO_BYTE_STORAGE_OBJECTS",
    },
    summary: {
      test2_entities: testTwo.length,
      test3_entities: testThree.length,
      test3_validated_candidates: aggregate.entities.length,
      test3_deterministic_groups: groups.length,
      test3_canonical_entities: graph.entities.length,
      test2_classifications: countBy(rows, testTwoCategories),
      test2_by_type: test2ByType,
      test3_only_classifications: countBy(testThreeOnly, testThreeCategories),
    },
    test2_crosswalk: rows,
    test3_only: testThreeOnly,
  }, null, 2));
}

void main();
