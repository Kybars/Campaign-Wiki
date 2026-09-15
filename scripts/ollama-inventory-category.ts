import { z } from "zod";
import { entityTypeSchema, sourceEvidenceSchema } from "../lib/ai/schemas";

export const INVENTORY_CATEGORIES = entityTypeSchema.options;
export type InventoryCategory = typeof INVENTORY_CATEGORIES[number];

export function categoryInventorySchema(category: InventoryCategory) {
  return z.object({ entities: z.array(z.object({ temporary_id: z.string().min(1), name: z.string().min(1), type: z.literal(category), aliases: z.array(z.string()), sources: z.array(sourceEvidenceSchema).min(1) })) }).superRefine((value, context) => {
    const ids = new Set<string>();
    value.entities.forEach((entity, index) => {
      if (ids.has(entity.temporary_id)) context.addIssue({ code: "custom", message: "Duplicate inventory ID", path: ["entities", index, "temporary_id"] });
      ids.add(entity.temporary_id);
    });
  });
}

export function categoryInventoryPrompt(category: InventoryCategory) {
  const other = category === "other" ? " Only return legitimate named or specific campaign entities that do not fit NPC, Location, Deity, Faction, Item, Quest, or Event. Do not use Other as a catch-all for generic nouns, rules terms, classes, spells, abilities, or unnamed objects." : "";
  return `Extract every clearly source-supported ${category.toUpperCase()} entity from this source. Return no entities of other types. Do not force ambiguous mentions into ${category.toUpperCase()}. Return an empty entities array if none qualify. Retain minor named entities. Spend output budget on breadth, not description.${other} Before returning, complete a target-category scan for omissions.`;
}
