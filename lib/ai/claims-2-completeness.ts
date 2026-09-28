import { z } from "zod";
import type { AIOperationIdentity } from "@/lib/ai/operation-checkpoint";
import { modelInputHash, semanticInputHash } from "@/lib/ai/operation-checkpoint";
import { claims2OutputSchema, serializeClaims2Request, validateAndUnionClaims2, type Claims2Claim, type Claims2Output, type Claims2Request } from "@/lib/ai/claims-2-experiment";

export const COMPLETENESS_BEHAVIOR_VERSION = "v0.6.7-claims-2-completeness-1";
export const COMPLETENESS_SCHEMA_VERSION = 1;
export const COMPLETENESS_PROMPT = `Find independently useful, explicit propositions missing from EXISTING CLAIMS. Read the whole SOURCE, including its deterministic SOURCE CONTEXT. Existing claims are coverage, not facts to repeat or paraphrase. Return only genuinely missing facts: descriptive, identity, status, capability, belief, relationship, location, or event propositions. Make one coherent proposition per claim. Keep genuinely connected participants together, but split independent story beats. Preserve source attribution, uncertainty, and hypothetical assumptions. Cite evidence supporting the ENTIRE statement: one unit by default, or two adjacent units only when necessary for context or pronoun resolution. Never cite a heading. List only materially participating canonical entities from KNOWN ENTITIES. Document and adventure references are references, not in-world places or events. Do not infer lore, invent facts, or repeat existing claims or paraphrases. If nothing useful is missing, return an empty claims array. Return only statement, entities, and evidence_units.`;

export const completenessOutputSchema = claims2OutputSchema;
export type CompletenessOutput = Claims2Output;
export interface CompletenessRequest { requestId: string; base: Claims2Request; existingClaims: Claims2Claim[] }

export function planCompletenessRequests(baseRequests: Claims2Request[], existingClaims: Claims2Claim[]): CompletenessRequest[] {
  const assigned = new Set<Claims2Claim>();
  const planned = baseRequests.map((base) => {
    const ids = new Set(base.evidenceUnits.map((unit) => unit.unitId));
    const relevant = existingClaims.filter((claim) => claim.provenance.some((item) => item.unitIds.some((id) => ids.has(id))));
    relevant.forEach((claim) => {
      if (assigned.has(claim)) throw new Error("Existing claim belongs to more than one chunk");
      assigned.add(claim);
    });
    return { requestId: base.requestId.replace("claims2-", "claims2-completeness-"), base, existingClaims: relevant };
  });
  if (assigned.size !== existingClaims.length) throw new Error("Existing Claims-2 coverage was omitted from completeness input");
  return planned;
}

export function serializeCompletenessRequest(request: CompletenessRequest) {
  const base = serializeClaims2Request(request.base);
  const coverage = request.existingClaims.map((claim, index) => {
    const ids = [...new Set(claim.provenance.flatMap((item) => item.unitIds))];
    return `${index + 1}. [${ids.join(",")}] ${claim.statement}`;
  }).join("\n");
  return { source: base.source, entities: base.entityContext, coverage,
    payload: `${base.payload}\n\nEXISTING CLAIMS (${request.existingClaims.length}; all relevant saved claims)\n${coverage || "(none)"}` };
}

export function completenessTokenDiagnostics(request: CompletenessRequest) {
  const serialized = serializeCompletenessRequest(request);
  const characters = { source: serialized.source.length, entities: serialized.entities.length, coverage: serialized.coverage.length,
    prompt: COMPLETENESS_PROMPT.length, schema: JSON.stringify(z.toJSONSchema(completenessOutputSchema)).length };
  const estimatedTokens = Object.fromEntries(Object.entries(characters).map(([key, count]) => [key, Math.ceil(count / 3)])) as Record<keyof typeof characters, number>;
  return { characters, estimatedTokens: { ...estimatedTokens, totalInput: Object.values(estimatedTokens).reduce((sum, count) => sum + count, 0) } };
}

export function completenessCheckpointIdentity(args: { request: CompletenessRequest; fixtureHash: string; contextFingerprint: string; baselineFingerprint: string; modelId: string; maxOutputTokens: number; sdkMaxRetries: number }): AIOperationIdentity {
  return { campaignId: "test9-fixture", documentId: args.fixtureHash, sourceExtractionCacheId: null, providerId: "openai", modelId: args.modelId,
    processingMode: "claims_experiment", stage: "extraction", operationType: "claims_2_completeness_experiment", operationKey: args.request.requestId,
    inputHash: modelInputHash(COMPLETENESS_PROMPT, { payload: serializeCompletenessRequest(args.request).payload, maxOutputTokens: args.maxOutputTokens, sdkMaxRetries: args.sdkMaxRetries }),
    upstreamFingerprint: semanticInputHash({ contextFingerprint: args.contextFingerprint, baselineFingerprint: args.baselineFingerprint, units: args.request.base.evidenceUnits }),
    behaviorVersion: COMPLETENESS_BEHAVIOR_VERSION, schemaVersion: COMPLETENESS_SCHEMA_VERSION };
}

function normalized(value: string) { return value.toLowerCase().replace(/\s+/gu, " ").trim(); }

export function reviewCompletenessCandidates(request: CompletenessRequest, output: CompletenessOutput) {
  const baseline = request.existingClaims;
  const units = new Map(request.base.evidenceUnits.map((unit) => [unit.unitId, unit]));
  return completenessOutputSchema.parse(output).claims.map((candidate, index) => {
    const checked = validateAndUnionClaims2([{ requestId: request.base.requestId, output: { claims: [candidate] } }], [request.base]);
    const rejectionReason = checked.claims.length ? null : (Object.entries({ invalidUnits: checked.invalidUnits, headingCitations: checked.headingCitations,
      crossContextUnits: checked.crossContextUnits, nonadjacentUnits: checked.nonadjacentUnits, unknownParticipants: checked.unknownParticipants,
      ambiguousParticipants: checked.ambiguousParticipants, duplicateParticipants: checked.duplicateParticipants }).find(([, count]) => count > 0)?.[0] ?? "unknown");
    const claim = checked.claims[0] ?? null;
    const exactDuplicates = claim ? baseline.map((prior, position) => ({ prior, position })).filter(({ prior }) => normalized(prior.statement) === normalized(claim.statement) &&
      prior.context === claim.context && JSON.stringify([...prior.entityIds].sort()) === JSON.stringify([...claim.entityIds].sort())).map(({ position }) => position + 1) : [];
    const sharedEvidence = baseline.map((prior, position) => ({ prior, position })).filter(({ prior }) => prior.provenance.some((item) => item.unitIds.some((id) => candidate.evidence_units.includes(id)))).map(({ position }) => position + 1);
    return { candidateNumber: index + 1, statement: candidate.statement, suppliedEntities: candidate.entities, canonicalEntities: claim?.entities ?? null,
      inheritedContext: claim?.context ?? null, citedEvidence: candidate.evidence_units.map((id) => ({ unitId: id, source: units.get(id)?.rawSource ?? null, context: units.get(id)?.context ?? null })),
      structuralRejectionReason: rejectionReason, exactNormalizedDuplicates: exactDuplicates, potentialOverlap: { sharedEvidenceClaimNumbers: sharedEvidence, reviewOnly: true } };
  });
}
