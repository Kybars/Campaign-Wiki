import type { ReconciliationDecision } from "@/lib/ai/schemas";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import type { CandidateAggregate } from "@/lib/graph/types";
import type { CachedChunkPayload } from "@/lib/processing/replay-cache";

const evidence = (page: number, text: string) => [{ page_number: page, supporting_text: text }];

export const regressionCachedChunks: CachedChunkPayload[] = [{
  chunk_id: "regression-1",
  validated_output: {
    entities: [
      { temporary_id: "cay-npc", name: "Cay Naja", type: "npc", roles: [], aliases: [], summary: "A named campaign figure.", sources: evidence(1, "Cay Naja appears in the account.") },
      { temporary_id: "xancrown-npc", name: "Xancrown", type: "npc", roles: ["enemy"], aliases: [], summary: "A hostile figure.", sources: evidence(2, "Xancrown threatens the heroes.") },
      { temporary_id: "plague-event", name: "Demonplague", type: "event", roles: [], aliases: ["The Demonplague"], summary: "A campaign disaster.", sources: evidence(3, "The Demonplague spreads.") },
      { temporary_id: "gardong-npc", name: "Gardong Marhold", type: "npc", roles: [], aliases: [], summary: "A named place reference.", sources: evidence(4, "Gardong Marhold is mentioned.") },
      { temporary_id: "jeanas", name: "Jeanas Clocker", type: "npc", roles: [], aliases: [], summary: "Jesper's father.", sources: evidence(5, "Jeanas Clocker is Jesper's father.") },
      { temporary_id: "jesper", name: "Jesper Clocker", type: "npc", roles: [], aliases: [], summary: "Jeanas's son.", sources: evidence(5, "Jesper Clocker is Jeanas's son.") },
      { temporary_id: "colinus", name: "Colinus Birthwitch", type: "npc", roles: [], aliases: [], summary: "A councilmember.", sources: evidence(6, "Colinus is Kylar's uncle.") },
      { temporary_id: "kylar", name: "Kylar Birthwitch", type: "npc", roles: [], aliases: [], summary: "Colinus's nephew.", sources: evidence(7, "Kylar is Colinus's nephew.") },
      { temporary_id: "kingdom", name: "Kingdom", type: "location", roles: [], aliases: [], summary: "A realm.", sources: evidence(8, "The village lies in the Kingdom.") },
      { temporary_id: "village", name: "Village", type: "location", roles: [], aliases: [], summary: "A settlement.", sources: evidence(8, "The Village lies in the Kingdom.") },
      { temporary_id: "tavern", name: "Tavern", type: "location", roles: [], aliases: [], summary: "A tavern.", sources: evidence(9, "The Tavern lies in the Village.") },
      { temporary_id: "basement", name: "Basement", type: "location", roles: [], aliases: [], summary: "A basement.", sources: evidence(10, "The Basement lies in the Tavern.") },
      { temporary_id: "altar", name: "Altar", type: "location", roles: [], aliases: [], summary: "An altar.", sources: evidence(11, "The Altar lies in the Basement.") },
      { temporary_id: "merriath", name: "Merriath", type: "npc", roles: ["enemy"], aliases: [], summary: "An enemy NPC.", sources: evidence(12, "Merriath attacks the party.") },
      { temporary_id: "cult", name: "Cult of Chaos", type: "faction", roles: ["enemy"], aliases: [], summary: "An enemy faction.", sources: evidence(13, "The Cult of Chaos attacks.") },
    ],
    relationships: [
      { source_temporary_id: "colinus", target_temporary_id: "kylar", relationship_type: "uncle_of", description: "Colinus is Kylar's uncle.", confidence: 0.95, sources: evidence(6, "Colinus is Kylar's uncle.") },
      { source_temporary_id: "kylar", target_temporary_id: "colinus", relationship_type: "nephew_of", description: "Kylar is Colinus's nephew.", confidence: 0.95, sources: evidence(7, "Kylar is Colinus's nephew.") },
      { source_temporary_id: "village", target_temporary_id: "kingdom", relationship_type: "located_in", description: "Village is in Kingdom.", confidence: 0.95, sources: evidence(8, "The Village lies in the Kingdom.") },
      { source_temporary_id: "tavern", target_temporary_id: "village", relationship_type: "located_in", description: "Tavern is in Village.", confidence: 0.95, sources: evidence(9, "The Tavern lies in the Village.") },
      { source_temporary_id: "basement", target_temporary_id: "tavern", relationship_type: "located_in", description: "Basement is in Tavern.", confidence: 0.95, sources: evidence(10, "The Basement lies in the Tavern.") },
      { source_temporary_id: "altar", target_temporary_id: "basement", relationship_type: "located_in", description: "Altar is in Basement.", confidence: 0.95, sources: evidence(11, "The Altar lies in the Basement.") },
    ],
  },
}, {
  chunk_id: "regression-2",
  validated_output: {
    entities: [
      { temporary_id: "cay-other", name: "Cay Naja", type: "other", roles: [], aliases: [], summary: "The same named campaign figure.", sources: evidence(14, "Cay Naja returns.") },
      { temporary_id: "xancrown-other", name: "Xancrown", type: "other", roles: [], aliases: [], summary: "The same hostile figure.", sources: evidence(15, "Xancrown is a god.") },
      { temporary_id: "plague-other", name: "The Demonplague", type: "other", roles: [], aliases: [], summary: "The same campaign disaster.", sources: evidence(16, "The Demonplague continues.") },
      { temporary_id: "gardong-location", name: "Gardong Marhold", type: "location", roles: [], aliases: [], summary: "A settlement.", sources: evidence(17, "Gardong Marhold is a settlement.") },
    ],
    relationships: [],
  },
}];

export function regressionReconciliationDecision(aggregate: CandidateAggregate): ReconciliationDecision {
  const groups = buildDeterministicGroups(aggregate);
  const groupIds = (...names: string[]) => groups
    .filter((group) => group.candidates.some((candidate) => names.includes(candidate.name)))
    .map((group) => group.id);
  const identityEvidence = (ids: string[]) => groups
    .filter((group) => ids.includes(group.id))
    .flatMap((group) => group.candidates.flatMap((candidate) => candidate.sources));
  const cay = groupIds("Cay Naja");
  const xancrown = groupIds("Xancrown");
  const plague = groupIds("Demonplague", "The Demonplague");
  const gardong = groupIds("Gardong Marhold");
  return {
    canonical_entities: [
      { canonical_id: "cay", name: "Cay Naja", group_ids: cay, type: "npc", roles: [], aliases: [], summary: "A named campaign figure.", identity_evidence: identityEvidence(cay) },
      { canonical_id: "xancrown", name: "Xancrown", group_ids: xancrown, type: "deity", roles: ["enemy"], aliases: [], summary: "A hostile deity.", identity_evidence: identityEvidence(xancrown) },
      { canonical_id: "plague", name: "Demonplague", group_ids: plague, type: "event", roles: [], aliases: ["The Demonplague"], summary: "A campaign disaster.", identity_evidence: identityEvidence(plague) },
      { canonical_id: "gardong", name: "Gardong Marhold", group_ids: gardong, type: "location", roles: [], aliases: [], summary: "A settlement.", identity_evidence: identityEvidence(gardong) },
    ],
  };
}
