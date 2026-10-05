import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { EvidenceUnit } from "./claims-2-experiment";
import type { GraphInventory } from "./entity-reconciliation";
import { CLAIMS_4_1_PROMPT, claims41OutputSchema, claims41DocumentUnionSchema } from "./claims-4-1-experiment";
import { documentClaimsRequest } from "./claims-document-source";
import { annotateSourceStructure } from "./claims-source-structure";
import { normalizeClaimsInventory } from "./claims-inventory-normalization";
import { reconcileClaims41DocumentV230 } from "./claims-4-1-reconciliation-v2-3-0";

export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const frozenHashes = () => ({ prompt: sha256(CLAIMS_4_1_PROMPT), schema: sha256(JSON.stringify(z.toJSONSchema(claims41OutputSchema))) });
export function verifyAcceptanceBundle(directory: string, expectedManifestHash: string) {
  const root = resolve(directory);
  const bytes = readFileSync(resolve(root, "MANIFEST.json"));
  if (sha256(bytes) !== expectedManifestHash) throw new Error("Acceptance manifest hash mismatch");
  const manifest = JSON.parse(bytes.toString("utf8")) as { artifacts: Array<{ path: string; bytes: number; sha256: string }> };
  const verified = new Map<string, Buffer>();
  for (const entry of manifest.artifacts) {
    const path = resolve(root, entry.path);
    if (!path.startsWith(root + sep) || verified.has(entry.path)) throw new Error("Invalid manifest path");
    const payload = readFileSync(path);
    if (payload.length !== entry.bytes || sha256(payload) !== entry.sha256) throw new Error(`Artifact hash mismatch: ${entry.path}`);
    verified.set(entry.path, payload);
  }
  return { manifestHash: sha256(bytes), read: <T>(name: string): T => {
    const bytes = verified.get(name);
    if (!bytes) throw new Error(`Unverified input: ${name}`);
    return JSON.parse(bytes.toString("utf8")) as T;
  }, bytes: (name: string) => {
    const bytes = verified.get(name);
    if (!bytes) throw new Error(`Unverified input: ${name}`);
    return bytes;
  } };
}

/** Pure deterministic stages are injectable for future acceptance comparisons. */
export function replayAcceptanceBundle(bundle: ReturnType<typeof verifyAcceptanceBundle>, stages = {
  structure: annotateSourceStructure, inventory: normalizeClaimsInventory, reconcile: reconcileClaims41DocumentV230,
}) {
  const raw = bundle.read<Parameters<typeof reconcileClaims41DocumentV230>[0]>("claims-raw.v1.json");
  claims41DocumentUnionSchema.parse(raw);
  const provenance = bundle.read<Array<{ globalProposalIndex: number; extractionRequestId: string; requestLocalProposalIndex: number }>>("proposal-provenance.v1.json");
  if (provenance.length !== raw.claims.length || provenance.some((p, i) => p.globalProposalIndex !== i)) throw new Error("Invalid global proposal provenance");
  const originalUnits = bundle.read<EvidenceUnit[]>("claims/evidence-units.v1.json");
  const originalInventory = bundle.read<{ finalInventory: GraphInventory }>("inventory-review.v1.json").finalInventory;
  const structure = stages.structure(originalUnits);
  if (!isDeepStrictEqual(structure.units.map(u => [u.unitId, u.rawSource, u.order, u.text]), originalUnits.map(u => [u.unitId, u.rawSource, u.order, u.text]))) throw new Error("Source spans/IDs changed");
  const normalized = stages.inventory(originalInventory, originalUnits);
  const before = bundle.read<ReturnType<typeof reconcileClaims41DocumentV230>>("reconciliation.v1.json");
  const result = stages.reconcile(raw, documentClaimsRequest(structure.units, normalized.inventory, "claims4-1-document-wide"));
  if (!isDeepStrictEqual(raw, result.rawProposals) || result.claims.some((c, i) => c.proposalIndex !== i || !isDeepStrictEqual(c.original, raw.claims[i]))) throw new Error("Raw proposals/indexes changed");
  const summarize = (r: typeof result, inventory: GraphInventory) => {
    const counts = (values: string[]) => values.reduce<Record<string, number>>((out, v) => { out[v] = (out[v] ?? 0) + 1; return out; }, {});
    const groups = counts(r.candidateEntities.map(e => e.name.toLowerCase().trim()));
    return { inventoryEntities: inventory.entities.length, aliases: inventory.entities.reduce((n, e) => n + (e.aliases?.length ?? 0), 0),
      ambiguousSameNameGroups: Object.values(counts(inventory.entities.map(e => e.name.toLowerCase().trim()))).filter(n => n > 1).length,
      rawProposals: r.rawProposals.claims.length, rawProposalHash: sha256(JSON.stringify(r.rawProposals)),
      resolution: counts(r.claims.map(c => c.resolutionState ?? "mechanical_only")), participants: counts(r.claims.flatMap(c => c.participants.map(p => p.kind))),
      candidateEntities: r.candidateEntities.length, duplicateNormalizedCandidateGroups: Object.values(groups).filter(n => n > 1).length,
      entityAssociatedClaims: r.claims.filter(c => c.entityAssociations.length).length, timelineAssociatedClaims: r.claims.filter(c => c.timelineAssociation).length,
      noUsefulHome: r.claims.filter(c => c.wikiDisposition === "present" && !c.entityAssociations.length && !c.timelineAssociation).length,
      sourceStatus: counts(r.claims.map(c => c.sourceStatus)), contextEvidenceClaims: r.claims.filter(c => c.contextEvidence.length).length,
      contextEvidenceReferences: r.claims.reduce((n, c) => n + c.contextEvidence.length, 0), gmReview: r.gmReview.length };
  };
  return { originalUnits, originalInventory, structure, normalized, result, provenance,
    summary: { before: summarize(before, originalInventory), after: summarize(result, normalized.inventory), merges: normalized.merges.length,
      rawProposalHashEquivalent: sha256(JSON.stringify(before.rawProposals)) === sha256(JSON.stringify(result.rawProposals)),
      acceptanceManifestHash: bundle.manifestHash, hashes: frozenHashes(), modelCalls: 0, apiCalls: 0, documentWideExecutions: 1 } };
}
