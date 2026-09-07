export interface SourceEvidence {
  id: string;
  document_id: string;
  filename: string;
  page_number: number;
  supporting_text: string;
}

export interface SourcePageGroup {
  pageNumber: number;
  sources: SourceEvidence[];
}

export interface SourceDocumentGroup {
  documentId: string;
  filename: string;
  pages: SourcePageGroup[];
}

export function groupSourceEvidence(sources: readonly SourceEvidence[]): SourceDocumentGroup[] {
  const documents = new Map<string, SourceDocumentGroup>();
  for (const source of sources) {
    const document = documents.get(source.document_id) ?? {
      documentId: source.document_id,
      filename: source.filename,
      pages: [],
    };
    if (!documents.has(source.document_id)) documents.set(source.document_id, document);
    const page = document.pages.find((candidate) => candidate.pageNumber === source.page_number) ?? {
      pageNumber: source.page_number,
      sources: [],
    };
    if (!document.pages.includes(page)) document.pages.push(page);
    const duplicate = page.sources.some((candidate) => candidate.supporting_text.trim() === source.supporting_text.trim());
    if (!duplicate) page.sources.push(source);
  }
  return [...documents.values()].map((document) => ({
    ...document,
    pages: [...document.pages].sort((left, right) => left.pageNumber - right.pageNumber),
  }));
}

export function sourceReference(sources: readonly SourceEvidence[]) {
  const pageNumbers = [...new Set(sources.map((source) => source.page_number))].sort((left, right) => left - right);
  return `[p. ${pageNumbers.join(", ")}]`;
}
