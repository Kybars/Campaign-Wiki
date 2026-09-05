import { describe, expect, it } from "vitest";
import { normalizeName } from "@/lib/graph/normalize";

describe("normalizeName", () => {
  it.each([
    [" Ralekai ", "ralekai"],
    ["RALEKAI", "ralekai"],
    ["Tomar’s   Crossing", "tomar s crossing"],
    ["Cult-of-Ash", "cult of ash"],
  ])("normalizes %s", (input, expected) => expect(normalizeName(input)).toBe(expected));
});
