import { describe, expect, it } from "vitest";
import { relationshipsForEntity } from "@/lib/relationships/view";

const relationship = {
  id: "r1",
  source_entity_id: "hanna",
  target_entity_id: "inn",
  relationship_type: "owns",
  description: "Hanna owns the inn.",
  confidence: 0.95,
};

describe("bidirectional relationship view", () => {
  it("renders a stored relationship from the source side", () => {
    expect(relationshipsForEntity([relationship], "hanna")[0]).toMatchObject({ outgoing: true, relatedEntityId: "inn", displayLabel: "owns" });
  });

  it("renders that same row from the target side with inverse language", () => {
    expect(relationshipsForEntity([relationship], "inn")[0]).toMatchObject({ outgoing: false, relatedEntityId: "hanna", displayLabel: "owned by" });
  });
});
