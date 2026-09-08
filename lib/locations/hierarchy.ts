import { normalizeRelationshipFact } from "@/lib/relationships/normalize";
import type { KnowledgeVisibility } from "@/lib/knowledge/types";

export interface LocationRecord {
  id: string;
  name: string;
}

export interface HierarchyRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
  confidence: number;
  visibility?: KnowledgeVisibility;
}

export interface LocationTreeNode<T extends LocationRecord = LocationRecord> {
  location: T;
  children: LocationTreeNode<T>[];
}

export type LocationHierarchyDiagnosticCode =
  | "self_containment"
  | "missing_parent"
  | "duplicate_parent"
  | "less_specific_parent"
  | "low_confidence"
  | "ambiguous_parent"
  | "cycle";

export interface LocationHierarchyDiagnostic {
  relationshipId: string;
  childId: string;
  parentId: string;
  code: LocationHierarchyDiagnosticCode;
  reason: string;
}

interface ParentCandidate {
  relationship: HierarchyRelationship;
  childId: string;
  parentId: string;
}

export interface LocationHierarchy<T extends LocationRecord = LocationRecord> {
  selectedRelationshipIds: Set<string>;
  consideredRelationshipIds: Set<string>;
  diagnostics: LocationHierarchyDiagnostic[];
  getParent(locationId: string): T | undefined;
  getChildren(locationId: string): T[];
  getAncestors(locationId: string): T[];
  getDescendants(locationId: string): T[];
  getRoots(): T[];
  getOrphans(): T[];
  getPath(locationId: string): T[];
  buildTree(): LocationTreeNode<T>[];
}

const MIN_PARENT_CONFIDENCE = 0.7;
const AMBIGUOUS_PARENT_MIN_CONFIDENCE = 0.8;
const PARENT_CONFIDENCE_MARGIN = 0.15;

function byName<T extends LocationRecord>(left: T, right: T): number {
  return left.name.localeCompare(right.name, "en-US");
}

function reaches(startId: string, targetId: string, parentsByChild: Map<string, Set<string>>): boolean {
  const pending = [startId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(parentsByChild.get(current) ?? []));
  }
  return false;
}

function wouldCreateCycle(childId: string, parentId: string, parentByChild: Map<string, string>): boolean {
  const visited = new Set<string>();
  let current: string | undefined = parentId;
  while (current) {
    if (current === childId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    current = parentByChild.get(current);
  }
  return false;
}

function diagnostic(candidate: ParentCandidate, code: LocationHierarchyDiagnosticCode, reason: string): LocationHierarchyDiagnostic {
  return {
    relationshipId: candidate.relationship.id,
    childId: candidate.childId,
    parentId: candidate.parentId,
    code,
    reason,
  };
}

export function buildLocationHierarchy<T extends LocationRecord>(
  locations: T[],
  relationships: HierarchyRelationship[],
): LocationHierarchy<T> {
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const consideredRelationshipIds = new Set<string>();
  const selectedRelationshipIds = new Set<string>();
  const diagnostics: LocationHierarchyDiagnostic[] = [];
  const unresolvedChildren = new Set<string>();
  const candidatesByChild = new Map<string, ParentCandidate[]>();

  for (const relationship of relationships) {
    const fact = normalizeRelationshipFact(
      relationship.sourceId,
      relationship.targetId,
      relationship.relationshipType,
    );
    if (fact.semanticType !== "located in" || !locationById.has(fact.sourceId)) continue;
    consideredRelationshipIds.add(relationship.id);
    const candidate = { relationship, childId: fact.sourceId, parentId: fact.targetId };
    if (fact.sourceId === fact.targetId) {
      unresolvedChildren.add(fact.sourceId);
      diagnostics.push(diagnostic(candidate, "self_containment", "A location cannot contain itself"));
      continue;
    }
    if (!locationById.has(fact.targetId)) {
      unresolvedChildren.add(fact.sourceId);
      diagnostics.push(diagnostic(candidate, "missing_parent", "Containment parent is not a canonical location"));
      continue;
    }
    candidatesByChild.set(fact.sourceId, [...(candidatesByChild.get(fact.sourceId) ?? []), candidate]);
  }

  const uniqueCandidatesByChild = new Map<string, ParentCandidate[]>();
  for (const [childId, candidates] of candidatesByChild) {
    const strongestByParent = new Map<string, ParentCandidate>();
    for (const candidate of candidates) {
      const existing = strongestByParent.get(candidate.parentId);
      if (!existing || candidate.relationship.confidence > existing.relationship.confidence) {
        if (existing) diagnostics.push(diagnostic(existing, "duplicate_parent", "Duplicate containment edge was superseded"));
        strongestByParent.set(candidate.parentId, candidate);
      } else {
        diagnostics.push(diagnostic(candidate, "duplicate_parent", "Duplicate containment edge was superseded"));
      }
    }
    uniqueCandidatesByChild.set(childId, [...strongestByParent.values()]);
  }

  const possibleParentsByChild = new Map<string, Set<string>>(
    [...uniqueCandidatesByChild].map(([childId, candidates]) => [
      childId,
      new Set(candidates
        .filter((candidate) => candidate.relationship.confidence >= MIN_PARENT_CONFIDENCE)
        .map((candidate) => candidate.parentId)),
    ]),
  );
  const proposed: ParentCandidate[] = [];

  for (const [childId, candidates] of uniqueCandidatesByChild) {
    const mostSpecific = candidates.filter((candidate) => !candidates.some((other) =>
      other.parentId !== candidate.parentId
      && reaches(other.parentId, candidate.parentId, possibleParentsByChild),
    ));
    const lessSpecific = candidates.filter((candidate) => !mostSpecific.includes(candidate));
    for (const candidate of lessSpecific) {
      diagnostics.push(diagnostic(candidate, "less_specific_parent", "A more specific supported container was selected"));
    }

    const ranked = [...mostSpecific].sort((left, right) =>
      right.relationship.confidence - left.relationship.confidence
      || left.relationship.id.localeCompare(right.relationship.id, "en-US"),
    );
    const strongest = ranked[0];
    if (!strongest) continue;
    if (strongest.relationship.confidence < MIN_PARENT_CONFIDENCE) {
      unresolvedChildren.add(childId);
      for (const candidate of ranked) diagnostics.push(diagnostic(candidate, "low_confidence", "Containment evidence is below the parent-selection threshold"));
      continue;
    }
    if (ranked.length > 1) {
      const runnerUp = ranked[1];
      const hasClearConfidenceLead = strongest.relationship.confidence >= AMBIGUOUS_PARENT_MIN_CONFIDENCE
        && strongest.relationship.confidence - runnerUp.relationship.confidence >= PARENT_CONFIDENCE_MARGIN;
      if (!hasClearConfidenceLead) {
        unresolvedChildren.add(childId);
        for (const candidate of ranked) diagnostics.push(diagnostic(candidate, "ambiguous_parent", "Multiple unrelated containers have insufficiently distinct support"));
        continue;
      }
      for (const candidate of ranked.slice(1)) {
        diagnostics.push(diagnostic(candidate, "ambiguous_parent", "A more strongly supported unrelated container was selected"));
      }
    }
    proposed.push(strongest);
  }

  const parentByChild = new Map<string, string>();
  const childrenByParent = new Map<string, Set<string>>();
  proposed.sort((left, right) =>
    right.relationship.confidence - left.relationship.confidence
    || left.relationship.id.localeCompare(right.relationship.id, "en-US"),
  );
  for (const candidate of proposed) {
    if (wouldCreateCycle(candidate.childId, candidate.parentId, parentByChild)) {
      unresolvedChildren.add(candidate.childId);
      diagnostics.push(diagnostic(candidate, "cycle", "Containment edge would create a location cycle"));
      continue;
    }
    parentByChild.set(candidate.childId, candidate.parentId);
    const children = childrenByParent.get(candidate.parentId) ?? new Set<string>();
    children.add(candidate.childId);
    childrenByParent.set(candidate.parentId, children);
    selectedRelationshipIds.add(candidate.relationship.id);
    unresolvedChildren.delete(candidate.childId);
  }

  const getParent = (locationId: string) => locationById.get(parentByChild.get(locationId) ?? "");
  const getChildren = (locationId: string) => [...(childrenByParent.get(locationId) ?? [])]
    .map((id) => locationById.get(id))
    .filter((location): location is T => location !== undefined)
    .sort(byName);
  const getAncestors = (locationId: string) => {
    const ancestors: T[] = [];
    const visited = new Set([locationId]);
    let parentId = parentByChild.get(locationId);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = locationById.get(parentId);
      if (!parent) break;
      ancestors.push(parent);
      parentId = parentByChild.get(parentId);
    }
    return ancestors.reverse();
  };
  const getDescendants = (locationId: string) => {
    const descendants: T[] = [];
    const visited = new Set([locationId]);
    const pending = [...(childrenByParent.get(locationId) ?? [])].reverse();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const location = locationById.get(id);
      if (location) descendants.push(location);
      const children = [...(childrenByParent.get(id) ?? [])]
        .sort((left, right) => byName(locationById.get(left)!, locationById.get(right)!));
      pending.push(...children.reverse());
    }
    return descendants;
  };
  const getRoots = () => locations.filter((location) => !parentByChild.has(location.id)).sort(byName);
  const getOrphans = () => [...unresolvedChildren]
    .map((id) => locationById.get(id))
    .filter((location): location is T => location !== undefined)
    .sort(byName);
  const getPath = (locationId: string) => {
    const location = locationById.get(locationId);
    return location ? [...getAncestors(locationId), location] : [];
  };
  const buildTree = () => {
    const nodes = new Map<string, LocationTreeNode<T>>(
      locations.map((location) => [location.id, { location, children: [] }]),
    );
    for (const [parentId, childIds] of childrenByParent) {
      const parent = nodes.get(parentId);
      if (!parent) continue;
      parent.children = [...childIds]
        .map((id) => nodes.get(id))
        .filter((node): node is LocationTreeNode<T> => node !== undefined)
        .sort((left, right) => byName(left.location, right.location));
    }
    return getRoots().map((root) => nodes.get(root.id)!).filter(Boolean);
  };

  return {
    selectedRelationshipIds,
    consideredRelationshipIds,
    diagnostics,
    getParent,
    getChildren,
    getAncestors,
    getDescendants,
    getRoots,
    getOrphans,
    getPath,
    buildTree,
  };
}
