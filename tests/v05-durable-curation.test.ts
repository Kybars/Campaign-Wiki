import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { entityCurationUpdate, relationshipVisibilityBlockers } from "@/lib/curation";
import { playerVisibleCategoryKeys, shouldRedirectHiddenPlayerPage, visibleRelationships } from "@/lib/campaign-view";
import { conciseRelationshipExcerpt } from "@/lib/relationships/evidence";
import { normalizeRelationshipFact } from "@/lib/relationships/normalize";
import { relationshipsForEntity } from "@/lib/relationships/view";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260916192058_v05_durable_gm_curation.sql"), "utf8");

describe("v0.5 durable GM curation", () => {
  it.each([
    [{ field: "type", value: "faction" } as const, { type: "faction", type_is_manual: true }],
    [{ field: "prominence", value: "major" } as const, { prominence: "major", prominence_is_manual: true }],
    [{ field: "prominence", value: null } as const, { prominence: null, prominence_is_manual: true }],
    [{ field: "visibility", value: "player_visible" } as const, { visibility: "player_visible", visibility_is_manual: true }],
    [{ field: "quest_status", value: "ongoing" } as const, { quest_status: "ongoing", quest_status_is_manual: true }],
    [{ field: "quest_status", value: null } as const, { quest_status: null, quest_status_is_manual: true }],
  ])("marks $field as an explicit manual choice", (patch, expected) => {
    expect(entityCurationUpdate(patch)).toEqual(expected);
  });

  it("changes type without issuing writes to identity, relationships, aliases, or sources", () => {
    expect(Object.keys(entityCurationUpdate({ field: "type", value: "faction" }))).toEqual(["type", "type_is_manual"]);
  });

  it("wraps graph replay and restores all manual entity and relationship choices", () => {
    expect(migration).toContain("rename to replace_campaign_graph_import_v04");
    for (const field of ["type_is_manual", "prominence_is_manual", "visibility_is_manual", "quest_status_is_manual"]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("result := public.replace_campaign_graph_import_v04");
    expect(migration).toContain("where id = (entity_override->>'id')::uuid and campaign_id = p_campaign_id");
    expect(migration).toContain("where id = (relationship_override->>'id')::uuid and campaign_id = p_campaign_id");
    expect(migration).toContain("visibility_is_manual = true");
    expect(migration).toContain("create type public.quest_status as enum ('ongoing', 'not_started', 'finished')");
  });
});

describe("v0.5 Player View safety", () => {
  const visible = { id: "visible", name: "Mira", type: "npc" as const, roles: [], aliases: [], visibility: "player_visible" as const };
  const hidden = { id: "hidden", name: "Leska", type: "faction" as const, roles: ["enemy"] as const, aliases: [], visibility: "dm_only" as const };

  it("redirects known hidden pages but leaves true missing IDs to 404", () => {
    expect(shouldRedirectHiddenPlayerPage("player", true, false)).toBe(true);
    expect(shouldRedirectHiddenPlayerPage("player", false, false)).toBe(false);
    expect(shouldRedirectHiddenPlayerPage("dm", true, false)).toBe(false);
  });

  it("omits category tabs with zero player-visible entities", () => {
    expect(playerVisibleCategoryKeys([visible, hidden])).toEqual(["npc"]);
  });

  it("requires both visible endpoints and explains every hidden endpoint", () => {
    const relationship = { visibility: "player_visible" as const, source_entity_id: visible.id, target_entity_id: hidden.id };
    expect(visibleRelationships([relationship], [visible, hidden], "player")).toEqual([]);
    expect(relationshipVisibilityBlockers(visible, hidden)).toEqual(["Leska is not visible to players."]);
    expect(relationshipVisibilityBlockers(hidden, { ...hidden, name: "The Scourge" })).toEqual(["Leska is not visible to players.", "The Scourge is not visible to players."]);
  });
});

describe("v0.5 relationship presentation", () => {
  it.each([
    ["advises", "advised by"],
    ["bodyguard of", "guarded by"],
    ["personal guard of", "has personal guard"],
    ["is emperor of", "has emperor"],
    ["conquered", "conquered by"],
  ])("uses the identical canonical sentence label for %s", (relationshipType) => {
    expect(normalizeRelationshipFact("a", "b", relationshipType).inverseLabel).toBe(relationshipType);
  });

  it("never manufactures Connected Via for freeform relationships", () => {
    const fact = normalizeRelationshipFact("a", "b", "plans to betray");
    expect(fact.inverseLabel).toBe("plans to betray");
    expect(relationshipsForEntity([{ id: "r", source_entity_id: "a", target_entity_id: "b", relationship_type: "plans to betray", description: "", confidence: 1 }], "b")[0].displayLabel).not.toMatch(/connected via/i);
  });

  it("selects the smallest source sentence containing both endpoints and caps fallback text", () => {
    const text = "A long preface describes the war. Leska advises Drakus Coaltongue in secret. Another sentence follows.";
    expect(conciseRelationshipExcerpt(text, ["Leska", "Drakus Coaltongue"], "advises")).toBe("Leska advises Drakus Coaltongue in secret.");
    expect(conciseRelationshipExcerpt("x ".repeat(500), ["Missing", "Names"], "unknown", 320).length).toBeLessThanOrEqual(320);
  });
});
