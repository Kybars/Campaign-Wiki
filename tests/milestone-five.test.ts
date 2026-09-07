import { EntityDetail, type EntityDetailView } from "@/components/entity-detail";
import { relationshipsForEntity } from "@/lib/relationships/view";
import { groupSourceEvidence, sourceReference, type SourceEvidence } from "@/lib/wiki/source-presentation";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const campaignId = "campaign-1";

function source(id: string, page: number, text: string, documentId = "document-1", filename = "Campaign Notes.pdf"): SourceEvidence {
  return { id, document_id: documentId, filename, page_number: page, supporting_text: text };
}

function detail(overrides: Partial<EntityDetailView> = {}): EntityDetailView {
  return {
    entity: {
      id: "colinus",
      name: "Colinus Birthwitch",
      type: "npc",
      roles: ["enemy"],
      aliases: ["Councilmember Colinus"],
      summary: "A councilmember and hunter.",
    },
    relationships: [{
      id: "relationship-1",
      displayLabel: "uncle of",
      description: "Colinus Birthwitch is the uncle of Kylar Birthwitch.",
      relatedEntity: { id: "kylar", name: "Kylar Birthwitch", type: "npc" },
      sources: [source("relationship-source-1", 45, "Colinus is Kylar's uncle.")],
    }],
    sources: [source("entity-source-1", 27, "Colinus serves on the council.")],
    ...overrides,
  };
}

function render(view = detail()) {
  return renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail: view }));
}

describe("Milestone 5 compact entity presentation", () => {
  it("renders the entity header, alias, type, and enemy role compactly", () => {
    const page = render();
    expect(page).toContain("Colinus Birthwitch");
    expect(page).toContain("Councilmember Colinus");
    expect(page).toContain("NPC");
    expect(page).toContain("Enemy");
    expect(page).toContain("A councilmember and hunter.");
  });

  it("renders deities as their canonical type", () => {
    const page = render(detail({ entity: { ...detail().entity, type: "deity", roles: [] } }));
    expect(page).toContain("Deity");
    expect(page).not.toContain("Enemy</span>");
  });

  it("uses a compact relationship description and preserves a clickable target", () => {
    const page = render();
    expect(page).toContain("Colinus Birthwitch is the uncle of <a");
    expect(page).toContain(`href="/campaigns/${campaignId}/entities/kylar"`);
    expect(page).not.toContain("relationship source");
  });

  it("falls back to relationship label plus a linked target when no description exists", () => {
    const view = detail({ relationships: [{ ...detail().relationships[0], description: "", displayLabel: "uncle of" }] });
    const page = render(view);
    expect(page).toContain("uncle of</span> <a");
    expect(page).toContain("Kylar Birthwitch</a>");
  });

  it("keeps inverse semantic duplicates to one relationship row before presentation", () => {
    const rows = relationshipsForEntity([
      { id: "r1", source_entity_id: "colinus", target_entity_id: "kylar", relationship_type: "uncle_of", description: "Colinus is Kylar's uncle.", confidence: 0.9 },
      { id: "r2", source_entity_id: "kylar", target_entity_id: "colinus", relationship_type: "nephew_of", description: "Kylar is Colinus's nephew.", confidence: 0.9 },
    ], "colinus");
    expect(rows).toHaveLength(1);
  });

  it("renders compact source references that expose full evidence with native disclosure", () => {
    const page = render();
    expect(page).toContain("[p. 45]");
    expect(page).toContain("<details");
    expect(page).toContain("Colinus is Kylar&#x27;s uncle.");
  });

  it("deduplicates source pages without losing multiple excerpts on that page", () => {
    const sources = [
      source("one", 45, "First excerpt."),
      source("two", 45, "Second excerpt."),
      source("three", 72, "Third excerpt."),
    ];
    const groups = groupSourceEvidence(sources);
    expect(groups[0].pages.map((page) => page.pageNumber)).toEqual([45, 72]);
    expect(groups[0].pages[0].sources.map((item) => item.supporting_text)).toEqual(["First excerpt.", "Second excerpt."]);
    expect(sourceReference(sources)).toBe("[p. 45, 72]");
  });

  it("groups sources from different documents separately", () => {
    const groups = groupSourceEvidence([
      source("one", 2, "One."),
      source("two", 3, "Two.", "document-2", "Appendix.pdf"),
    ]);
    expect(groups.map((group) => group.filename)).toEqual(["Campaign Notes.pdf", "Appendix.pdf"]);
  });

  it("renders gracefully with zero relationships", () => {
    const page = render(detail({ relationships: [] }));
    expect(page).toContain("No supported relationships were found.");
  });

  it("renders many relationships as one compact row each", () => {
    const relationships = Array.from({ length: 12 }, (_, index) => ({
      id: `r-${index}`,
      displayLabel: "knows",
      description: `Colinus knows Person ${index}.`,
      relatedEntity: { id: `person-${index}`, name: `Person ${index}`, type: "npc" as const },
      sources: [],
    }));
    const page = render(detail({ relationships }));
    expect((page.match(/<li class="py-3 leading-7">/g) ?? [])).toHaveLength(12);
  });

  it("keeps location parent and immediate sublocations available", () => {
    const page = render(detail({
      entity: { ...detail().entity, type: "location", roles: [] },
      locationHierarchy: {
        parent: { id: "village", name: "Tomar's Crossing" },
        children: [{ id: "basement", name: "Basement" }],
        path: [{ id: "village", name: "Tomar's Crossing" }, { id: "colinus", name: "Colinus Birthwitch" }],
        isRoot: false,
        isOrphan: false,
      },
    }));
    expect(page).toContain("Location context");
    expect(page).toContain("Tomar&#x27;s Crossing");
    expect(page).toContain("Basement");
  });

  it("renders from supplied persisted data without any OpenAI dependency", () => {
    expect(() => render()).not.toThrow();
  });
});
