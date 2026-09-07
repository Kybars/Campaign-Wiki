import { EntityDetail, type EntityDetailView } from "@/components/entity-detail";
import { LocationTree } from "@/components/location-tree";
import { WikiHeader } from "@/components/wiki-header";
import { filterEntitiesBySearchTerm, hasEntityRole } from "@/lib/entities";
import { buildLocationHierarchy, type HierarchyRelationship } from "@/lib/locations/hierarchy";
import { locationOverview } from "@/lib/locations/presentation";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const campaignId = "campaign-1";
const locations = [
  { id: "kingdom", name: "Kingdom" },
  { id: "village", name: "Village" },
  { id: "tavern", name: "Tavern" },
  { id: "basement", name: "Basement" },
  { id: "altar", name: "Altar" },
  { id: "orphan", name: "Orphan Camp" },
];

function edge(id: string, sourceId: string, targetId: string): HierarchyRelationship {
  return { id, sourceId, targetId, relationshipType: "located_in", confidence: 0.95 };
}

function hierarchy() {
  return buildLocationHierarchy(locations, [
    edge("r-village", "village", "kingdom"),
    edge("r-tavern", "tavern", "village"),
    edge("r-basement", "basement", "tavern"),
    edge("r-altar", "altar", "basement"),
  ]);
}

function locationDetail(overrides: Partial<EntityDetailView> = {}): EntityDetailView {
  return {
    entity: { id: "altar", name: "Altar", type: "location", roles: [], aliases: [], summary: "A hidden altar." },
    relationships: [],
    sources: [],
    locationHierarchy: {
      parent: { id: "basement", name: "Basement" },
      children: [],
      path: [
        { id: "kingdom", name: "Kingdom" },
        { id: "village", name: "Village" },
        { id: "tavern", name: "Tavern" },
        { id: "basement", name: "Basement" },
        { id: "altar", name: "Altar" },
      ],
      isRoot: false,
      isOrphan: false,
    },
    ...overrides,
  };
}

describe("Milestone 6 location navigation", () => {
  it("selects only top-level locations for the campaign overview while retaining orphans", () => {
    const overview = locationOverview(hierarchy());
    expect(overview.map((item) => item.location.name)).toEqual(["Kingdom", "Orphan Camp"]);
    expect(overview.find((item) => item.location.id === "kingdom")?.immediateChildCount).toBe(1);
    expect(overview.some((item) => item.location.id === "tavern")).toBe(false);
  });

  it("builds an arbitrary-depth tree with each location represented once", () => {
    const tree = hierarchy().buildTree();
    const flatten = (nodes: typeof tree): string[] => nodes.flatMap((node) => [node.location.id, ...flatten(node.children)]);
    expect(flatten(tree)).toEqual(["kingdom", "village", "tavern", "basement", "altar", "orphan"]);
  });

  it("renders clickable roots and deeply nested locations with controls only for branches", () => {
    const page = renderToStaticMarkup(createElement(LocationTree, { campaignId, roots: hierarchy().buildTree() }));
    expect(page).toContain(`href="/campaigns/${campaignId}/entities/kingdom"`);
    expect(page).toContain(`href="/campaigns/${campaignId}/entities/village"`);
    expect(page).not.toContain(`href="/campaigns/${campaignId}/entities/altar"`);
    expect((page.match(/aria-expanded=/g) ?? [])).toHaveLength(2);
    expect(page).toContain('aria-expanded="true"');
    expect(page).toContain('aria-expanded="false"');
  });

  it("keeps leaf nodes free of disclosure controls when their branch is expanded", () => {
    const oneLevel = buildLocationHierarchy(locations.slice(0, 2), [edge("r-village", "village", "kingdom")]).buildTree();
    const page = renderToStaticMarkup(createElement(LocationTree, { campaignId, roots: oneLevel }));
    expect((page.match(/aria-expanded=/g) ?? [])).toHaveLength(1);
  });

  it("renders ordered linked breadcrumbs and a clear current location", () => {
    const page = renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail: locationDetail() }));
    expect(page.indexOf("Kingdom</a>")).toBeLessThan(page.indexOf("Village</a>"));
    expect(page.indexOf("Village</a>")).toBeLessThan(page.indexOf("Tavern</a>"));
    expect(page).toContain(`href="/campaigns/${campaignId}/entities/basement"`);
    expect(page).toContain("Located in");
  });

  it("omits empty parent and sublocation sections for a root leaf", () => {
    const root = locationDetail({
      entity: { id: "orphan", name: "Orphan Camp", type: "location", roles: [], aliases: [], summary: "A camp." },
      locationHierarchy: { parent: undefined, children: [], path: [{ id: "orphan", name: "Orphan Camp" }], isRoot: true, isOrphan: false },
    });
    const page = renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail: root }));
    expect(page).not.toContain("Located in");
    expect(page).not.toContain("Sublocations</h3>");
  });

  it("keeps nested locations searchable regardless of hierarchy depth", () => {
    const results = filterEntitiesBySearchTerm(locations.map((location) => ({ ...location, aliases: [] })), "altar");
    expect(results.map((location) => location.id)).toEqual(["altar"]);
  });

  it("keeps enemy roles and canonical underlying types separate", () => {
    const entities = [
      { id: "deity", name: "Xancrown", type: "deity" as const, roles: ["enemy" as const] },
      { id: "faction", name: "Cult", type: "faction" as const, roles: ["enemy" as const] },
      { id: "npc", name: "Guide", type: "npc" as const, roles: [] },
    ];
    const enemies = entities.filter((entity) => hasEntityRole(entity, "enemy"));
    expect(enemies.map((entity) => entity.type)).toEqual(["deity", "faction"]);
  });

  it("exposes every category and campaign-home link in the shared navigation", () => {
    const header = renderToStaticMarkup(createElement(WikiHeader, { campaignId, campaignName: "Campaign" }));
    for (const category of ["npc", "deity", "location", "faction", "item", "event", "quest", "enemies", "other"]) {
      expect(header).toContain(`/campaigns/${campaignId}/categories/${category}`);
    }
    expect(header).toContain('href="/"');
  });

  it("remains finite when malformed cyclic containment is supplied", () => {
    const malformed = buildLocationHierarchy(locations.slice(0, 3), [
      edge("one", "kingdom", "village"), edge("two", "village", "tavern"), edge("three", "tavern", "kingdom"),
    ]);
    expect(() => renderToStaticMarkup(createElement(LocationTree, { campaignId, roots: malformed.buildTree() }))).not.toThrow();
  });
});
