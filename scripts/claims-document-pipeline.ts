import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { extractPdfPages } from "../lib/pdf/extract-text";
import { preflightClaimsDocument, runDocumentInventory, runDocumentClaims } from "../lib/ai/claims-document-pipeline";
import { packClaimsRequests, CLAIMS_DOCUMENT_MODEL, INVENTORY_OUTPUT_CAP, COMPLETENESS_OUTPUT_CAP, CLAIMS_OUTPUT_CAP } from "../lib/ai/claims-document-source";
import { createDocumentRuntime, authorizeDocumentStage } from "../lib/ai/claims-document-runtime";
import { writeDurableArtifact } from "../lib/ai/private-artifact";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";

async function main() {
const args = process.argv.slice(2);
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const allowedOptions = new Set(["source", "output", "expected-sha256", "expected-pages", "phase", "allow-requests", "max-calls", "inventory-run", "checkpoint-run"]);
if (args.some((arg) => !["--preflight", "--live-luna"].includes(arg) && !allowedOptions.has(arg.split("=")[0].replace(/^--/u, "")))) throw new Error("Unknown runner option");
const preflightOnly = args.includes("--preflight");
const live = args.includes("--live-luna");
if (preflightOnly === live) throw new Error("Select exactly --preflight or --live-luna");
if (live && (process.env.ALLOW_PAID_CLAIMS_DOCUMENT_LUNA !== "1" || !option("allow-requests") || !option("max-calls"))) throw new Error("Live requires explicit environment authorization, exact allowlist and max-calls");
const sourcePath = option("source");
const outputPath = option("output");
if (!sourcePath || !outputPath) throw new Error("Explicit --source and --output required");
const directory = resolve(outputPath);
const privateRoot = resolve("fixtures/private");
if (!directory.startsWith(privateRoot + "\\") && !directory.startsWith(privateRoot + "/")) throw new Error("Artifacts must be private/local-only under fixtures/private");
if (existsSync(directory)) throw new Error("Use a new versioned output directory; previous artifacts are immutable");
const checkpointDirectory = join(resolve(option("checkpoint-run") ?? directory), "checkpoints");
if (!checkpointDirectory.startsWith(privateRoot + "\\") && !checkpointDirectory.startsWith(privateRoot + "/")) throw new Error("Checkpoints must be private");
const bytes = readFileSync(resolve(sourcePath));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sourceHash = sha(bytes);
if (option("expected-sha256") && option("expected-sha256") !== sourceHash) throw new Error("Source SHA-256 mismatch");
const pages = await extractPdfPages(bytes);
if (option("expected-pages") && Number(option("expected-pages")) !== pages.length) throw new Error("Page-count mismatch");
const preflight = preflightClaimsDocument(pages, sourceHash, basename(sourcePath));
if (preflight.diagnostics.sourceCoverage.some((page) => page.modelNonWhitespaceCharacters !== page.evidenceNonWhitespaceCharacters)) throw new Error("Useful source coverage mismatch");
mkdirSync(directory, { recursive: true });
const write = (name: string, value: unknown) => writeDurableArtifact(join(directory, name), value);
write("source-manifest.v1.json", { ...preflight.document, classification: "private/local-only", pdfIncluded: false });
write("cleaning-summary.v1.json", preflight.document.cleaningDiagnostics);
write("inventory-chunk-plan.v1.json", { chunks: preflight.document.coarseInventoryChunkManifest, plannedCalls: preflight.inventoryPlan });
write("evidence-units.v1.json", preflight.evidenceUnits);
write("model-policy.v1.json", { distinctPlannedModelIds: [CLAIMS_DOCUMENT_MODEL], stages: ["inventory_initial", "inventory_completeness", "claims41"],
  outputCaps: { inventory: INVENTORY_OUTPUT_CAP, completeness: COMPLETENESS_OUTPUT_CAP, claims41: CLAIMS_OUTPUT_CAP }, sdkMaxRetries: 0 });
write("call-safety.v1.json", { liveAuthorized: live, automaticRetries: 0, stageAllowlistRequired: true, exactMaxCallsRequired: true,
  durableAttemptBeforeDispatch: true, uncertainDispatchBlocks: true, rawResponseBeforeValidation: true, validatedResume: true,
  stagedAuthorizationReason: "Actual inventory determines Claims request IDs/count. Freeze it before authorizing Claims.",
  frozenDocumentUnionMaximum: 400 });

if (preflightOnly) {
  // Synthetic inventory proves packing capability on the complete real evidence stream.
  // It is never a substitute for live inventory and supplies no acceptance Claims count.
  const synthetic: GraphInventory = { entities: [{ temporary_id: "synthetic-only", name: "Synthetic Test Identity", type: "other", aliases: [], memberIds: [], sources: [] }] };
  const demonstration = packClaimsRequests(preflight.evidenceUnits, synthetic);
  write("claims-packing-diagnostics.v1.json", { status: "Awaiting actual final inventory", acceptanceRequestCount: null,
    acceptanceInputTokens: null, syntheticCapabilityOnly: true, syntheticDemonstration: demonstration.manifest,
    ownership: demonstration.ownership, targetInputTokens: 12000, hardInputTokens: 16000, noPrimaryOverlap: true });
  write("pipeline-preflight.v1.json", preflight.diagnostics);
  write("verification-results.v1.json", { sourceHashVerified: Boolean(option("expected-sha256")), pageCountVerified: Boolean(option("expected-pages")),
    provenance: preflight.diagnostics.provenance, sourceCoverage: preflight.diagnostics.sourceCoverage, syntheticPackingPassed: true,
    primaryUnits: demonstration.ownership.filter((item) => item.primary).length, inventoryCalls: preflight.inventoryPlan.length,
    claimsCalls: null, totalCalls: null, modelCalls: 0, databaseWrites: 0, frontendChanges: 0,
    implementationHashes: ["lib/ai/claims-document-source.ts", "lib/ai/claims-document-pipeline.ts", "lib/ai/claims-document-runtime.ts",
      "lib/ai/private-artifact.ts", "lib/pdf/source-mapping.ts", "scripts/claims-document-pipeline.ts",
      "lib/ai/claims-4-1-experiment.ts", "lib/ai/claims-4-1-reconciliation-v2-2-4.ts"].map((path) => ({ path, sha256: sha(readFileSync(path)) })) });
} else {
  const phase = option("phase");
  const auth = { live, authorization: process.env.ALLOW_PAID_CLAIMS_DOCUMENT_LUNA,
    allowedRequestIds: option("allow-requests")?.split(",").filter(Boolean) ?? [], maxCalls: Number(option("max-calls")) };
  if (phase === "inventory") {
    const ids = preflight.inventoryPlan.map((item) => item.requestId);
    const runtime = createDocumentRuntime(checkpointDirectory, auth, ids);
    const inventory = await runDocumentInventory(preflight, runtime);
    write("inventory-result.v1.json", { sourceHash, checkpointDirectory, inventory });
    const packing = packClaimsRequests(preflight.evidenceUnits, inventory.finalInventory);
    write("claims-packing-diagnostics.v1.json", { status: "Frozen actual inventory planning; review before Claims dispatch", ...packing });
  } else if (phase === "claims") {
    const priorPath = option("inventory-run");
    if (!priorPath) throw new Error("--inventory-run required for reviewed actual inventory");
    const priorDirectory = resolve(priorPath);
    if (!priorDirectory.startsWith(privateRoot + "\\") && !priorDirectory.startsWith(privateRoot + "/")) throw new Error("Inventory artifact must be private");
    const manifest = JSON.parse(readFileSync(join(priorDirectory, "MANIFEST.json"), "utf8")) as { artifacts: Array<{ path: string; sha256: string }> };
    for (const artifact of manifest.artifacts) {
      if (!/^[a-z0-9.-]+$/iu.test(artifact.path) || sha(readFileSync(join(priorDirectory, artifact.path))) !== artifact.sha256) throw new Error("Inventory artifact hash mismatch");
    }
    const prior = JSON.parse(readFileSync(join(priorDirectory, "inventory-result.v1.json"), "utf8")) as { sourceHash: string; checkpointDirectory: string; inventory: Awaited<ReturnType<typeof runDocumentInventory>> };
    if (prior.sourceHash !== sourceHash) throw new Error("Inventory source mismatch");
    // Revalidate through production extraction using durable successful operations only.
    const inventoryAuth = { live: true, authorization: "1", allowedRequestIds: preflight.inventoryPlan.map((item) => item.requestId), maxCalls: preflight.inventoryPlan.length };
    const { durableDocumentProvider } = await import("../lib/ai/claims-document-runtime");
    const noDispatch = { responses: { create() { throw new Error("Missing/invalid inventory checkpoint; live inventory redispatch forbidden during Claims stage"); } } };
    const priorCheckpoints = resolve(prior.checkpointDirectory);
    if (!priorCheckpoints.startsWith(privateRoot + "\\") && !priorCheckpoints.startsWith(privateRoot + "/")) throw new Error("Invalid prior checkpoint path");
    const validationRuntime = durableDocumentProvider(priorCheckpoints, inventoryAuth, inventoryAuth.allowedRequestIds, noDispatch as never, true);
    const inventory = await runDocumentInventory(preflight, validationRuntime);
    if (JSON.stringify(inventory.finalInventory) !== JSON.stringify(prior.inventory.finalInventory)) throw new Error("Actual inventory revalidation mismatch");
    const packing = packClaimsRequests(preflight.evidenceUnits, inventory.finalInventory);
    const frozenPacking = JSON.parse(readFileSync(join(priorDirectory, "claims-packing-diagnostics.v1.json"), "utf8")) as typeof packing;
    for (const field of ["requests", "ownership", "manifest"] as const) {
      if (JSON.stringify(packing[field]) !== JSON.stringify(frozenPacking[field])) throw new Error("Claims plan differs from reviewed actual-inventory artifact");
    }
    const ids = packing.requests.map((item) => item.requestId);
    authorizeDocumentStage(auth, ids);
    write("claims-packing-diagnostics.v1.json", { status: "Actual inventory", ...packing });
    const runtime = createDocumentRuntime(checkpointDirectory, auth, ids);
    const result = await runDocumentClaims(preflight, inventory.finalInventory, runtime, (union) => write("claims-union.v1.json", union));
    write("wiki-ready-private.v1.json", { ...result,
      inventory: { ...prior.inventory, validationCheckpointMetadata: inventory.checkpointMetadata },
      diagnostics: { ...result.diagnostics, inventoryUsage: inventory.chunks.map((chunk) => ({ chunkId: chunk.chunkId,
        initial: chunk.initialInventoryUsage, completeness: chunk.completenessUsage })), inventoryValidationModelCalls: validationRuntime.calls } });
  } else throw new Error("Live requires --phase=inventory or --phase=claims");
}
const artifacts = readdirSync(directory).filter((name) => name.endsWith(".json")).map((path) => ({ path, sha256: sha(readFileSync(join(directory, path))) }));
write("MANIFEST.json", { version: 1, sourceHash, artifacts });
write("MANIFEST.sha256.json", { sha256: sha(readFileSync(join(directory, "MANIFEST.json"))) });
console.log(JSON.stringify({ directory, sourceHash, pageCount: pages.length, inventoryChunks: preflight.chunks.length,
  evidenceUnits: preflight.evidenceUnits.length, plannedInventoryCalls: preflight.inventoryPlan.length, claimsCalls: null, totalCalls: null, preflightOnly }));

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
