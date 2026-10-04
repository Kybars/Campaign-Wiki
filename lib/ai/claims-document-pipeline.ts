import "server-only";
import type { DocumentPage } from "../pdf/types";
import { cleanDocumentPagesForModel, pageTextForModel } from "../pdf/model-text";
import { chunkPages } from "../pdf/chunk-pages";
import { getProcessingEnv } from "../env";
import { extractInventoryChunksLimited, type InventoryExtractedChunk } from "./extract";
import { buildFinalGraphInventory } from "../processing/graph-core";
import { buildClaimsEvidenceUnits, packClaimsRequests, documentClaimsRequest, validateClaimsProvenance,
  CLAIMS_DOCUMENT_MODEL, CLAIMS_OUTPUT_CAP, INVENTORY_OUTPUT_CAP, COMPLETENESS_OUTPUT_CAP, assertDocumentModelPolicy } from "./claims-document-source";
import { CLAIMS_4_1_PROMPT, claims41OutputSchema, claims41DocumentUnionSchema, serializeClaims41Request, CLAIMS_4_1_BEHAVIOR_VERSION, type Claims41DocumentUnion, type Claims41Output, type Claims41Request } from "./claims-4-1-experiment";
import { reconcileClaims41DocumentV224 } from "./claims-4-1-reconciliation-v2-2-4";
import { EXTRACTION_INVENTORY_BEHAVIOR_VERSION, EXTRACTION_INVENTORY_COMPLETENESS_BEHAVIOR_VERSION, semanticInputHash } from "./operation-checkpoint";
import type { durableDocumentProvider } from "./claims-document-runtime";
import type { GraphInventory } from "./entity-reconciliation";

export function preflightClaimsDocument(pages: DocumentPage[], sourceHash: string, filename: string,
  targetCharacters = getProcessingEnv().PDF_CHUNK_TARGET_CHARACTERS) {
  const cleaning = cleanDocumentPagesForModel(pages);
  const evidenceUnits = buildClaimsEvidenceUnits(cleaning.pages);
  const chunks = chunkPages(cleaning.pages, { targetCharacters, overlapPages: 1 });
  const inventoryPlan = chunks.flatMap((chunk) => [
    { requestId: `inventory-${chunk.id}-${sourceHash.slice(0, 12)}-${semanticInputHash(chunk.pages).slice(0, 12)}`, chunkId: chunk.id,
      stage: "inventory_initial", modelId: CLAIMS_DOCUMENT_MODEL, maxOutputTokens: INVENTORY_OUTPUT_CAP },
    { requestId: `completeness-${chunk.id}-${sourceHash.slice(0, 12)}-${semanticInputHash(chunk.pages).slice(0, 12)}`, chunkId: chunk.id,
      stage: "inventory_completeness", modelId: CLAIMS_DOCUMENT_MODEL, maxOutputTokens: COMPLETENESS_OUTPUT_CAP },
  ]);
  return { document: { sourceHash, filename, pageCount: pages.length, cleaningDiagnostics: { removedLineCount: cleaning.removedLineCount,
    pages: cleaning.pages.map((page) => ({ page: page.pageNumber, rawCharacters: page.text.length, modelCharacters: pageTextForModel(page).length })) },
    coarseInventoryChunkManifest: chunks.map((chunk) => ({ id: chunk.id, pages: chunk.pages.map((page) => page.pageNumber), characterCount: chunk.characterCount })),
    claimsRequestManifest: null }, cleaning, chunks, evidenceUnits, inventoryPlan,
    diagnostics: { provenance: validateClaimsProvenance(evidenceUnits, pages),
      sourceCoverage: cleaning.pages.map((page) => ({ page: page.pageNumber,
        modelNonWhitespaceCharacters: pageTextForModel(page).replace(/\s/gu, "").length,
        evidenceNonWhitespaceCharacters: evidenceUnits.filter((unit) => unit.page === page.pageNumber).map((unit) => unit.text).join("").replace(/\s/gu, "").length })),
      plannedInventoryCalls: inventoryPlan.length, plannedClaimsCalls: null, totalPlannedCalls: null,
      distinctPlannedModelIds: assertDocumentModelPolicy([...inventoryPlan, { modelId: CLAIMS_DOCUMENT_MODEL }]),
      claimsPlanningStatus: "Awaiting actual document-global inventory; no final Claims count/input total asserted", modelCalls: 0 } };
}

export async function runDocumentInventory(preflight: ReturnType<typeof preflightClaimsDocument>, runtime: ReturnType<typeof durableDocumentProvider>) {
  // The existing limited extractor performs initial + completeness per same chunk.
  // Sequential single-chunk invocation supplies exact operation IDs without changing production extraction.
  const results: InventoryExtractedChunk[] = [];
  for (const chunk of preflight.chunks) {
    const source = semanticInputHash(chunk.pages);
    const base = { sourceHash: preflight.document.sourceHash, upstreamFingerprint: source };
    const initialId = preflight.inventoryPlan.find((item) => item.chunkId === chunk.id && item.stage === "inventory_initial")!.requestId;
    const completenessId = preflight.inventoryPlan.find((item) => item.chunkId === chunk.id && item.stage === "inventory_completeness")!.requestId;
    const [result] = await extractInventoryChunksLimited([chunk], 1, {
      inventory: runtime.providerFor({ ...base, id: initialId, stage: "inventory_initial", behaviorVersion: EXTRACTION_INVENTORY_BEHAVIOR_VERSION, outputCap: INVENTORY_OUTPUT_CAP }),
      completeness: runtime.providerFor({ ...base, id: completenessId, stage: "inventory_completeness", behaviorVersion: EXTRACTION_INVENTORY_COMPLETENESS_BEHAVIOR_VERSION, outputCap: COMPLETENESS_OUTPUT_CAP }),
    });
    result.inventoryCheckpointStatus = runtime.metadata.findLast((item) => item.id === initialId)?.reused ? "REUSE" : "RUN";
    result.completenessCheckpointStatus = runtime.metadata.findLast((item) => item.id === completenessId)?.reused ? "REUSE" : "RUN";
    results.push(result);
  }
  return { finalInventory: buildFinalGraphInventory(results.map((item) => item.inventory)), chunks: results, checkpointMetadata: runtime.metadata, calls: runtime.calls };
}

export function unionDocumentClaims(requests: Claims41Request[], outputs: Array<{ requestId: string; output: Claims41Output }>) {
  if (outputs.length !== requests.length || new Set(outputs.map((item) => item.requestId)).size !== requests.length ||
    outputs.some((item) => !requests.some((request) => request.requestId === item.requestId))) throw new Error("Exactly one output per Claims request required");
  const unionedOutput: Claims41DocumentUnion = { claims: [] };
  const proposalProvenance: Array<{ globalProposalIndex: number; extractionRequestId: string; requestLocalProposalIndex: number }> = [];
  for (const request of requests) {
    const output = outputs.find((item) => item.requestId === request.requestId)!.output;
    claims41OutputSchema.parse(output);
    for (const [localIndex, claim] of output.claims.entries()) {
      proposalProvenance.push({ globalProposalIndex: unionedOutput.claims.length, extractionRequestId: request.requestId, requestLocalProposalIndex: localIndex });
      unionedOutput.claims.push(structuredClone(claim));
    }
  }
  claims41DocumentUnionSchema.parse(unionedOutput);
  return { unionedOutput, proposalProvenance };
}

export function reconcileDocumentClaims(union: ReturnType<typeof unionDocumentClaims>, request: Claims41Request) {
  return reconcileClaims41DocumentV224(union.unionedOutput, request);
}

export async function runDocumentClaims(preflight: ReturnType<typeof preflightClaimsDocument>, inventory: GraphInventory,
  runtime: ReturnType<typeof durableDocumentProvider>, preserveUnion: (union: ReturnType<typeof unionDocumentClaims>) => void) {
  const packing = packClaimsRequests(preflight.evidenceUnits, inventory);
  assertDocumentModelPolicy([...preflight.inventoryPlan, ...packing.manifest]);
  const documentWideRequest = documentClaimsRequest(preflight.evidenceUnits, inventory, "claims4-1-document-wide");
  const outputs: Array<{ requestId: string; output: Claims41Output }> = [];
  const usage = [];
  for (const request of packing.requests) {
    const provider = runtime.providerFor({ id: request.requestId, stage: "claims41", sourceHash: preflight.document.sourceHash,
      upstreamFingerprint: semanticInputHash({ inventory, units: preflight.evidenceUnits }), behaviorVersion: CLAIMS_4_1_BEHAVIOR_VERSION, outputCap: CLAIMS_OUTPUT_CAP });
    const result = await provider.parseStructured({ system: CLAIMS_4_1_PROMPT, payload: serializeClaims41Request(request).payload,
      schema: claims41OutputSchema, schemaName: "claims41_document_output", maxOutputTokens: CLAIMS_OUTPUT_CAP });
    outputs.push({ requestId: request.requestId, output: result.output }); usage.push(result.usage);
  }
  const union = unionDocumentClaims(packing.requests, outputs);
  preserveUnion(union); // Durable complete raw union precedes document-wide reconciliation.
  const reconciliation = reconcileDocumentClaims(union, documentWideRequest);
  return { document: { ...preflight.document, claimsRequestManifest: packing.manifest }, inventory: { finalInventory: inventory },
    claimsExtraction: { evidenceUnits: documentWideRequest.evidenceUnits, requestIds: packing.requests.map((request) => request.requestId),
      ownership: packing.ownership, rawOutputs: outputs, ...union }, reconciliation,
    readModel: { resolvedClaims: reconciliation.claims.filter((claim) => claim.resolutionState === "resolved"),
      mechanicalOnlyClaims: reconciliation.claims.filter((claim) => claim.wikiDisposition === "mechanical_only"),
      timelineAssociations: reconciliation.claims.filter((claim) => claim.timelineAssociation).map((claim) => ({ proposalIndex: claim.proposalIndex, association: claim.timelineAssociation })),
      entityAssociations: reconciliation.claims.map((claim) => ({ proposalIndex: claim.proposalIndex, associations: claim.entityAssociations })) },
    diagnostics: { ...preflight.diagnostics, plannedClaimsCalls: packing.requests.length,
      totalPlannedCalls: preflight.inventoryPlan.length + packing.requests.length, requestSizes: packing.manifest,
      modelCalls: runtime.calls, usage, checkpoints: runtime.metadata,
      unresolvedParticipantCount: reconciliation.claims.flatMap((claim) => claim.participants).filter((participant) => participant.kind === "unresolved").length,
      noUsefulHomeCount: reconciliation.claims.filter((claim) => !claim.entityAssociations.length && !claim.timelineAssociation && claim.wikiDisposition !== "mechanical_only").length,
      contextEvidenceCount: reconciliation.claims.reduce((sum, claim) => sum + claim.contextEvidence.length, 0) } };
}
