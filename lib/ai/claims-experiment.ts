import { z } from "zod";
import type { AIOperationIdentity } from "@/lib/ai/operation-checkpoint";
import { modelInputHash, semanticInputHash } from "@/lib/ai/operation-checkpoint";
import type { ExtractionContext, ExtractionContextEntity, RawSourceMapping, SourceSegment } from "@/lib/ai/extraction-context";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { boundedEntityContextInSemanticText } from "@/lib/graph/occurrence-index";
import { normalizeName } from "@/lib/graph/normalize";
import { normalizeSimpleGraphV3EvidenceSegmentId } from "@/lib/ai/simple-graph-v3";

export const CLAIM_BEHAVIOR_VERSION = "v0.6.7-claims-1";
export const CLAIM_SCHEMA_VERSION = 1;
export const CLAIM_PROMPT = `Extract important explicit claims from the entire supplied source. A claim is one coherent proposition and may involve any number of supplied known entities. Preserve multi-entity meaning instead of decomposing one proposition into pairwise relationships. List every supplied entity materially involved. Make statements self-contained and strictly source-supported. Do not invent lore, infer unsupported claims, or output redundant paraphrases. Cite the supporting page and exact evidence segment ID. Use only the fixed claim schema.`;

export const claimOutputSchema = z.object({ claims: z.array(z.object({
  statement: z.string().trim().min(1).max(500),
  entities: z.array(z.string().trim().min(1).max(200)).min(1),
  page: z.number().int().positive(),
  evidence_segment: z.string().trim().min(1).max(40),
}).strict()).max(200) }).strict();
export type ClaimOutput = z.infer<typeof claimOutputSchema>;
export interface ClaimRequest { requestId: string; sourceSegments: SourceSegment[]; entities: ExtractionContextEntity[] }
export interface ValidClaim { statement: string; entityIds: string[]; entities: string[]; provenance: Array<RawSourceMapping & { segmentId: string }> }

export function planTest9ClaimRequests(context: ExtractionContext): ClaimRequest[] {
  const groups = [[10, 11, 12], [13, 14]];
  if (context.sourceSegments.some((segment) => !groups.flat().includes(segment.page))) throw new Error("Unexpected Test 9 page");
  return groups.map((pages, index) => {
    const sourceSegments = context.sourceSegments.filter((segment) => pages.includes(segment.page));
    if (pages.some((page) => !sourceSegments.some((segment) => segment.page === page))) throw new Error(`Missing Test 9 page in chunk ${index + 1}`);
    const candidates = context.entities.map((entity) => ({ temporary_id: entity.canonicalId, name: entity.name, type: entity.type, aliases: entity.aliases }));
    const ids = new Set(boundedEntityContextInSemanticText(candidates, sourceSegments.map((segment) => segment.semanticText).join("\n")).entityIds);
    return { requestId: `test9-claims-${index + 1}`, sourceSegments, entities: context.entities.filter((entity) => ids.has(entity.canonicalId)) };
  });
}

export function serializeClaimRequest(request: ClaimRequest) {
  const entityContext = request.entities.map((entity) => `${entity.name} | ${entity.type}${entity.aliases.length ? ` | aliases: ${entity.aliases.join(", ")}` : ""}`).join("\n");
  const source = request.sourceSegments.map((segment) => `[${segment.segmentId}] ${segment.semanticText}`).join("\n");
  return { entityContext, source, payload: `KNOWN ENTITIES\n${entityContext || "(none)"}\n\nSOURCE\n${source}` };
}

export function claimTokenDiagnostics(request: ClaimRequest) {
  const { entityContext, source } = serializeClaimRequest(request);
  const characters = { source: source.length, entity: entityContext.length, prompt: CLAIM_PROMPT.length, schema: JSON.stringify(z.toJSONSchema(claimOutputSchema)).length };
  const estimatedTokens = Object.fromEntries(Object.entries(characters).map(([key, value]) => [key, Math.ceil(value / 4)])) as Record<keyof typeof characters, number>;
  return { characters, estimatedTokens: { ...estimatedTokens, totalInput: Object.values(estimatedTokens).reduce((sum, value) => sum + value, 0) } };
}

function matches(entities: ExtractionContextEntity[], value: string) {
  const normalized = normalizeName(value);
  const canonical = entities.filter((entity) => normalizeName(entity.name) === normalized);
  if (canonical.length) return canonical;
  const alias = entities.filter((entity) => entity.aliases.some((name) => normalizeName(name) === normalized));
  if (alias.length) return alias;
  const article = normalized.startsWith("the ") ? normalized.slice(4) : `the ${normalized}`;
  return entities.filter((entity) => [entity.name, ...entity.aliases].some((name) => normalizeName(name) === article));
}

function claimKey(claim: ValidClaim) {
  return JSON.stringify([claim.statement.toLowerCase().replace(/\s+/gu, " ").trim(), [...claim.entityIds].sort()]);
}

export function validateAndUnionClaims(outputs: Array<{ requestId: string; output: ClaimOutput }>, requests: ClaimRequest[]) {
  const byRequest = new Map(requests.map((request) => [request.requestId, request]));
  if (outputs.length !== requests.length || new Set(outputs.map((item) => item.requestId)).size !== requests.length || outputs.some((item) => !byRequest.has(item.requestId))) throw new Error("Exactly one output per Claim request is required");
  const result = { proposed: 0, claims: [] as ValidClaim[], duplicates: 0, unknownParticipants: 0, ambiguousParticipants: 0, duplicateParticipants: 0, invalidSegments: 0, invalidPageSegments: 0 };
  const retained = new Map<string, ValidClaim>();
  for (const { requestId, output } of outputs) {
    const request = byRequest.get(requestId)!;
    const segments = new Map(request.sourceSegments.map((segment) => [segment.segmentId, segment]));
    for (const candidate of claimOutputSchema.parse(output).claims) {
      result.proposed += 1;
      const segmentId = normalizeSimpleGraphV3EvidenceSegmentId(candidate.evidence_segment, new Set(segments.keys()));
      const segment = segmentId ? segments.get(segmentId) : undefined;
      if (!segment) { result.invalidSegments += 1; continue; }
      if (segment.page !== candidate.page) { result.invalidPageSegments += 1; continue; }
      const resolutions = candidate.entities.map((name) => matches(request.entities, name));
      if (resolutions.some((items) => items.length === 0)) { result.unknownParticipants += 1; continue; }
      if (resolutions.some((items) => items.length !== 1)) { result.ambiguousParticipants += 1; continue; }
      const entities = resolutions.map((items) => items[0]);
      const ids = entities.map((entity) => entity.canonicalId);
      if (new Set(ids).size !== ids.length) { result.duplicateParticipants += 1; continue; }
      const claim: ValidClaim = { statement: candidate.statement, entityIds: ids, entities: entities.map((entity) => entity.name), provenance: [{ segmentId: segment.segmentId, ...segment.rawSource }] };
      const key = claimKey(claim);
      const prior = retained.get(key);
      if (prior) {
        result.duplicates += 1;
        if (!prior.provenance.some((item) => item.segmentId === segment.segmentId)) prior.provenance.push(claim.provenance[0]);
      } else retained.set(key, claim);
    }
  }
  result.claims = [...retained.values()];
  return result;
}

export function claimCheckpointIdentity(args: { request: ClaimRequest; fixtureHash: string; contextFingerprint: string; modelId: string }): AIOperationIdentity {
  return { campaignId: "test9-fixture", documentId: args.fixtureHash, sourceExtractionCacheId: null, providerId: "openai", modelId: args.modelId,
    processingMode: "claims_experiment", stage: "extraction", operationType: "claims_experiment", operationKey: args.request.requestId,
    inputHash: modelInputHash(CLAIM_PROMPT, serializeClaimRequest(args.request).payload),
    upstreamFingerprint: semanticInputHash({ contextFingerprint: args.contextFingerprint, entities: args.request.entities, segments: args.request.sourceSegments.map((segment) => segment.segmentId) }),
    behaviorVersion: CLAIM_BEHAVIOR_VERSION, schemaVersion: CLAIM_SCHEMA_VERSION };
}

export function runClaimExtraction(request: ClaimRequest, provider: StructuredModelProvider) {
  return provider.parseStructured({ system: CLAIM_PROMPT, payload: serializeClaimRequest(request).payload, schema: claimOutputSchema, schemaName: "test9_claims_output" });
}
