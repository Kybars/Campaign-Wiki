import { buildEventChronology } from "@/lib/events/chronology";
import { describe, expect, it } from "vitest";

const event = (id: string, name: string, facts: Array<{ fieldKey: string; content: string }>) => ({ id, name, summary: "", facts });

describe("event chronology", () => {
  it("sorts only comparable ISO exact dates and preserves their source text", () => {
    const groups = buildEventChronology([event("later", "Later", [{ fieldKey: "exact_date", content: "2026-09-12" }]), event("earlier", "Earlier", [{ fieldKey: "exact_date", content: "2026-09-10" }])]);
    expect(groups[0].title).toBe("Dated events");
    expect(groups[0].entries.map((entry) => entry.name)).toEqual(["Earlier", "Later"]);
  });

  it("keeps fictional and relative timing neutral rather than inventing an order", () => {
    const groups = buildEventChronology([event("ash", "Night of Ash", [{ fieldKey: "exact_date", content: "14 Frostfall 1023" }, { fieldKey: "relative_chronology", content: "Three days after the comet fell" }]), event("muster", "Undated Muster", [])]);
    expect(groups.map((group) => group.title)).toEqual(["Recorded timing", "Unknown date"]);
    expect(groups[0].entries[0].facts[0].content).toBe("14 Frostfall 1023");
  });

  it("uses explicit era and numeric sequence only when present, with a neutral name fallback", () => {
    const groups = buildEventChronology([event("two", "Second", [{ fieldKey: "chronology_sequence", content: "2" }]), event("one", "First", [{ fieldKey: "chronology_sequence", content: "1" }]), event("ancient", "Ancient", [{ fieldKey: "chronology_context", content: "Ancient History" }])]);
    expect(groups.find((group) => group.title === "Sequenced events")?.entries.map((entry) => entry.name)).toEqual(["First", "Second"]);
    expect(groups.find((group) => group.title === "Ancient History")?.entries.map((entry) => entry.name)).toEqual(["Ancient"]);
  });
});
