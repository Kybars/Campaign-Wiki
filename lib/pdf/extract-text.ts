import type { DocumentPage } from "@/lib/pdf/types";

export const NO_EXTRACTABLE_TEXT_MESSAGE =
  "We couldn't extract readable text from this PDF. Campaign Wiki v0 currently supports text-based PDFs only.";

export class PdfExtractionError extends Error {
  constructor(message: string, readonly code: "INVALID_PDF" | "NO_TEXT" | "EXTRACTION_FAILED") {
    super(message);
    this.name = "PdfExtractionError";
  }
}

function normalizeExtractedPage(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfPages(input: ArrayBuffer | Uint8Array): Promise<DocumentPage[]> {
  // Node Buffers inherit from Uint8Array, but PDF.js deliberately rejects them.
  // Copy into a plain Uint8Array so uploads and fs fixtures behave identically.
  const data = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input);
  const header = new TextDecoder("ascii").decode(data.slice(0, Math.min(1024, data.length)));
  if (data.length < 5 || !header.includes("%PDF-")) {
    throw new PdfExtractionError("Please upload a valid PDF.", "INVALID_PDF");
  }

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    const pages: DocumentPage[] = [];

    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          text += item.str;
          text += item.hasEOL ? "\n" : " ";
        }
        pages.push({ pageNumber, text: normalizeExtractedPage(text) });
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }

    const usefulCharacters = pages.reduce((total, page) => total + page.text.replace(/\s/g, "").length, 0);
    if (usefulCharacters < 20) throw new PdfExtractionError(NO_EXTRACTABLE_TEXT_MESSAGE, "NO_TEXT");
    return pages;
  } catch (error) {
    if (error instanceof PdfExtractionError) throw error;
    throw new PdfExtractionError(
      error instanceof Error ? `PDF extraction failed: ${error.message}` : "PDF extraction failed.",
      "EXTRACTION_FAILED",
    );
  }
}
