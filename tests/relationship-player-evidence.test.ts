import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntityDetail } from "@/components/entity-detail";
import type { EntityDetailView } from "@/components/entity-detail";
import { relationshipEvidenceForView } from "@/lib/wiki/relationship-evidence";
import type { SourceEvidence } from "@/lib/wiki/source-presentation";

const source: SourceEvidence = {
  id: "relationship-source",
  document_id: "campaign-pdf",
  filename: "Campaign-Guide.pdf",
  page_number: 11,
  supporting_text: "The Fire Forest of Innenotdar holds sway over the ancient path.",
};

function detail(sources: SourceEvidence[]): EntityDetailView {
  return {
    entity: { id: "forest", name: "Fire Forest of Innenotdar", type: "npc", aliases: [], roles: [], summary: "", visibility: "player_visible" },
    sources: [],
    relationships: [{
      id: "relationship",
      description: "",
      displayLabel: "holds sway over",
      relationship_type: "holds sway over",
      visibility: "player_visible",
      relatedEntity: { id: "path", name: "Ancient Path", type: "location" },
      sources,
    }],
  };
}

describe("Player View relationship evidence safety", () => {
  it("keeps relationship wording but omits citations, source excerpts, filenames, and page numbers", () => {
    const playerSources = relationshipEvidenceForView("player", [source]);
    const playerHtml = renderToStaticMarkup(createElement(EntityDetail, { campaignId: "campaign", detail: detail(playerSources), viewMode: "player" }));

    expect(playerSources).toEqual([]);
    expect(playerHtml).toContain("Holds sway over");
    expect(playerHtml).toContain("Ancient Path");
    expect(playerHtml).not.toContain("[p. 11]");
    expect(playerHtml).not.toContain("Show evidence");
    expect(playerHtml).not.toContain("The Fire Forest of Innenotdar holds sway over the ancient path.");
    expect(playerHtml).not.toContain("Campaign-Guide.pdf");
    expect(playerHtml).not.toContain("Page 11");
  });

  it("retains the citation and source evidence in DM View", () => {
    const dmSources = relationshipEvidenceForView("dm", [source]);
    const dmHtml = renderToStaticMarkup(createElement(EntityDetail, { campaignId: "campaign", detail: detail(dmSources), viewMode: "dm" }));

    expect(dmSources).toEqual([source]);
    expect(dmHtml).toContain("[p. 11]");
    expect(dmHtml).toContain("Show evidence for holds sway over: [p. 11]");
    expect(dmSources[0].supporting_text).toContain("ancient path");
    expect(dmSources[0].filename).toBe("Campaign-Guide.pdf");
  });
});
