/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createAdminClient } from "../lib/db/client";
import { buildEntityOccurrenceIndex } from "../lib/graph/occurrence-index";
import { buildFocusedGraphWindows, runFocusedGraphExtraction, validateFocusedGraphExtraction } from "../lib/ai/graph-extraction";
import { getStructuredModelProvider } from "../lib/ai/structured-model-provider-runtime";
import { normalizeName } from "../lib/graph/normalize";
import { normalizeRelationshipFact } from "../lib/relationships/normalize";

loadEnvConfig(process.cwd());
const campaignId = "5b8b688b-4354-420e-93f4-f4aff222b7a8";
const documentId = "73342d6e-7b35-4d0d-bf9a-b3574e265985";
const outputDirectory = join(process.cwd(), "fixtures", "private", "test9-focused-ab");
const fixturePath = join(outputDirectory, "fixture.json");
const resultPath = join(outputDirectory, "result.json");
const nextGoldPath = join(outputDirectory, "next-experiment-gold.json");
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type Fixture = { fixture_hash: string; pages: Array<{ pageNumber: number; text: string }>; inventory: Array<{ temporary_id: string; name: string; type: string; aliases: string[] }>; reference: Array<{ source: string; relationship: string; target: string; pages: number[]; origin: "first_pass" | "rescue_only" | "mixed" }>; baseline_raw: Array<{ relationships: Array<{ source: string; relationship: string; target: string; page: number; evidence_quote: string }> }>; baseline_usage: Array<Record<string, number | null>> };

async function exportFixture(): Promise<Fixture> {
  const db = createAdminClient() as any;
  const [pagesResult, entitiesResult, relationshipsResult, checkpointsResult] = await Promise.all([
    db.from("document_pages").select("page_number,text").eq("document_id", documentId).gte("page_number", 10).lte("page_number", 14).order("page_number"),
    db.from("entities").select("id,name,type,aliases").eq("campaign_id", campaignId),
    db.from("relationships").select("id,relationship_type,source_entity_id,target_entity_id,relationship_sources(page_number)").eq("campaign_id", campaignId),
    db.from("ai_operation_checkpoints").select("operation_type,operation_key,validated_output,usage_diagnostics").eq("campaign_id", campaignId).eq("status", "validated").in("operation_type", ["graph_extraction", "relationship_rescue"]),
  ]);
  for (const result of [pagesResult, entitiesResult, relationshipsResult, checkpointsResult]) if (result.error) throw result.error;
  const pages = pagesResult.data.map((row: any) => ({ pageNumber: row.page_number, text: row.text }));
  const inventory = entitiesResult.data.map((row: any) => ({ temporary_id: row.id, name: row.name, type: row.type, aliases: row.aliases ?? [] })).sort((a: any, b: any) => a.temporary_id.localeCompare(b.temporary_id));
  const byId = new Map<string, { temporary_id: string; name: string; type: string; aliases: string[] }>(inventory.map((entity: any) => [entity.temporary_id, entity]));
  const baseline = checkpointsResult.data.filter((row: any) => row.operation_type === "graph_extraction");
  const rescue = checkpointsResult.data.filter((row: any) => row.operation_type === "relationship_rescue");
  const checkpointHas = (items: any[], source: string, relationship: string, target: string) => items.some((item) => (item.validated_output?.raw?.relationships ?? []).some((edge: any) => normalizeName(edge.source) === normalizeName(source) && normalizeName(edge.target) === normalizeName(target) && normalizeName(edge.relationship) === normalizeName(relationship)));
  const reference = relationshipsResult.data.flatMap((row: any) => {
    const pagesForRelationship = (row.relationship_sources ?? []).map((source: any) => source.page_number).filter((page: number) => page >= 10 && page <= 14).sort((a: number, b: number) => a - b);
    if (!pagesForRelationship.length) return [];
    const source = byId.get(row.source_entity_id); const target = byId.get(row.target_entity_id); if (!source || !target) return [];
    const first = checkpointHas(baseline, source.name, row.relationship_type, target.name);
    const rescued = checkpointHas(rescue, source.name, row.relationship_type, target.name);
    return [{ source: source.name, relationship: row.relationship_type, target: target.name, pages: pagesForRelationship, origin: first && rescued ? "mixed" : first ? "first_pass" : "rescue_only" }];
  });
  const payload = { pages, inventory, reference, baseline_raw: baseline.map((row: any) => row.validated_output.raw), baseline_usage: baseline.map((row: any) => row.usage_diagnostics?.[0] ?? {}) };
  return { fixture_hash: sha256(payload), ...payload };
}

function match(edge: { source: string; relationship: string; target: string }, reference: Fixture["reference"][number]) {
  const actual = normalizeRelationshipFact(normalizeName(edge.source), normalizeName(edge.target), edge.relationship);
  const expected = normalizeRelationshipFact(normalizeName(reference.source), normalizeName(reference.target), reference.relationship);
  return actual.sourceId === expected.sourceId && actual.targetId === expected.targetId && actual.semanticType === expected.semanticType;
}
function usage(values: Array<Record<string, number | null>>) { const sum = (key: string) => values.reduce<number | null>((total, value) => total === null || value[key] === null || value[key] === undefined ? null : total + value[key]!, 0); return { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens") }; }

async function main() {
  mkdirSync(outputDirectory, { recursive: true });
  const fixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture : await exportFixture();
  if (!existsSync(fixturePath)) writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  if (sha256({ pages: fixture.pages, inventory: fixture.inventory, reference: fixture.reference, baseline_raw: fixture.baseline_raw, baseline_usage: fixture.baseline_usage }) !== fixture.fixture_hash) throw new Error("Frozen fixture hash mismatch");
  const baselineEdges = fixture.baseline_raw.flatMap((item) => item.relationships).filter((edge) => edge.page >= 10 && edge.page <= 14);
  const baselineRecovered = fixture.reference.filter((reference) => baselineEdges.some((edge) => match(edge, reference)));
  const index = buildEntityOccurrenceIndex(fixture.inventory, fixture.pages);
  const windows = buildFocusedGraphWindows(fixture.pages, { entities: fixture.inventory.map((entity) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) } as any, index);
  const provider = getStructuredModelProvider("graph_extraction");
  if (provider.providerId !== "openai" || provider.modelId !== "gpt-5.6-luna") throw new Error(`Expected openai:gpt-5.6-luna, got ${provider.providerId}:${provider.modelId}`);
  const plan = { fixture_hash: fixture.fixture_hash, source_pages: fixture.pages.map((page) => page.pageNumber), focused_windows: windows.map((window) => ({ id: window.id, pages: window.pages.map((page) => page.pageNumber), semantic_characters: window.characterCount, entity_count: window.entityIds.length })), expected_openai_calls: windows.length, test9_mutation: false };
  console.log(JSON.stringify(plan, null, 2));
  if (process.argv.includes("--freeze-next-gold")) {
    // These additions are manually checked against the raw page text.  The
    // existing reference remains unchanged; this is solely a future-run gold.
    const additions = [
      { source: "Turinn", relationship: "capital of", target: "Sindaire", page: 13, evidence: "Turinn, the capital city of Sindaire" },
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 14, evidence: "under naval blockade and under attack by\nOstalin." },
    ];
    for (const addition of additions) {
      const page = fixture.pages.find((item) => item.pageNumber === addition.page);
      if (!page?.text.includes(addition.evidence)) throw new Error(`Future gold evidence is not raw-verbatim: ${addition.source}`);
    }
    const reference = [...fixture.reference, ...additions.map(({ source, relationship, target, page, evidence }) => ({ source, relationship, target, pages: [page], origin: "manual_source_review" as const, evidence }))];
    const gold = { fixture_hash: fixture.fixture_hash, reference_hash: sha256(reference), source_pages: fixture.pages.map((page) => page.pageNumber), relationships: reference };
    writeFileSync(nextGoldPath, `${JSON.stringify(gold, null, 2)}\n`);
    console.log(JSON.stringify({ next_gold_size: reference.length, next_gold_hash: gold.reference_hash }, null, 2));
    return;
  }
  if (process.argv.includes("--freeze-only")) return;
  const responses = await Promise.all(windows.map(async (window) => {
    const response = await runFocusedGraphExtraction([window], { entities: fixture.inventory.map((entity) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) } as any, provider);
    return { window, raw: response.output, validation: validateFocusedGraphExtraction(response.output, [window], { entities: fixture.inventory.map((entity) => ({ ...entity, memberIds: [entity.temporary_id], sources: [] })) } as any), usage: response.usage };
  }));
  const candidate = responses.flatMap((result) => result.validation.relationships);
  const recovered = fixture.reference.filter((reference) => candidate.some((edge) => match({ source: edge.sourceName, relationship: edge.relationshipType, target: edge.targetName }, reference)));
  const result = { fixture_hash: fixture.fixture_hash, windows: windows.map((window) => ({ id: window.id, pages: window.pages.map((page) => page.pageNumber), characters: window.characterCount, entities: window.entityIds.length })), baseline: { calls: 0, raw_proposed: baselineEdges.length, recovered: baselineRecovered, usage: usage(fixture.baseline_usage) }, candidate: { calls: responses.length, raw: responses.map((response) => response.raw), valid_relationships: candidate.length, recovered, evidence_rejections: responses.reduce((n, response) => n + response.validation.evidenceQuoteRejections, 0), usage: usage(responses.map((response) => response.usage as any)) }, reference_total: fixture.reference.length };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
