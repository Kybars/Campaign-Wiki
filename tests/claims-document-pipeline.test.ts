import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { cleanDocumentPagesForModel, pageTextForModel } from "../lib/pdf/model-text";
import { chunkPages } from "../lib/pdf/chunk-pages";
import { buildClaimsEvidenceUnits, packClaimsRequests, documentClaimsRequest, estimateClaimsInput,
  CLAIMS_DOCUMENT_MODEL, CLAIMS_INPUT_MAXIMUM, validateClaimsProvenance, assertDocumentModelPolicy } from "../lib/ai/claims-document-source";
import { preflightClaimsDocument, unionDocumentClaims, reconcileDocumentClaims, runDocumentInventory, runDocumentClaims } from "../lib/ai/claims-document-pipeline";
import * as reconciler from "../lib/ai/claims-4-1-reconciliation-v2-2-4";
import * as downstream from "../lib/ai/claims-4-1-reconciliation-v2-3-0";
import { claims41PromptHash, claims41SchemaHash, claims41OutputSchema, claims41DocumentUnionSchema } from "../lib/ai/claims-4-1-experiment";
import { authorizeDocumentStage, durableDocumentProvider, operationIdentity, CLAIMS_DOCUMENT_CLIENT_OPTIONS } from "../lib/ai/claims-document-runtime";
import { createOpenAIStructuredModelProvider, createLocalStructuredModelProvider } from "../lib/ai/structured-model-provider";
import type { GraphInventory } from "../lib/ai/entity-reconciliation";

const inventory: GraphInventory = { entities: [{ temporary_id: "entity-1", name: "Mira", type: "npc", aliases: [], memberIds: [], sources: [] }] };
const pages = [
  { pageNumber: 1, text: "Running title\n1\n\nTHE CELLAR\n\nMira is immor-\ntal. A stranger guards the door.\n\nFog covers the valley.\n\n1" },
  { pageNumber: 2, text: "Running title\n2\n\nMira carries a key. If it rains, the river floods.\n\n2" },
];
const units = () => buildClaimsEvidenceUnits(cleanDocumentPagesForModel(pages).pages);
const auth = (ids: string[]) => ({ live: true, authorization: "1", allowedRequestIds: ids, maxCalls: ids.length });
const operation = { id: "op-1", stage: "claims41", sourceHash: "source", upstreamFingerprint: "upstream", behaviorVersion: "version-1", outputCap: 24000 };
const input = { system: "system", payload: "payload", schema: z.object({ answer: z.string() }), schemaName: "answer" };
const response = (output: unknown) => ({ model: CLAIMS_DOCUMENT_MODEL, id: "response-1", status: "completed", incomplete_details: null,
  output_text: JSON.stringify(output), usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });

describe("generic complete document source and packing", () => {
  it("preserves raw coordinates through cleaning, including dehyphenation, headings and unknown/no-entity prose", () => {
    const evidence = units();
    expect(evidence.find((unit) => unit.text === "THE CELLAR")?.kind).toBe("heading");
    expect(evidence.find((unit) => unit.text === "Mira is immortal.")?.rawSource.text).toBe("Mira is immor-\ntal.");
    expect(evidence.filter((unit) => unit.kind === "sentence").map((unit) => unit.text)).toContain("Fog covers the valley.");
    expect(evidence.some((unit) => unit.text.includes("stranger"))).toBe(true);
    expect(evidence).toEqual(units());
    expect(validateClaimsProvenance(evidence, pages).invalidProvenanceCount).toBe(0);
    expect(() => buildClaimsEvidenceUnits([...pages].reverse())).toThrow("source order");
    expect(() => validateClaimsProvenance([{ ...evidence[0], rawSource: { ...evidence[0].rawSource, start: 1000 } }], pages)).toThrow();
  });
  it("uses the production coarse chunk plan, complete pages and useful source accounting with no generation", () => {
    const plan = preflightClaimsDocument(pages, "hash", "synthetic.pdf", 100);
    expect(plan.chunks).toEqual(chunkPages(plan.cleaning.pages, { targetCharacters: 100, overlapPages: 1 }));
    expect(plan.cleaning.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(plan.diagnostics.sourceCoverage.every((page) => page.modelNonWhitespaceCharacters === page.evidenceNonWhitespaceCharacters)).toBe(true);
    expect(plan.diagnostics.modelCalls).toBe(0);
    expect(preflightClaimsDocument(pages, "different-source", "synthetic.pdf", 100).inventoryPlan[0].requestId).not.toBe(plan.inventoryPlan[0].requestId);
    expect(plan.diagnostics.totalPlannedCalls).toBeNull();
    expect(plan.inventoryPlan.every((item) => item.modelId === "gpt-6-luna" && item.maxOutputTokens > 0)).toBe(true);
    expect(plan.cleaning.pages.every((page) => pageTextForModel(page).length > 0)).toBe(true);
  });
  it("recovers standalone generic headings after line joining while retaining uncertain numeric/stat prose", () => {
    const raw = [{ pageNumber: 1, text: "THE CELLAR\nA stranger lives here.\nDEFENSE 13\nFog covers the valley." }];
    const evidence = buildClaimsEvidenceUnits(cleanDocumentPagesForModel(raw).pages);
    expect(evidence[0]).toMatchObject({ text: "THE CELLAR", kind: "heading" });
    expect(evidence.filter((unit) => unit.kind === "sentence").some((unit) => unit.text.includes("DEFENSE 13"))).toBe(true);
    expect(evidence.every((unit) => unit.context === "THE CELLAR")).toBe(true);
    expect(validateClaimsProvenance(evidence, raw).invalidProvenanceCount).toBe(0);
  });
  it("packs independently of coarse pages, deterministically with exact primary ownership, global inventory and Heroes", () => {
    const evidence = buildClaimsEvidenceUnits([{ pageNumber: 1, text: Array.from({ length: 80 }, (_, index) => `A stranger guards gate ${index}.`).join(" ") }]);
    const packing = packClaimsRequests(evidence, inventory, "gpt-6-luna", { target: 1300, maximum: 1600 });
    expect(packing.requests.length).toBeGreaterThan(1);
    expect(packing).toEqual(packClaimsRequests(evidence, inventory, "gpt-6-luna", { target: 1300, maximum: 1600 }));
    expect(packClaimsRequests(evidence, { entities: [{ ...inventory.entities[0], name: "Different Identity" }] }, "gpt-6-luna", { target: 1300, maximum: 1600 }).requests[0].requestId).not.toBe(packing.requests[0].requestId);
    expect(packing.ownership.map((item) => item.unitId)).toEqual(evidence.map((unit) => unit.unitId));
    expect(new Set(packing.ownership.map((item) => item.unitId)).size).toBe(evidence.length);
    for (const request of packing.requests) {
      expect(request.entities.map((entity) => entity.canonicalId)).toEqual(["entity-1", "system:heroes-party"]);
      expect(estimateClaimsInput(request)).toBeLessThanOrEqual(1600);
    }
    expect(packClaimsRequests(units(), inventory).ownership.filter((item) => item.primary)).toHaveLength(units().filter((unit) => unit.kind === "sentence").length);
    expect(() => packClaimsRequests(evidence, inventory, "gpt-5.6-luna")).toThrow("gpt-6-luna");
    const huge = buildClaimsEvidenceUnits([{ pageNumber: 1, text: "word ".repeat(CLAIMS_INPUT_MAXIMUM) }]);
    expect(() => packClaimsRequests(huge, inventory)).toThrow("Indivisible");
    expect(() => packClaimsRequests([...evidence, evidence[0]], inventory)).toThrow();
  });
});

describe("union and document-wide frozen reconciliation", () => {
  it("keeps original proposals in request/local order and calls v224 once with all global units", () => {
    const evidence = units();
    const requests = [documentClaimsRequest(evidence.slice(0, 3), inventory, "r-1"), documentClaimsRequest(evidence.slice(3), inventory, "r-2")];
    const first = { statement: "Mira is immortal.", participants: ["Mira"], evidence_unit_ids: [evidence[1].unitId] };
    const second = { statement: "Mira carries a key.", participants: ["Mira"], evidence_unit_ids: [evidence[4].unitId] };
    const outputs = [{ requestId: "r-2", output: { claims: [second] } }, { requestId: "r-1", output: { claims: [first] } }];
    const frozen = structuredClone(outputs);
    const union = unionDocumentClaims(requests, outputs);
    expect(union.unionedOutput.claims).toEqual([first, second]);
    expect(union.proposalProvenance).toEqual([{ globalProposalIndex: 0, extractionRequestId: "r-1", requestLocalProposalIndex: 0 },
      { globalProposalIndex: 1, extractionRequestId: "r-2", requestLocalProposalIndex: 0 }]);
    const spy = vi.spyOn(downstream, "reconcileClaims41DocumentV230");
    const wide = documentClaimsRequest(evidence, inventory, "document");
    const result = reconcileDocumentClaims(union, wide);
    expect(spy).toHaveBeenCalledExactlyOnceWith(union.unionedOutput, wide);
    expect(spy.mock.calls[0][1].evidenceUnits).toHaveLength(evidence.length);
    expect(result.rawProposals).toEqual(union.unionedOutput);
    expect(outputs).toEqual(frozen);
    spy.mockRestore();
    expect(() => unionDocumentClaims(requests, outputs.slice(0, 1))).toThrow();
  });
  it("retains every proposal above 400 at document scope while the historical entry point still rejects it", () => {
    const request = documentClaimsRequest(units(), inventory, "document");
    const claim = { statement: "Fog covers the valley.", participants: [], evidence_unit_ids: [units()[3].unitId] };
    const union = unionDocumentClaims([{ ...request, requestId: "a" }, { ...request, requestId: "b" }],
      [{ requestId: "a", output: { claims: Array(400).fill(claim) } }, { requestId: "b", output: { claims: [claim] } }]);
    expect(union.unionedOutput.claims).toHaveLength(401);
    expect(() => reconciler.reconcileClaims41V224(union.unionedOutput, request)).toThrow();
    expect(reconcileDocumentClaims(union, request).rawProposals).toEqual(union.unionedOutput);
  });
  it("lets reconciliation see alias evidence from a different extraction request", () => {
    const evidence = buildClaimsEvidenceUnits([{ pageNumber: 1, text: "Mira was also called Ember. Ember guards the door." }]);
    const requests = [documentClaimsRequest([evidence[0]], inventory, "alias"), documentClaimsRequest([evidence[1]], inventory, "door")];
    const union = unionDocumentClaims(requests, [
      { requestId: "alias", output: { claims: [{ statement: "Mira was also called Ember.", participants: ["Mira", "Ember"], evidence_unit_ids: [evidence[0].unitId] }] } },
      { requestId: "door", output: { claims: [{ statement: "Ember guards the door.", participants: ["Ember"], evidence_unit_ids: [evidence[1].unitId] }] } },
    ]);
    const result = reconcileDocumentClaims(union, documentClaimsRequest(evidence, inventory, "wide"));
    expect(result.aliasMetadata.some((alias) => alias.alias === "Ember" && alias.entityId === "entity-1")).toBe(true);
    expect(result.claims[1].entityAssociations.some((association) => association.canonicalId === "entity-1")).toBe(true);
    expect(result.rawProposals).toEqual(union.unionedOutput);
  });
  it.each([500, 1200])("reconciles a %i-proposal union once with exact raw order and global indexes", (count) => {
    const request = documentClaimsRequest(units(), inventory, "document");
    const perRequest = count === 500 ? 250 : 300;
    const requests = Array.from({ length: count / perRequest }, (_, index) => ({ ...request, requestId: `r-${index}` }));
    const outputs = requests.map((request, index) => ({ requestId: request.requestId, output: { claims: Array.from({ length: perRequest }, (_, local) => ({
      statement: `  Fog covers the valley ${index * perRequest + local}.  `, participants: [], evidence_unit_ids: [units()[3].unitId],
    })) } }));
    const originals = structuredClone(outputs.flatMap((item) => item.output.claims));
    const union = unionDocumentClaims(requests, [...outputs].reverse());
    expect(claims41DocumentUnionSchema.safeParse(union.unionedOutput).success).toBe(true);
    expect(union.unionedOutput.claims).toEqual(originals);
    const spy = vi.spyOn(downstream, "reconcileClaims41DocumentV230");
    const result = reconcileDocumentClaims(union, request);
    expect(spy).toHaveBeenCalledExactlyOnceWith(union.unionedOutput, request);
    spy.mockRestore();
    expect(result.rawProposals.claims).toEqual(originals);
    expect(result.claims.map((claim) => claim.original)).toEqual(originals);
    expect(result.claims.map((claim) => claim.proposalIndex)).toEqual(Array.from({ length: count }, (_, index) => index));
    expect(union.proposalProvenance).toEqual(Array.from({ length: count }, (_, index) => ({ globalProposalIndex: index,
      extractionRequestId: requests[Math.floor(index / perRequest)].requestId, requestLocalProposalIndex: index % perRequest })));
    expect(result.version).toBe("claims-4-1-reconciliation-2.3.0");
  });
  it("still rejects 401 claims in a single model response before union", () => {
    const request = documentClaimsRequest(units(), inventory, "request");
    const output = { claims: Array.from({ length: 401 }, () => ({ statement: "Fog covers the valley.", participants: [], evidence_unit_ids: [units()[3].unitId] })) };
    expect(claims41OutputSchema.safeParse(output).success).toBe(false);
    expect(() => unionDocumentClaims([request], [{ requestId: request.requestId, output }])).toThrow();
    expect(() => reconciler.reconcileClaims41V224(output, request)).toThrow();
  });
  it("uses the same core for the historical entry point without altering its result", () => {
    const request = documentClaimsRequest(units(), inventory, "request");
    const output = { claims: [{ statement: "Fog covers the valley.", participants: [], evidence_unit_ids: [units()[3].unitId] }] };
    expect(reconciler.reconcileClaims41V224(output, request)).toEqual(reconciler.reconcileClaims41DocumentV224(output, request));
  });
  it("validates the strict union container and every frozen item, including after index 400", () => {
    const request = documentClaimsRequest(units(), inventory, "request");
    const valid = { statement: "Fog covers the valley.", participants: [], evidence_unit_ids: [units()[3].unitId] };
    for (const invalid of [{ ...valid, statement: "x".repeat(901) }, { ...valid, participants: Array(25).fill("person") },
      { ...valid, evidence_unit_ids: Array(6).fill("unit") }, { ...valid, unexpected: true }]) {
      const output = { claims: [...Array(500).fill(valid), invalid] };
      expect(claims41DocumentUnionSchema.safeParse(output).success).toBe(false);
      expect(() => reconciler.reconcileClaims41DocumentV224(output, request)).toThrow();
    }
    expect(claims41DocumentUnionSchema.safeParse({ claims: [valid], unexpected: true }).success).toBe(false);
    expect(claims41DocumentUnionSchema.safeParse({ claims: "invalid" }).success).toBe(false);
  });
  it("keeps frozen prompt/schema identities and isolates graph/persistence/frontend stages", () => {
    expect(claims41PromptHash()).toBe("d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58");
    expect(claims41SchemaHash()).toBe("16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb");
    const source = readFileSync("lib/ai/claims-document-pipeline.ts", "utf8");
    for (const forbidden of ["persistCanonicalGraph", "buildLeanGraphCore", "runGraphFirstPass", "runSpanGraphExtraction", "supabase", "app/"]) expect(source).not.toContain(forbidden);
  });
});

describe("durable authorization and retries", () => {
  it("requires an exact explicit stage allowlist and call count and blocks wrong models", () => {
    expect(CLAIMS_DOCUMENT_CLIENT_OPTIONS.maxRetries).toBe(0);
    expect(() => authorizeDocumentStage(auth(["a"]), ["a"])).not.toThrow();
    expect(() => authorizeDocumentStage({ ...auth(["a"]), allowedRequestIds: [] }, ["a"])).toThrow("allowlist");
    expect(() => authorizeDocumentStage({ ...auth(["a"]), maxCalls: 2 }, ["a"])).toThrow("max-call");
    expect(() => authorizeDocumentStage({ ...auth(["a"]), authorization: undefined }, ["a"])).toThrow("authorization");
    expect(() => authorizeDocumentStage(auth(["a"]), ["a"], "gpt-5.6-luna")).toThrow("gpt-6-luna");
    expect(() => assertDocumentModelPolicy([{ modelId: "gpt-6-luna" }, { modelId: "gpt-5.6-luna" }])).toThrow("Distinct planned");
    expect(assertDocumentModelPolicy([{ modelId: "gpt-6-luna" }, { modelId: "gpt-6-luna" }])).toEqual(["gpt-6-luna"]);
  });
  it("commits an attempt before dispatch, persists raw output/usage and revalidates compatible success on resume", async () => {
    const directory = mkdtempSync(join(tmpdir(), "claims-document-"));
    const create = vi.fn(async () => { expect(readdirSync(directory).some((name) => name.endsWith(".attempt.json"))).toBe(true); return response({ answer: "yes" }); });
    const runtime = durableDocumentProvider(directory, auth(["op-1"]), ["op-1"], { responses: { create } } as never);
    await runtime.providerFor(operation).parseStructured(input);
    expect(create.mock.calls).toHaveLength(1);
    const resumed = durableDocumentProvider(directory, auth(["op-1"]), ["op-1"], { responses: { create } } as never);
    expect((await resumed.providerFor(operation).parseStructured(input)).output).toEqual({ answer: "yes" });
    expect(resumed.calls).toBe(0);
    const filename = readdirSync(directory).find((name) => name.endsWith(".success.json"))!;
    const saved = JSON.parse(readFileSync(join(directory, filename), "utf8"));
    saved.result.output = { answer: 123 };
    writeFileSync(join(directory, filename), JSON.stringify(saved));
    await expect(resumed.providerFor(operation).parseStructured(input)).rejects.toThrow("Invalid cached");
    expect(create).toHaveBeenCalledTimes(1);
    expect(operationIdentity(operation, input)).not.toEqual(operationIdentity({ ...operation, sourceHash: "changed" }, input));
    expect(operationIdentity(operation, input)).not.toEqual(operationIdentity({ ...operation, upstreamFingerprint: "changed" }, input));
    expect(operationIdentity(operation, input)).not.toEqual(operationIdentity({ ...operation, behaviorVersion: "changed" }, input));
  });
  it("blocks ambiguous transport failures and incomplete responses without retry", async () => {
    for (const mode of ["transport", "incomplete"]) {
      const directory = mkdtempSync(join(tmpdir(), "claims-document-"));
      const create = vi.fn().mockImplementation(() => mode === "transport" ? Promise.reject(new Error("transport")) : Promise.resolve({ ...response({ answer: "yes" }), status: "incomplete" }));
      const runtime = durableDocumentProvider(directory, auth(["op-1"]), ["op-1"], { responses: { create } } as never);
      await expect(runtime.providerFor(operation).parseStructured(input)).rejects.toThrow();
      const resumed = durableDocumentProvider(directory, auth(["op-1"]), ["op-1"], { responses: { create } } as never);
      await expect(resumed.providerFor(operation).parseStructured(input)).rejects.toThrow("prior dispatch");
      expect(create).toHaveBeenCalledTimes(1);
    }
  });
  it("never writes attempts or dispatches when a required inventory checkpoint is absent in reuse-only mode", async () => {
    const directory = mkdtempSync(join(tmpdir(), "claims-document-"));
    const create = vi.fn();
    const runtime = durableDocumentProvider(directory, auth(["op-1"]), ["op-1"], { responses: { create } } as never, true);
    await expect(runtime.providerFor(operation).parseStructured(input)).rejects.toThrow("checkpoint missing");
    expect(create).not.toHaveBeenCalled();
    expect(readdirSync(directory)).toEqual([]);
  });
  it("supports explicit generic provider caps and preserves payloads when absent", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { answer: "yes" }, ...response({ answer: "yes" }) });
    const provider = createOpenAIStructuredModelProvider("test-model", { responses: { parse } } as never);
    await provider.parseStructured(input);
    expect(parse.mock.calls[0][0]).not.toHaveProperty("max_output_tokens");
    await provider.parseStructured({ ...input, maxOutputTokens: 24000 });
    expect(parse.mock.calls[1][0].max_output_tokens).toBe(24000);
    await expect(provider.parseStructured({ ...input, maxOutputTokens: 0 })).rejects.toThrow("cap");
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"answer":"yes"}' } }] }) });
    const local = createLocalStructuredModelProvider({ providerId: "local", modelId: "test", baseUrl: "http://localhost:1", allowPersistence: false }, fetch);
    await local.parseStructured({ ...input, maxOutputTokens: 123 });
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_tokens).toBe(123);
  });
  it("runs the existing inventory backbone and new Claims path using only mocked responses, reconciling once", async () => {
    const plan = preflightClaimsDocument([{ pageNumber: 1, text: "Mira is immortal. Fog covers the valley." }], "hash", "synthetic.pdf");
    const createInventory = vi.fn().mockResolvedValue(response({ entities: [{ name: "Mira", type: "npc", page: 1 }] }));
    const dir = mkdtempSync(join(tmpdir(), "claims-inventory-"));
    const ids = plan.inventoryPlan.map((item) => item.requestId);
    const runtime = durableDocumentProvider(dir, auth(ids), ids, { responses: { create: createInventory } } as never);
    const inv = await runDocumentInventory(plan, runtime);
    expect(createInventory).toHaveBeenCalledTimes(2);
    expect(createInventory.mock.calls.every((call) => call[0].model === "gpt-6-luna" && call[0].max_output_tokens === 12000)).toBe(true);
    const packed = packClaimsRequests(plan.evidenceUnits, inv.finalInventory);
    const claimIds = packed.requests.map((request) => request.requestId);
    const createClaims = vi.fn().mockResolvedValue(response({ claims: [{ statement: "Mira is immortal.", participants: ["Mira"], evidence_unit_ids: [plan.evidenceUnits[0].unitId] }] }));
    const claimsRuntime = durableDocumentProvider(mkdtempSync(join(tmpdir(), "claims-run-")), auth(claimIds), claimIds, { responses: { create: createClaims } } as never);
    const spy = vi.spyOn(downstream, "reconcileClaims41DocumentV230");
    const preserve = vi.fn();
    const result = await runDocumentClaims(plan, inv.finalInventory, claimsRuntime, preserve);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(preserve).toHaveBeenCalledTimes(1);
    expect(result.claimsExtraction.evidenceUnits).toHaveLength(plan.evidenceUnits.length);
    expect(createClaims.mock.calls[0][0].max_output_tokens).toBe(24000);
    spy.mockRestore();
  });
});
