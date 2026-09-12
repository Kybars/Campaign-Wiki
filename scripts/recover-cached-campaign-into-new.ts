import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const [sourceCampaignId, name, mode, expectedCacheId, expectedFingerprint] = process.argv.slice(2);

function usage(): never {
  throw new Error("Usage: npm run recover:derived -- SOURCE_CAMPAIGN_ID NEW_NAME --dry-run|--execute EXPECTED_CACHE_ID EXPECTED_FINGERPRINT");
}

async function main() {
  if (!sourceCampaignId || !name || !["--dry-run", "--execute"].includes(mode) || !expectedCacheId || !expectedFingerprint) usage();
  const [{ preflightCachedRecovery }, { applyLeanGraphDefaults, buildLeanDiagnostics }, { createAdminClient, requireData }, { persistCanonicalGraph, recordProcessingRun, updateCampaign }] = await Promise.all([
    import("@/lib/processing/recover-campaign"), import("@/lib/graph/lean"), import("@/lib/db/client"), import("@/lib/db/repository"),
  ]);
  const preflight = await preflightCachedRecovery(sourceCampaignId, { processingMode: "lean" });
  const graph = applyLeanGraphDefaults(preflight.graph);
  const expected = { entities: 112, facts: 502, relationships: 145 };
  const sourceInvariant = {
    cacheId: preflight.cache.run.id,
    fingerprint: preflight.graphFingerprint,
    entities: graph.entities.length,
    facts: graph.facts.length,
    relationships: graph.relationships.length,
  };
  if (sourceInvariant.cacheId !== expectedCacheId || sourceInvariant.fingerprint !== expectedFingerprint || sourceInvariant.entities !== expected.entities || sourceInvariant.facts !== expected.facts || sourceInvariant.relationships !== expected.relationships) {
    throw new Error(`Derived recovery preflight mismatch: ${JSON.stringify(sourceInvariant)}`);
  }
  const report = {
    sourceCampaignId, sourceCampaignStatus: preflight.campaign.status, sourceDocumentId: preflight.document.id, sourceExtractionCacheId: sourceInvariant.cacheId,
    processingMode: "lean", extraction: "REUSE", reconciliation: "REUSE", ...sourceInvariant,
    plannedExtractionCalls: 0, plannedReconciliationCalls: 0, plannedEnrichmentCalls: 0, plannedOpenAICalls: 0, plannedLocalCalls: 0,
    paidCallGuard: preflight.paidCallPlan.guardResult, writes: mode === "--dry-run" ? 0 : "pending", modelCalls: 0,
  };
  if (mode === "--dry-run") return console.log(JSON.stringify({ ...report, status: "DRY_RUN" }, null, 2));

  const client = createAdminClient();
  const campaignId = randomUUID();
  const documentId = randomUUID();
  const storagePath = `derived/${campaignId}/${preflight.document.filename}`;
  try {
    const campaign = await client.from("campaigns").insert({ id: campaignId, name, status: "persisting", processing_stage: "Recovering validated cached campaign knowledge", processing_diagnostics: { derivedFromCampaignId: sourceCampaignId, derivedFromExtractionCacheId: sourceInvariant.cacheId, sourceCanonicalFingerprint: sourceInvariant.fingerprint, recoveryMode: "lean", modelCalls: 0 } }).select("id").single();
    requireData(campaign.data, campaign.error, "Create derived recovery campaign");
    const copied = await client.storage.from("campaign-pdfs").copy(preflight.document.storage_path, storagePath);
    if (copied.error) throw new Error(`Copy derived recovery source PDF: ${copied.error.message}`);
    const document = await client.from("documents").insert({ id: documentId, campaign_id: campaignId, filename: preflight.document.filename, storage_path: storagePath, page_count: preflight.document.page_count }).select("id").single();
    requireData(document.data, document.error, "Create derived recovery document");
    const pages = await client.from("document_pages").select("page_number,text").eq("document_id", preflight.document.id).order("page_number");
    const sourcePages = requireData(pages.data, pages.error, "Load source document pages");
    const inserted = await client.from("document_pages").insert(sourcePages.map((page) => ({ document_id: documentId, page_number: page.page_number, text: page.text })));
    if (inserted.error) throw new Error(`Copy derived recovery document pages: ${inserted.error.message}`);
    await persistCanonicalGraph(campaignId, documentId, graph);
    const diagnostics = { ...report, writes: "campaign, source copy, document pages, canonical graph", derivedCampaignId: campaignId, ...buildLeanDiagnostics(graph) };
    await updateCampaign(campaignId, { status: "complete", processing_stage: "Recovered lean wiki ready", error_message: null, processing_diagnostics: diagnostics });
    await recordProcessingRun(campaignId, "derived_cached_lean_recovery", "complete", { output: diagnostics });
    console.log(JSON.stringify({ ...diagnostics, status: "complete", path: `/campaigns/${campaignId}` }, null, 2));
  } catch (error) {
    await updateCampaign(campaignId, { status: "failed", processing_stage: "Derived cached recovery failed", error_message: error instanceof Error ? error.message : "Unknown derived recovery failure" }).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
