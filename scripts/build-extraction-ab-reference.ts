import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { normalizeName } from "../lib/graph/normalize";

loadEnvConfig(process.cwd());

const TEST_THREE_CACHE_ID = "1ad99ac3-6cf5-4731-bf1e-4736109f0de8";
const selectedChunkNumbers = [3, 5, 4] as const;

interface CrosswalkRow {
  test2: { id: string; name: string; type: string; aliases: string[] };
  test3: { id: string; name: string; type: string; aliases: string[] } | null;
  classification: string;
}

interface Crosswalk {
  test2_crosswalk: CrosswalkRow[];
  test3_only: Array<{
    test3: { id: string; name: string; type: string; aliases: string[] };
    classification: string;
  }>;
}

interface SourceRow {
  entity_id: string;
  page_number: number | null;
  supporting_text: string | null;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const crosswalk = JSON.parse(readFileSync(
    new URL("../docs/audits/test2_test3_entity_crosswalk.json", import.meta.url),
    "utf8",
  )) as Crosswalk;
  const { createAdminClient } = await import("../lib/db/client");
  const client = createAdminClient();
  const [chunksResult, testTwoSourcesResult, testThreeSourcesResult] = await Promise.all([
    client.from("extraction_cache_chunks")
      .select("chunk_id,chunk_index,page_numbers,validated_output")
      .eq("cache_run_id", TEST_THREE_CACHE_ID)
      .order("chunk_index"),
    client.from("entity_sources").select("entity_id,page_number,supporting_text")
      .in("entity_id", crosswalk.test2_crosswalk.map((row) => row.test2.id)),
    client.from("entity_sources").select("entity_id,page_number,supporting_text")
      .in("entity_id", crosswalk.test3_only.map((row) => row.test3.id)),
  ]);
  for (const result of [chunksResult, testTwoSourcesResult, testThreeSourcesResult]) {
    if (result.error) throw result.error;
  }
  if (!chunksResult.data || !testTwoSourcesResult.data || !testThreeSourcesResult.data) throw new Error("Reference query returned no data");

  const selected = selectedChunkNumbers.map((chunkNumber) => {
    const chunk = chunksResult.data.find((candidate) => candidate.chunk_index + 1 === chunkNumber);
    if (!chunk) throw new Error(`Missing cached chunk ${chunkNumber}`);
    const pageSet = new Set(chunk.page_numbers);
    const historical = chunk.validated_output as {
      entities: Array<{ facts?: unknown[] }>;
      relationships: unknown[];
    };
    const referenceByIdentity = new Map<string, {
      name: string;
      reference_type: string;
      acceptable_aliases: string[];
      evidence: Array<{ page_number: number; supporting_text: string }>;
      historically_missed: boolean;
      reference_origin: string;
    }>();

    for (const row of crosswalk.test2_crosswalk) {
      if (["TEST2_DUPLICATE_CORRECTLY_REMOVED", "TEST2_NOISE_OR_UNSUPPORTED", "AMBIGUOUS_REQUIRES_REVIEW"].includes(row.classification)) continue;
      const evidence = (testTwoSourcesResult.data as SourceRow[]).filter((source) =>
        source.entity_id === row.test2.id && source.page_number !== null && source.supporting_text !== null && pageSet.has(source.page_number),
      ).map((source) => ({ page_number: source.page_number!, supporting_text: source.supporting_text! }));
      if (evidence.length === 0) continue;
      const resolved = row.test3 ?? row.test2;
      const key = `${resolved.type}:${normalizeName(resolved.name)}`;
      const existing = referenceByIdentity.get(key);
      referenceByIdentity.set(key, {
        name: resolved.name,
        reference_type: resolved.type,
        acceptable_aliases: [...new Set([...(existing?.acceptable_aliases ?? []), row.test2.name, ...row.test2.aliases, ...(row.test3?.aliases ?? [])])],
        evidence: [...(existing?.evidence ?? []), ...evidence],
        historically_missed: row.classification === "MISSING_FROM_TEST3_EXTRACTION",
        reference_origin: "audited Test 2 crosswalk",
      });
    }

    for (const row of crosswalk.test3_only.filter((candidate) => candidate.classification === "NEW_VALID_RECALL")) {
      const evidence = (testThreeSourcesResult.data as SourceRow[]).filter((source) =>
        source.entity_id === row.test3.id && source.page_number !== null && source.supporting_text !== null && pageSet.has(source.page_number),
      ).map((source) => ({ page_number: source.page_number!, supporting_text: source.supporting_text! }));
      if (evidence.length === 0) continue;
      const key = `${row.test3.type}:${normalizeName(row.test3.name)}`;
      if (!referenceByIdentity.has(key)) referenceByIdentity.set(key, {
        name: row.test3.name,
        reference_type: row.test3.type,
        acceptable_aliases: row.test3.aliases,
        evidence,
        historically_missed: false,
        reference_origin: "audited Test 3-only valid identity",
      });
    }

    const references = [...referenceByIdentity.values()].sort((left, right) =>
      left.reference_type.localeCompare(right.reference_type) || left.name.localeCompare(right.name),
    );
    const misses = references.filter((reference) => reference.historically_missed);
    return {
      chunk_number: chunkNumber,
      chunk_id: chunk.chunk_id,
      page_range: [Math.min(...chunk.page_numbers), Math.max(...chunk.page_numbers)],
      page_numbers: chunk.page_numbers,
      normalized_source_text_sha256: "",
      source_characters: 0,
      historical_test3: {
        entities: historical.entities.length,
        facts: historical.entities.reduce((total, entity) => total + (entity.facts?.length ?? 0), 0),
        relationships: historical.relationships.length,
      },
      known_historical_misses: misses.length,
      historical_misses_by_type: Object.fromEntries([...new Set(misses.map((reference) => reference.reference_type))].sort().map((type) => [
        type,
        misses.filter((reference) => reference.reference_type === type).length,
      ])),
      expected_identities: references,
    };
  });

  const documentResult = await client.from("documents").select("id").eq("campaign_id", "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4").single();
  if (documentResult.error) throw documentResult.error;
  const pagesResult = await client.from("document_pages").select("page_number,text").eq("document_id", documentResult.data.id).order("page_number");
  if (pagesResult.error || !pagesResult.data) throw pagesResult.error ?? new Error("Source pages unavailable");
  for (const chunk of selected) {
    const text = pagesResult.data.filter((page) => chunk.page_numbers.includes(page.page_number)).map((page) => `<campaign-page number="${page.page_number}">\n${page.text}\n</campaign-page>`).join("\n\n");
    chunk.normalized_source_text_sha256 = sha256(text.replace(/\s+/g, " ").trim());
    chunk.source_characters = text.length;
  }

  console.log(JSON.stringify({
    schema_version: 1,
    frozen_at_commit: "53aee4208b4bcc6d6f1459745c328b46b10ec774",
    package_version: "0.4.8",
    source_campaign_id: "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4",
    extraction_cache_id: TEST_THREE_CACHE_ID,
    selection_method: "descending known historical miss count, then category diversity, then historical validated output size",
    selected_chunk_order: selectedChunkNumbers,
    model_output_may_modify_reference: false,
    chunks: selected,
  }, null, 2));
}

void main();
