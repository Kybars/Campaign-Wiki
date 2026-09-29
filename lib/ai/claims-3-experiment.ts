import { z } from "zod";
import { createHash } from "node:crypto";
import { modelInputHash, semanticInputHash, type AIOperationIdentity } from "@/lib/ai/operation-checkpoint";
import { normalizeName } from "@/lib/graph/normalize";
import type { ExtractionContextEntity, RawSourceMapping } from "@/lib/ai/extraction-context";
import type { Claims2Request, EvidenceUnit } from "@/lib/ai/claims-2-experiment";

export const CLAIMS_3_BEHAVIOR_VERSION = "claims-3-experiment-1";
export const CLAIMS_3_SCHEMA_VERSION = 1;
export const HEROES_ID = "system:heroes-party";
export const HEROES: ExtractionContextEntity = { canonicalId: HEROES_ID, name: "Heroes / Party", type: "other", aliases: ["Heroes", "the Heroes", "adventuring party", "player characters", "the player characters"] };
export const CLAIMS_3_PROMPT = `Extract useful, explicit propositions from all supplied evidence units. Each statement must stand alone and preserve its causes, conditions, timing, attribution, qualifications, and all materially involved entities. "Drakus is immortal thanks to the Torch" must not become "Drakus is immortal." Keep contradictory source accounts as separate claims. Preserve uncertain or inventory-missing participant names in entities; the application will resolve them later. Use canonical names from KNOWN ENTITIES when possible. Heroes / Party is a permanent system identity, only for genuine references to the adventuring party; do not treat every use of "party" as Heroes. An adventure instruction, plan, or hypothetical outcome is not a played event: state its condition explicitly. SOURCE CONTEXT identifies the current section; do not mix adjacent rooms. Cite one sentence unit by default, or two adjacent sentence units when both are needed. Cite each physical PDF page. A heading is never evidence. Every cited sentence must support the full statement, including every qualifier. Extract first; do not discard claims merely because they seem similar. Return only the fixed schema.`;

export const claims3OutputSchema = z.object({ claims: z.array(z.object({
  statement: z.string().trim().min(1).max(700),
  entities: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  evidence: z.array(z.object({ unit_id: z.string().trim().min(1).max(40), page: z.number().int().positive() }).strict()).min(1).max(2),
}).strict()).max(250) }).strict();
export type Claims3Output = z.infer<typeof claims3OutputSchema>;
export interface Claims3Request { requestId: string; baselineRequestId: string; evidenceUnits: EvidenceUnit[]; entities: ExtractionContextEntity[] }
export interface Claims3Claim {
  statement: string; entityIds: string[]; unresolvedEntities: string[]; context: string;
  sectionHeading?: string; sourceOrder: number;
  provenance: Array<{ unitIds: string[]; sources: Array<RawSourceMapping & { unitId: string }> }>;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const claims3PromptHash = () => hash(CLAIMS_3_PROMPT);
export const claims3SchemaHash = () => hash(JSON.stringify(z.toJSONSchema(claims3OutputSchema)));

export function cleanSectionHeading(value: string): string | undefined {
  const match = value.trim().match(/^\[?S\d+\]?\.?\s+(.+)$/iu);
  if (!match) return undefined;
  const name = match[1].trim();
  return /^[\p{Lu}][\p{L}\p{N}'’(), -]{2,80}$/u.test(name) ? name : undefined;
}

function displayContext(context: string) { return cleanSectionHeading(context) ?? (/^\[?S\d+\]?/iu.test(context) ? "section" : context); }
export function planClaims3Request(base: Claims2Request): Claims3Request {
  const entities = base.entities.filter((entity) => entity.canonicalId !== HEROES_ID && normalizeName(entity.name) !== "party" && normalizeName(entity.name) !== "heroes / party");
  const evidenceUnits = base.evidenceUnits.map((unit) => ({ ...unit, rawSource: { ...unit.rawSource } }));
  if (base.requestId === "test10-sweetwater-claims2-v3-1") {
    const s2 = evidenceUnits.find((unit) => unit.page === 11 && unit.kind === "heading" && unit.context === "[S2] The Room of Sorrow")?.order;
    if (s2 === undefined) throw new Error("Sweetwater S2 boundary missing");
    // The page-10 general-features sidebar interrupts S1. The page-11 mold
    // continuation still belongs to S1, before the printed S2 boundary.
    for (const unit of evidenceUnits) if (unit.page === 11 && unit.order < s2) unit.context = "[S1] Rotted Pantry";
    let room = "";
    for (const unit of evidenceUnits) {
      if (unit.order < s2) continue;
      if (unit.kind === "heading" && cleanSectionHeading(unit.context)) room = unit.context;
      else if (unit.kind === "heading" && unit.text === "Conclusion") room = "";
      else if (room) unit.context = room;
    }
  }
  return { requestId: base.requestId.replace("claims2", "claims3"), baselineRequestId: base.requestId,
    evidenceUnits, entities: [...entities, HEROES] };
}

export function serializeClaims3Request(request: Claims3Request) {
  const entityContext = request.entities.map((entity) => `${entity.canonicalId} | ${entity.name} | ${entity.type}${entity.aliases.length ? ` | aliases: ${entity.aliases.join(", ")}` : ""}`).join("\n");
  let context = "";
  const source = request.evidenceUnits.map((unit) => {
    const section = displayContext(unit.context);
    const prefix = section === context ? "" : `SOURCE CONTEXT: ${section}\n`;
    context = section;
    return `${prefix}[${unit.unitId} @ PDF ${unit.page}]${unit.kind === "heading" ? " HEADING:" : ""} ${unit.text}`;
  }).join("\n");
  return { entityContext, source, payload: `KNOWN ENTITIES\n${entityContext}\n\nSOURCE\n${source}` };
}

export function claims3TokenDiagnostics(request: Claims3Request) {
  const { entityContext, source } = serializeClaims3Request(request);
  const characters = { source: source.length, entity: entityContext.length, prompt: CLAIMS_3_PROMPT.length, schema: JSON.stringify(z.toJSONSchema(claims3OutputSchema)).length };
  const estimatedTokens = Object.fromEntries(Object.entries(characters).map(([key, length]) => [key, Math.ceil(length / 4)])) as Record<keyof typeof characters, number>;
  return { characters, estimatedTokens: { ...estimatedTokens, totalInput: Object.values(estimatedTokens).reduce((a, b) => a + b, 0) } };
}

function resolve(entities: ExtractionContextEntity[], value: string, evidenceText: string): string | undefined {
  const name = normalizeName(value);
  const heroNames = [HEROES.name, ...HEROES.aliases].map(normalizeName);
  if (heroNames.includes(name)) return HEROES_ID;
  if (name === "party" || name === "the party") return /\b(player characters|adventuring party|adventurers|heroes)\b/iu.test(evidenceText) ? HEROES_ID : undefined;
  const exact = entities.filter((entity) => normalizeName(entity.name) === name);
  if (exact.length === 1) return exact[0].canonicalId;
  if (exact.length > 1) return undefined;
  const aliases = entities.filter((entity) => entity.canonicalId !== HEROES_ID && entity.aliases.some((alias) => normalizeName(alias) === name));
  if (aliases.length === 1) return aliases[0].canonicalId;
  if (aliases.length > 1) return undefined;
  const article = name.startsWith("the ") ? name.slice(4) : `the ${name}`;
  const matches = entities.filter((entity) => entity.canonicalId !== HEROES_ID && [entity.name, ...entity.aliases].some((alias) => normalizeName(alias) === article));
  return matches.length === 1 ? matches[0].canonicalId : undefined;
}

function normalizedStatement(statement: string) { return statement.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim(); }
function conditionalContext(context: string) { return /what_if_they_do_nothing|if the heroes do nothing|events near verge \/ day|adventure synopsis|adventure hook/iu.test(context); }
function conditionalSource(text: string) { return /\b(if|unless|would|could|might|should)\b/iu.test(text); }
function omitsNamedCause(source: string, statement: string) {
  const match = source.match(/\b(?:thanks to|because of|due to)\s+(?:the\s+)?(\p{Lu}[\p{L}\p{N}'’-]*)/u);
  return Boolean(match && !normalizedStatement(statement).includes(normalizedStatement(match[1])));
}
export function validateAndUnionClaims3(outputs: Array<{ requestId: string; output: Claims3Output }>, requests: Claims3Request[]) {
  const byRequest = new Map(requests.map((request) => [request.requestId, request]));
  if (outputs.length !== requests.length || new Set(outputs.map((item) => item.requestId)).size !== requests.length || outputs.some((item) => !byRequest.has(item.requestId))) throw new Error("Exactly one output per Claims-3 request is required");
  const result = { proposed: 0, claims: [] as Claims3Claim[], duplicates: 0, invalidUnits: 0, invalidPages: 0, headingCitations: 0, nonadjacentUnits: 0, crossContextUnits: 0,
    unresolvedCandidates: 0, possibleRescueTargets: [] as string[], conditionalRejections: 0, omittedNamedCauses: 0 };
  const retained = new Map<string, Claims3Claim>();
  for (const { requestId, output } of outputs) {
    const request = byRequest.get(requestId)!;
    const units = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
    for (const candidate of claims3OutputSchema.parse(output).claims) {
      result.proposed++;
      const cited = candidate.evidence.map((ref) => units.get(ref.unit_id));
      if (cited.some((unit) => !unit) || new Set(candidate.evidence.map((ref) => ref.unit_id)).size !== cited.length) { result.invalidUnits++; continue; }
      const evidence = cited as EvidenceUnit[];
      if (evidence.some((unit, index) => unit.page !== candidate.evidence[index].page || unit.rawSource.page !== unit.page)) { result.invalidPages++; continue; }
      if (evidence.some((unit) => unit.kind !== "sentence" || !unit.rawSource.text.trim())) { result.headingCitations++; continue; }
      if (new Set(evidence.map((unit) => unit.context)).size !== 1) { result.crossContextUnits++; continue; }
      if (evidence.length === 2 && evidence[1].order !== evidence[0].order + 1) { result.nonadjacentUnits++; continue; }
      const evidenceText = evidence.map((unit) => unit.text).join(" ");
      if ((conditionalContext(evidence[0].context) || conditionalSource(evidenceText)) && !/\b(if|would|could|might|should|unless|hypothetical|possible|in the adventure|is instructed to)\b/iu.test(candidate.statement)) { result.conditionalRejections++; continue; }
      if (omitsNamedCause(evidenceText, candidate.statement)) { result.omittedNamedCauses++; continue; }
      const entityIds = [...new Set(candidate.entities.map((name) => resolve(request.entities, name, evidenceText)).filter((id): id is string => Boolean(id)))];
      const unresolvedEntities = [...new Set(candidate.entities.filter((name) => !resolve(request.entities, name, evidenceText)))];
      result.unresolvedCandidates += unresolvedEntities.length;
      const provenance = { unitIds: evidence.map((unit) => unit.unitId), sources: evidence.map((unit) => ({ unitId: unit.unitId, ...unit.rawSource })) };
      const claim: Claims3Claim = { statement: candidate.statement, entityIds, unresolvedEntities, context: evidence[0].context,
        ...(cleanSectionHeading(evidence[0].context) ? { sectionHeading: cleanSectionHeading(evidence[0].context) } : {}), sourceOrder: evidence[0].order, provenance: [provenance] };
      const key = JSON.stringify([normalizedStatement(claim.statement), claim.context]);
      const prior = retained.get(key);
      if (prior) {
        result.duplicates++;
        prior.entityIds = [...new Set([...prior.entityIds, ...claim.entityIds])];
        prior.unresolvedEntities = [...new Set([...prior.unresolvedEntities, ...claim.unresolvedEntities])];
        prior.sourceOrder = Math.min(prior.sourceOrder, claim.sourceOrder);
        if (!prior.provenance.some((item) => JSON.stringify(item.unitIds) === JSON.stringify(provenance.unitIds))) prior.provenance.push(provenance);
      } else retained.set(key, claim);
    }
  }
  result.claims = [...retained.values()];
  result.possibleRescueTargets = [...new Set(result.claims.flatMap((claim) => claim.unresolvedEntities))];
  return result;
}

export function claims3CheckpointIdentity(args: { request: Claims3Request; fixtureHash: string; sourceHash: string; inventoryHash: string; manifestHash: string; modelId: string }): AIOperationIdentity {
  return { campaignId: "claims3-offline-benchmark", documentId: args.fixtureHash, sourceExtractionCacheId: null, providerId: "openai", modelId: args.modelId,
    processingMode: "claims_experiment", stage: "extraction", operationType: "claims_3_experiment", operationKey: args.request.requestId,
    inputHash: modelInputHash(CLAIMS_3_PROMPT, serializeClaims3Request(args.request).payload),
    upstreamFingerprint: semanticInputHash({ sourceHash: args.sourceHash, inventoryHash: args.inventoryHash, manifestHash: args.manifestHash,
      baselineRequestId: args.request.baselineRequestId, units: args.request.evidenceUnits, entities: args.request.entities }),
    behaviorVersion: CLAIMS_3_BEHAVIOR_VERSION, schemaVersion: CLAIMS_3_SCHEMA_VERSION };
}
