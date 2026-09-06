import { describe, expect, it } from "vitest";
import { candidateEntitySchema, entityTypeSchema } from "@/lib/ai/schemas";
import { buildCanonicalGraph } from "@/lib/graph/build";
import type { CandidateAggregate, GlobalCandidateEntity } from "@/lib/graph/types";
import { ENTITY_TYPES, hasEntityRole } from "@/lib/entities";

function entity(
  id: string,
  name: string,
  type: GlobalCandidateEntity["type"],
  roles: GlobalCandidateEntity["roles"],
): GlobalCandidateEntity {
  const [chunkId, temporaryId] = id.split(":");
  return {
    id,
    chunkId,
    temporaryId,
    name,
    type,
    roles,
    aliases: [],
    summary: `${name} is explicitly described in the campaign.`,
    sources: [{ page_number: 1, supporting_text: `${name} is explicitly described in the campaign.` }],
  };
}

describe("Milestone 1 entity ontology", () => {
  it("accepts deity as an entity type without adding enemy as a type", () => {
    expect(entityTypeSchema.parse("deity")).toBe("deity");
    expect(ENTITY_TYPES).toContain("deity");
    expect(ENTITY_TYPES).not.toContain("enemy");
    expect(() => entityTypeSchema.parse("enemy")).toThrow();
  });

  it("accepts the enemy role on different underlying entity types", () => {
    for (const [name, type] of [["Xancrown", "deity"], ["Merriath", "npc"], ["Cult of Chaos", "faction"]] as const) {
      const parsed = candidateEntitySchema.parse({
        temporary_id: name,
        name,
        type,
        roles: ["enemy"],
        aliases: [],
        summary: `${name} is a campaign antagonist.`,
        sources: [{ page_number: 1, supporting_text: `${name} is a campaign antagonist.` }],
      });
      expect(hasEntityRole(parsed, "enemy")).toBe(true);
    }
  });

  it("preserves source-backed roles while merging same-type candidates", () => {
    const aggregate: CandidateAggregate = {
      entities: [
        entity("c1:x", "Xancrown", "deity", ["enemy"]),
        entity("c2:x", "Xancrown", "deity", []),
      ],
      relationships: [],
    };
    const graph = buildCanonicalGraph(aggregate);
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]).toMatchObject({ name: "Xancrown", type: "deity", roles: ["enemy"] });
    expect(graph.entities[0].sources).toHaveLength(1);
    expect(graph.entities[0].roleSources.enemy).toEqual(graph.entities[0].sources);
  });
});
