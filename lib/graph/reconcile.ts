import type { ReconciliationDecision, SourceEvidence } from "@/lib/ai/schemas";
import { normalizeName } from "@/lib/graph/normalize";
import type {
  CandidateAggregate,
  CanonicalEntity,
  DeterministicGroup,
  GlobalCandidateEntity,
} from "@/lib/graph/types";

class DisjointSet {
  private readonly parent = new Map<string, string>();
  add(id: string) { this.parent.set(id, id); }
  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent) throw new Error(`Unknown candidate ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }
  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}

function identityNames(candidate: GlobalCandidateEntity): Set<string> {
  return new Set([candidate.name, ...candidate.aliases].map(normalizeName).filter(Boolean));
}

export function buildDeterministicGroups(aggregate: CandidateAggregate): DeterministicGroup[] {
  const set = new DisjointSet();
  aggregate.entities.forEach((candidate) => set.add(candidate.id));
  const ownerByIdentity = new Map<string, string>();

  for (const candidate of aggregate.entities) {
    for (const identity of identityNames(candidate)) {
      const typedIdentity = `${candidate.type}:${identity}`;
      const owner = ownerByIdentity.get(typedIdentity);
      if (owner) set.union(owner, candidate.id);
      else ownerByIdentity.set(typedIdentity, candidate.id);
    }
  }

  const byRoot = new Map<string, GlobalCandidateEntity[]>();
  for (const candidate of aggregate.entities) {
    const root = set.find(candidate.id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), candidate]);
  }
  return [...byRoot.values()].map((candidates, index) => ({
    id: `group-${index + 1}`,
    type: candidates[0].type,
    candidates,
  }));
}

function uniqueSources(sources: SourceEvidence[]): SourceEvidence[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.page_number}:${source.supporting_text.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalFromGroups(
  groups: DeterministicGroup[],
  key: string,
  override?: { name: string; aliases: string[]; summary: string },
  mergeReason: "deterministic" | "ai" = "deterministic",
): CanonicalEntity {
  const candidates = groups.flatMap((group) => group.candidates);
  const name = override?.name ?? candidates[0].name;
  const rawAliases = [
    ...candidates.flatMap((candidate) => [candidate.name, ...candidate.aliases]),
    ...(override?.aliases ?? []),
  ];
  const canonicalNormalized = normalizeName(name);
  const aliases = [...new Set(rawAliases.map((alias) => alias.trim()).filter(
    (alias) => alias && normalizeName(alias) !== canonicalNormalized,
  ))];
  const longestSummary = [...candidates].sort((a, b) => b.summary.length - a.summary.length)[0]?.summary ?? "";
  const roles = [...new Set(candidates.flatMap((candidate) => candidate.roles))];
  const roleSources = Object.fromEntries(roles.map((role) => [
    role,
    uniqueSources(candidates.filter((candidate) => candidate.roles.includes(role)).flatMap((candidate) => candidate.sources)),
  ]));
  return {
    key,
    name,
    normalizedName: canonicalNormalized,
    type: groups[0].type,
    roles,
    roleSources,
    aliases,
    summary: override?.summary ?? longestSummary,
    sources: uniqueSources(candidates.flatMap((candidate) => candidate.sources)),
    candidateIds: candidates.map((candidate) => candidate.id),
    mergeReason,
  };
}

export interface ReconciledEntities {
  entities: CanonicalEntity[];
  candidateToCanonical: Map<string, string>;
}

export function applyReconciliation(
  groups: DeterministicGroup[],
  decision?: ReconciliationDecision,
): ReconciledEntities {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const claimed = new Set<string>();
  const entities: CanonicalEntity[] = [];
  const usedCanonicalNames = new Set<string>();

  for (const proposed of decision?.canonical_entities ?? []) {
    const proposalGroups = proposed.group_ids.map((id) => groupsById.get(id)).filter((group): group is DeterministicGroup => Boolean(group));
    if (proposalGroups.length !== proposed.group_ids.length || proposalGroups.some((group) => claimed.has(group.id))) continue;
    if (new Set(proposalGroups.map((group) => group.type)).size !== 1) continue;
    const proposedEntity = canonicalFromGroups(
      proposalGroups,
      `canonical-${entities.length + 1}`,
      { name: proposed.name, aliases: proposed.aliases, summary: proposed.summary },
      proposalGroups.length > 1 ? "ai" : "deterministic",
    );
    const typedName = `${proposedEntity.type}:${proposedEntity.normalizedName}`;
    // A model rename must not create a database collision or force an unsafe merge.
    // Reject that proposal and fall back to the deterministic groups instead.
    if (usedCanonicalNames.has(typedName)) continue;
    proposalGroups.forEach((group) => claimed.add(group.id));
    usedCanonicalNames.add(typedName);
    entities.push(proposedEntity);
  }

  for (const group of groups) {
    if (claimed.has(group.id)) continue;
    const entity = canonicalFromGroups([group], `canonical-${entities.length + 1}`);
    usedCanonicalNames.add(`${entity.type}:${entity.normalizedName}`);
    entities.push(entity);
  }

  const candidateToCanonical = new Map<string, string>();
  entities.forEach((entity) => entity.candidateIds.forEach((candidateId) => candidateToCanonical.set(candidateId, entity.key)));
  return { entities, candidateToCanonical };
}
