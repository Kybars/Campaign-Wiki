import type { DocumentPage, PageChunk } from "@/lib/pdf/types";

export interface ChunkOptions {
  targetCharacters?: number;
  overlapPages?: number;
}

export function chunkPages(pages: DocumentPage[], options: ChunkOptions = {}): PageChunk[] {
  const targetCharacters = options.targetCharacters ?? 45_000;
  const overlapPages = options.overlapPages ?? 1;
  if (targetCharacters < 1) throw new Error("targetCharacters must be positive");
  if (overlapPages < 0) throw new Error("overlapPages cannot be negative");
  if (pages.length === 0) return [];

  const chunks: PageChunk[] = [];
  let start = 0;
  while (start < pages.length) {
    const chunkPages: DocumentPage[] = [];
    let characters = 0;
    let cursor = start;

    while (cursor < pages.length) {
      const page = pages[cursor];
      const projected = characters + page.text.length;
      if (chunkPages.length > 0 && projected > targetCharacters) break;
      chunkPages.push(page);
      characters = projected;
      cursor += 1;
    }

    chunks.push({ id: `chunk-${chunks.length + 1}`, pages: chunkPages, characterCount: characters });
    if (cursor >= pages.length) break;
    const retainedOverlap = Math.min(overlapPages, Math.max(0, chunkPages.length - 1));
    start = cursor - retainedOverlap;
  }
  return chunks;
}
