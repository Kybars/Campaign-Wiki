import { EntityDetail, type EntityDetailView } from "@/components/entity-detail";
import { EntityPreviewLink } from "@/components/entity-preview-link";
import { articleQuickFacts, articleSections } from "@/lib/wiki/article";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const source = { id: "evidence-1", document_id: "doc-1", filename: "Campaign Notes.pdf", page_number: 27, supporting_text: "Colinus is a hunter and councilmember." };
const fact = (id: string, fieldKey: string, content: string, evidence = [source]) => ({ id, fieldKey, content, sortOrder: 0, evidence });
function detail(type: EntityDetailView["entity"]["type"] = "npc", facts: NonNullable<EntityDetailView["facts"]> = []): EntityDetailView {
  return { entity: { id: "colinus", name: "Colinus", type, roles: [], aliases: [], summary: "A useful campaign reference." }, facts, relationships: [], sources: [] };
}

describe("rich type-specific articles", () => {
  it("composes NPC facts into readable, source-cited sections and omits empty headings", () => {
    const page = renderToStaticMarkup(createElement(EntityDetail, { campaignId: "campaign", detail: detail("npc", [fact("job", "occupation", "Hunter"), fact("look", "appearance", "Weathered and watchful"), fact("goal", "goal", "Protect the village")]) }));
    expect(page).toContain("At a glance"); expect(page).toContain("Appearance &amp; manner"); expect(page).toContain("Goals &amp; motivations"); expect(page).toContain("[p. 27]"); expect(page).not.toContain("Capabilities</h2>");
  });
  it("keeps item mechanics distinct from powers and preserves their source text", () => {
    const sections = articleSections("item", [fact("stats", "mechanics", "+1 to attack rolls"), fact("power", "special_power", "Emits daylight")]);
    expect(sections.find((section) => section.title === "Stats")?.facts[0].content).toBe("+1 to attack rolls"); expect(sections.find((section) => section.title === "Powers & benefits")?.facts[0].content).toBe("Emits daylight");
  });
  it("uses deterministic type-specific ordering for location, deity, faction, quest, event, and Other facts", () => {
    expect(articleSections("location", [fact("a", "atmosphere", "Warm"), fact("b", "first_impression", "Busy")]).map((section) => section.title)).toEqual(["First impression", "Atmosphere"]);
    expect(articleQuickFacts("deity", [fact("d", "domain", "Sun")]).map((item) => item.content)).toEqual(["Sun"]);
    expect(articleQuickFacts("faction", [fact("p", "party_standing", "Suspicious")]).map((item) => item.content)).toEqual(["Suspicious"]);
    expect(articleQuickFacts("quest", [fact("q", "objective", "Find the relic")]).map((item) => item.content)).toEqual(["Find the relic"]);
    expect(articleSections("event", [fact("e", "what_happened", "The gate fell")]).map((section) => section.title)).toEqual(["What happened"]);
    expect(articleSections("other", [fact("o", "detail", "A strange omen")]).map((section) => section.title)).toEqual(["Details"]);
  });
  it("keeps citations fact-specific and preserves Player mode on preview links", () => {
    const page = renderToStaticMarkup(createElement(EntityDetail, { campaignId: "campaign", detail: detail("npc", [fact("safe", "occupation", "Hunter", [source]), fact("other", "hook", "Investigate the ruins", [{ ...source, id: "evidence-2", supporting_text: "The ruins are dangerous." }])]) }));
    expect(page).toContain("Colinus is a hunter and councilmember."); expect(page).toContain("The ruins are dangerous.");
    const preview = renderToStaticMarkup(createElement(EntityPreviewLink, { campaignId: "campaign", viewMode: "player", entity: { id: "friend", name: "Friend", type: "npc", summary: "A safe ally.", quickFacts: ["Guide"] } }));
    expect(preview).toContain('href="/campaigns/campaign/entities/friend?view=player"');
  });
});
