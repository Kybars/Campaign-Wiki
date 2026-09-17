import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntityDetail, type EntityDetailView } from "@/components/entity-detail";
import type { SourceEvidence } from "@/lib/wiki/source-presentation";

const campaignId = "campaign";
const indomitability = { id: "indomitability", name: "Indomitability", type: "npc" as const };
const fireForest = { id: "fire-forest", name: "Fire Forest of Innenotdar", type: "location" as const };
const source: SourceEvidence = { id: "relationship-source", document_id: "guide", filename: "Campaign Guide.pdf", page_number: 11, supporting_text: "Indomitability holds sway over the Fire Forest of Innenotdar." };

function detail(entity: typeof indomitability | typeof fireForest, relationships: EntityDetailView["relationships"]): EntityDetailView {
  return { entity: { ...entity, aliases: [], roles: [], summary: "", visibility: "player_visible" }, relationships, sources: [] };
}

function holdsSway(sources: SourceEvidence[] = [source]) {
  return { id: "holds-sway", description: "An obsolete relationship description.", displayLabel: "holds sway over", relationship_type: "holds sway over", visibility: "player_visible" as const, relatedEntity: fireForest, sourceEntity: indomitability, targetEntity: fireForest, sources };
}

describe("canonical relationship presentation", () => {
  it("renders the same canonical source-to-target sentence on both endpoint pages without an inverse rewrite", () => {
    const sourcePage = renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail: detail(indomitability, [holdsSway()]), viewMode: "dm" }));
    const targetPage = renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail: detail(fireForest, [{ ...holdsSway(), relatedEntity: indomitability }]), viewMode: "dm" }));

    for (const page of [sourcePage, targetPage]) {
      expect(page).toContain("Indomitability");
      expect(page).toContain("holds sway over");
      expect(page).toContain("Fire Forest of Innenotdar");
      expect(page).not.toContain("Connected via");
      expect(page).not.toContain("obsolete relationship description");
    }
    expect(sourcePage).toContain('Indomitability</span> holds sway over <a');
    expect(targetPage).toContain('>Indomitability</a> holds sway over <span');
  });

  it("keeps opposite directions and multiple relationships as separate canonical sentences", () => {
    const drakus = { id: "drakus", name: "Drakus Coaltongue", type: "npc" as const };
    const shaaladel = { id: "shaaladel", name: "Shaaladel", type: "npc" as const };
    const relationships = [
      { id: "allied", description: "", displayLabel: "is allied with", visibility: "player_visible" as const, relatedEntity: shaaladel, sourceEntity: drakus, targetEntity: shaaladel, sources: [] },
      { id: "betrayal-one", description: "", displayLabel: "plans to betray", visibility: "player_visible" as const, relatedEntity: shaaladel, sourceEntity: drakus, targetEntity: shaaladel, sources: [] },
      { id: "betrayal-two", description: "", displayLabel: "plans to betray", visibility: "player_visible" as const, relatedEntity: shaaladel, sourceEntity: shaaladel, targetEntity: drakus, sources: [] },
    ];
    const page = renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail: detail(drakus, relationships), viewMode: "dm" }));

    expect(page).toContain("Drakus Coaltongue</span> is allied with <a");
    expect(page).toContain("Drakus Coaltongue</span> plans to betray <a");
    expect(page).toContain(">Shaaladel</a> plans to betray <span");
    expect((page.match(/plans to betray/g) ?? [])).toHaveLength(2);
  });

  it("keeps DM citations and controls while Player View hides citations", () => {
    const dmPage = renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail: detail(indomitability, [holdsSway()]), viewMode: "dm" }));
    const playerPage = renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail: detail(indomitability, [holdsSway([])]), viewMode: "player" }));

    expect(dmPage).toContain("[p. 11]");
    expect(dmPage).toContain('aria-label="Hide relationship from players"');
    expect(playerPage).not.toContain("[p. 11]");
    expect(playerPage).not.toContain('aria-label="Hide relationship from players"');
  });
});
