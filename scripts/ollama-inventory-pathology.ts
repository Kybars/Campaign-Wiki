import { z } from "zod";
import { sourceEvidenceSchema } from "../lib/ai/schemas";

export const namesOnlySchema = z.object({ entities: z.array(z.object({ name: z.string().min(1).max(200) })) });
export const boundedEvidenceSchema = z.object({ entities: z.array(z.object({ name: z.string().min(1).max(200), source: sourceEvidenceSchema.extend({ supporting_text: z.string().min(8).max(240) }) })) });

export function repetitionMetrics(text: string) {
  const words = text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
  const grams = new Map<string, number>();
  for (let index = 0; index + 5 <= words.length; index += 1) { const gram = words.slice(index, index + 5).join(" "); grams.set(gram, (grams.get(gram) ?? 0) + 1); }
  const repeatedFiveGrams = [...grams.values()].filter((count) => count > 1);
  const ids = [...text.matchAll(/"temporary_id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
  const names = [...text.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((match) => match[1].toLocaleLowerCase("en-US"));
  return { wordCount: words.length, completedTemporaryIdFields: ids.length, duplicateTemporaryIds: ids.length - new Set(ids).size, nameFields: names.length, duplicateNormalizedNames: names.length - new Set(names).size, repeatedFiveGramKinds: repeatedFiveGrams.length, maxFiveGramRepeats: repeatedFiveGrams.length ? Math.max(...repeatedFiveGrams) : 0, repeatedEvidenceFieldCount: [...text.matchAll(/"supporting_text"\s*:/g)].length };
}
