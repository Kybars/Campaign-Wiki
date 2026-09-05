export interface DocumentPage {
  pageNumber: number;
  text: string;
}

export interface PageChunk {
  id: string;
  pages: DocumentPage[];
  characterCount: number;
}
