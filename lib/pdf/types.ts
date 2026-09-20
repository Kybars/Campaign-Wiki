export interface DocumentPage {
  pageNumber: number;
  /** Authoritative extracted source used for grounding and provenance. */
  text: string;
  /** Deterministically cleaned copy used only in model inputs. */
  modelText?: string;
}

export interface PageChunk {
  id: string;
  pages: DocumentPage[];
  characterCount: number;
}
