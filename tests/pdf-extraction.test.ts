import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfPages, PdfExtractionError } from "@/lib/pdf/extract-text";

describe("PDF extraction", () => {
  it("rejects data without a PDF signature", async () => {
    await expect(extractPdfPages(new TextEncoder().encode("not a pdf"))).rejects.toMatchObject({ code: "INVALID_PDF" });
  });

  it("preserves page count, ordering, and text", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("Greymoor is a walled town.", { x: 50, y: 700, font });
    pdf.addPage().drawText("Hanna owns the Silver Stag Inn.", { x: 50, y: 700, font });
    const pages = await extractPdfPages(await pdf.save());
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(pages[0].text).toContain("Greymoor");
    expect(pages[1].text).toContain("Silver Stag Inn");
  });

  it("fails clearly for an image-only/blank PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await expect(extractPdfPages(await pdf.save())).rejects.toMatchObject({ code: "NO_TEXT" } satisfies Partial<PdfExtractionError>);
  });

  it("extracts the six-page campaign evaluation fixture", async () => {
    const pdf = await readFile(path.join(process.cwd(), "fixtures", "test-campaign.pdf"));
    const pages = await extractPdfPages(pdf);
    expect(pages).toHaveLength(6);
    expect(pages[0].text).toContain("Hanna Stone");
    expect(pages[5].text).toContain("Demonplague cure");
  });
});
