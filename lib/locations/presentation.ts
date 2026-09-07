import type { LocationHierarchy, LocationRecord } from "@/lib/locations/hierarchy";

export function locationOverview<T extends LocationRecord>(hierarchy: LocationHierarchy<T>, limit = 8) {
  return hierarchy.getRoots().slice(0, limit).map((location) => ({
    location,
    immediateChildCount: hierarchy.getChildren(location.id).length,
  }));
}
