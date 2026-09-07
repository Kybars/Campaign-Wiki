import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { extractChunksLimited } from "@/lib/ai/extract";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import { aggregateCandidates } from "@/lib/graph/aggregate";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildEvaluationMetrics } from "@/lib/evaluation/metrics";
import { normalizeName, normalizeRelationshipType } from "@/lib/graph/normalize";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import { chunkPages } from "@/lib/pdf/chunk-pages";
import { extractPdfPages } from "@/lib/pdf/extract-text";
import { createFixturePdf } from "@/scripts/create-fixture-pdf";

interface Fixture {
  expectedEntities: string[];
  expectedRelationships: [string, string, string][];
}

async function main() {
  try {
    loadEnvFile(path.join(process.cwd(), ".env.local"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "test-campaign.json"), "utf8")) as Fixture;
  const pdfPath = await createFixturePdf();
  const pdf = await readFile(pdfPath);
  const pages = await extractPdfPages(pdf);
  const chunks = chunkPages(pages, { targetCharacters: 1300, overlapPages: 1 });
  const extracted = await extractChunksLimited(chunks, 2);
  const aggregate = aggregateCandidates(extracted.map((result) => ({ chunkId: result.chunkId, ...result.extraction })));
  const groups = buildDeterministicGroups(aggregate);
  const reconciliation = await reconcileGroupsWithAI(groups);
  const graph = buildCanonicalGraph(aggregate, reconciliation.decision);

  const actualEntities = new Set(graph.entities.map((entity) => normalizeName(entity.name)));
  const missedEntities = fixture.expectedEntities.filter((name) => !actualEntities.has(normalizeName(name)));
  const expectedEntitySet = new Set(fixture.expectedEntities.map(normalizeName));
  const unexpectedEntities = graph.entities.filter((entity) => !expectedEntitySet.has(normalizeName(entity.name))).map((entity) => entity.name);
  const entityNameByKey = new Map(graph.entities.map((entity) => [entity.key, entity.name]));
  const actualRelationships = new Set(graph.relationships.map((relationship) => [
    normalizeName(entityNameByKey.get(relationship.sourceEntityKey) ?? ""),
    normalizeRelationshipType(relationship.relationshipType),
    normalizeName(entityNameByKey.get(relationship.targetEntityKey) ?? ""),
  ].join("|")));
  const missedRelationships = fixture.expectedRelationships.filter(([source, type, target]) =>
    !actualRelationships.has([normalizeName(source), normalizeRelationshipType(type), normalizeName(target)].join("|")),
  );

  console.log(JSON.stringify({
    mode: "live extraction",
    pages: pages.length,
    chunks: chunks.length,
    candidates: aggregate.entities.length,
    canonicalEntities: graph.entities.length,
    relationships: graph.relationships.length,
    expectedEntitiesFound: fixture.expectedEntities.length - missedEntities.length,
    missedEntities,
    unexpectedEntities,
    expectedRelationshipsFound: fixture.expectedRelationships.length - missedRelationships.length,
    missedRelationships,
    rejectedSources: extracted.flatMap((result) => result.diagnostics),
    discardedRelationships: graph.discardedRelationships,
    metrics: buildEvaluationMetrics(aggregate, graph),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
