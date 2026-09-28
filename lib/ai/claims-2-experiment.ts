import { z } from "zod";
import type { AIOperationIdentity } from "@/lib/ai/operation-checkpoint";
import { modelInputHash, semanticInputHash } from "@/lib/ai/operation-checkpoint";
import type { ExtractionContext, ExtractionContextEntity, RawSourceMapping, SourceSegment } from "@/lib/ai/extraction-context";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { normalizeName } from "@/lib/graph/normalize";
import { planTest9ClaimRequests } from "@/lib/ai/claims-experiment";

export const CLAIMS_2_BEHAVIOR_VERSION = "v0.6.7-claims-2";
export const CLAIMS_2_SCHEMA_VERSION = 2;
export const CLAIMS_2_PROMPT = `Extract explicit, useful facts from the entire supplied source. Include descriptive, identity, status, capability, belief, and location facts as well as actions, even when a fact involves only one known entity. Each claim is one proposition: split independent events or story beats, but preserve a genuinely connected proposition involving multiple entities. Make the statement self-contained, including attribution such as "rumored" and any hypothetical condition shown in SOURCE CONTEXT. List only supplied known entities materially participating in that proposition; an entity merely mentioned nearby is not a participant. The ENTIRE statement, including every participant and qualifier, must be supported by its cited evidence. Cite exactly one evidence unit by default; cite two only when they are adjacent and both are necessary for context or pronoun resolution. Never cite a heading as evidence. Do not infer unsupported lore or repeat paraphrases. Return only the fixed schema: statement, entities, evidence_units.`;

export const claims2OutputSchema = z.object({ claims: z.array(z.object({
  statement: z.string().trim().min(1).max(500),
  entities: z.array(z.string().trim().min(1).max(200)).min(1),
  evidence_units: z.array(z.string().trim().min(1).max(40)).min(1).max(2),
}).strict()).max(200) }).strict();
export type Claims2Output = z.infer<typeof claims2OutputSchema>;
export interface EvidenceUnit { unitId: string; segmentId: string; page: number; kind: "heading" | "sentence"; text: string; rawSource: RawSourceMapping; context: string; order: number }
export interface Claims2Request { requestId: string; evidenceUnits: EvidenceUnit[]; entities: ExtractionContextEntity[] }
export interface Claims2Claim { statement: string; entityIds: string[]; entities: string[]; context: string; provenance: Array<{ unitIds: string[]; sources: Array<RawSourceMapping & { unitId: string }> }> }

const CONTEXT_HEADING = "What If They Do Nothing?";
const HEADINGS = [CONTEXT_HEADING, "Timeline for the War", "Adventure Synopses", "Famous Names and Important Places"];

function normalizeWithOffsets(raw: string) {
  let text = "";
  const offsets: number[] = [];
  let space: number | null = null;
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === "-") {
      const wrap = raw.slice(index + 1).match(/^(?:\r?\n|[ \t]+\r?\n)[ \t]*(\p{Ll})/u);
      if (wrap) { index += wrap[0].length; text += wrap[1]; offsets.push(index); continue; }
    }
    if (/\s/u.test(raw[index])) { if (text) space = index; continue; }
    if (space !== null) { text += " "; offsets.push(space); space = null; }
    text += raw[index]; offsets.push(index);
  }
  return { text, offsets };
}

function splitSegment(segment: SourceSegment, context: string, startingOrder: number): { units: EvidenceUnit[]; context: string } {
  const mapped = normalizeWithOffsets(segment.rawSource.text);
  const spans: Array<{ start: number; end: number; kind: EvidenceUnit["kind"] }> = [];
  const headingMatches = HEADINGS.flatMap((heading) => {
    const matches: Array<{ start: number; end: number }> = [];
    for (let from = 0; from < mapped.text.length;) {
      const start = mapped.text.indexOf(heading, from);
      if (start < 0) break;
      matches.push({ start, end: start + heading.length });
      from = start + heading.length;
    }
    return matches;
  }).sort((a, b) => a.start - b.start);
  function sentences(start: number, end: number) {
    let cursor = start;
    for (let index = start; index < end; index++) {
      if (!/[.!?]/u.test(mapped.text[index]) || (index + 1 < end && !/\s/u.test(mapped.text[index + 1]))) continue;
      let after = index + 1;
      while (after < end && /[.!?]/u.test(mapped.text[after])) after++;
      spans.push({ start: cursor, end: after, kind: "sentence" });
      cursor = after;
      index = after - 1;
    }
    if (cursor < end) spans.push({ start: cursor, end, kind: "sentence" });
  }
  let cursor = 0;
  for (const heading of headingMatches) {
    if (heading.start < cursor) continue;
    sentences(cursor, heading.start);
    spans.push({ ...heading, kind: "heading" });
    cursor = heading.end;
  }
  sentences(cursor, mapped.text.length);
  const units: EvidenceUnit[] = [];
  for (const span of spans) {
    const content = mapped.text.slice(span.start, span.end);
    const left = content.search(/\S/u);
    if (left < 0) continue;
    const start = span.start + left;
    const end = span.start + content.trimEnd().length;
    const rawStart = segment.rawSource.start + mapped.offsets[start];
    const rawEnd = segment.rawSource.start + mapped.offsets[end - 1] + 1;
    if (span.kind === "heading" && mapped.text.slice(start, end) === CONTEXT_HEADING) context = "what_if_they_do_nothing";
    const order = startingOrder + units.length;
    units.push({ unitId: `${segment.segmentId}.u${String(units.length + 1).padStart(2, "0")}`, segmentId: segment.segmentId, page: segment.page, kind: span.kind,
      text: mapped.text.slice(start, end), rawSource: { page: segment.page, start: rawStart, end: rawEnd, text: segment.rawSource.text.slice(rawStart - segment.rawSource.start, rawEnd - segment.rawSource.start) }, context, order });
  }
  return { units, context };
}

export function planTest9Claims2Requests(context: ExtractionContext): Claims2Request[] {
  return planTest9ClaimRequests(context).map((request) => {
    let inheritedContext = "main";
    const evidenceUnits: EvidenceUnit[] = [];
    for (const segment of request.sourceSegments) {
      const split = splitSegment(segment, inheritedContext, evidenceUnits.length);
      evidenceUnits.push(...split.units);
      inheritedContext = split.context;
    }
    return { requestId: request.requestId.replace("claims-", "claims2-"), evidenceUnits, entities: request.entities };
  });
}

export function serializeClaims2Request(request: Claims2Request) {
  const entityContext = request.entities.map((entity) => `${entity.name} | ${entity.type}${entity.aliases.length ? ` | aliases: ${entity.aliases.join(", ")}` : ""}`).join("\n");
  let context = "";
  const source = request.evidenceUnits.map((unit) => {
    const prefix = unit.context === context ? "" : `SOURCE CONTEXT: ${unit.context}\n`;
    context = unit.context;
    return `${prefix}[${unit.unitId}]${unit.kind === "heading" ? " HEADING:" : ""} ${unit.text}`;
  }).join("\n");
  return { entityContext, source, payload: `KNOWN ENTITIES\n${entityContext || "(none)"}\n\nSOURCE\n${source}` };
}

export function claims2TokenDiagnostics(request: Claims2Request) {
  const { entityContext, source } = serializeClaims2Request(request);
  const characters = { source: source.length, entity: entityContext.length, prompt: CLAIMS_2_PROMPT.length, schema: JSON.stringify(z.toJSONSchema(claims2OutputSchema)).length };
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

export function validateAndUnionClaims2(outputs: Array<{ requestId: string; output: Claims2Output }>, requests: Claims2Request[]) {
  const byRequest = new Map(requests.map((request) => [request.requestId, request]));
  if (outputs.length !== requests.length || new Set(outputs.map((item) => item.requestId)).size !== requests.length || outputs.some((item) => !byRequest.has(item.requestId))) throw new Error("Exactly one output per Claims-2 request is required");
  const result = { proposed: 0, claims: [] as Claims2Claim[], duplicates: 0, unknownParticipants: 0, ambiguousParticipants: 0, duplicateParticipants: 0, invalidUnits: 0, headingCitations: 0, nonadjacentUnits: 0, crossContextUnits: 0 };
  const retained = new Map<string, Claims2Claim>();
  for (const { requestId, output } of outputs) {
    const request = byRequest.get(requestId)!;
    const units = new Map(request.evidenceUnits.map((unit) => [unit.unitId, unit]));
    for (const candidate of claims2OutputSchema.parse(output).claims) {
      result.proposed++;
      const cited = candidate.evidence_units.map((id) => units.get(id));
      if (cited.some((unit) => !unit) || new Set(candidate.evidence_units).size !== candidate.evidence_units.length) { result.invalidUnits++; continue; }
      const evidence = cited as EvidenceUnit[];
      if (evidence.some((unit) => unit.kind !== "sentence")) { result.headingCitations++; continue; }
      if (new Set(evidence.map((unit) => unit.context)).size !== 1) { result.crossContextUnits++; continue; }
      if (evidence.length === 2 && evidence[1].order !== evidence[0].order + 1) { result.nonadjacentUnits++; continue; }
      const resolutions = candidate.entities.map((name) => matches(request.entities, name));
      if (resolutions.some((items) => items.length === 0)) { result.unknownParticipants++; continue; }
      if (resolutions.some((items) => items.length !== 1)) { result.ambiguousParticipants++; continue; }
      const entities = resolutions.map((items) => items[0]);
      const entityIds = entities.map((entity) => entity.canonicalId);
      if (new Set(entityIds).size !== entityIds.length) { result.duplicateParticipants++; continue; }
      const provenance = { unitIds: evidence.map((unit) => unit.unitId), sources: evidence.map((unit) => ({ unitId: unit.unitId, ...unit.rawSource })) };
      const claim: Claims2Claim = { statement: candidate.statement, entityIds, entities: entities.map((entity) => entity.name), context: evidence[0].context, provenance: [provenance] };
      const key = JSON.stringify([claim.statement.toLowerCase().replace(/\s+/gu, " ").trim(), [...entityIds].sort(), claim.context]);
      const prior = retained.get(key);
      if (prior) { result.duplicates++; if (!prior.provenance.some((item) => JSON.stringify(item.unitIds) === JSON.stringify(provenance.unitIds))) prior.provenance.push(provenance); }
      else retained.set(key, claim);
    }
  }
  result.claims = [...retained.values()];
  return result;
}

export function claims2CheckpointIdentity(args: { request: Claims2Request; fixtureHash: string; contextFingerprint: string; modelId: string }): AIOperationIdentity {
  return { campaignId: "test9-fixture", documentId: args.fixtureHash, sourceExtractionCacheId: null, providerId: "openai", modelId: args.modelId,
    processingMode: "claims_experiment", stage: "extraction", operationType: "claims_2_experiment", operationKey: args.request.requestId,
    inputHash: modelInputHash(CLAIMS_2_PROMPT, serializeClaims2Request(args.request).payload),
    upstreamFingerprint: semanticInputHash({ contextFingerprint: args.contextFingerprint, entities: args.request.entities, units: args.request.evidenceUnits }),
    behaviorVersion: CLAIMS_2_BEHAVIOR_VERSION, schemaVersion: CLAIMS_2_SCHEMA_VERSION };
}

export function runClaims2Extraction(request: Claims2Request, provider: StructuredModelProvider) {
  return provider.parseStructured({ system: CLAIMS_2_PROMPT, payload: serializeClaims2Request(request).payload, schema: claims2OutputSchema, schemaName: "test9_claims2_output" });
}
