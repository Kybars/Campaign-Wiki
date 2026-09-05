import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

interface Fixture { title: string; pages: string[] }

export async function createFixturePdf(outputPath = path.join(process.cwd(), "fixtures", "test-campaign.pdf")) {
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "test-campaign.json"), "utf8")) as Fixture;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  fixture.pages.forEach((text, index) => {
    const page = pdf.addPage([612, 792]);
    page.drawText(fixture.title, { x: 54, y: 730, size: 20, font: bold, color: rgb(0.2, 0.18, 0.15) });
    page.drawText(`Campaign notes — page ${index + 1}`, { x: 54, y: 702, size: 10, font, color: rgb(0.4, 0.38, 0.34) });
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (`${current} ${word}`.trim().length > 78) { lines.push(current); current = word; }
      else current = `${current} ${word}`.trim();
    }
    if (current) lines.push(current);
    lines.forEach((line, lineIndex) => page.drawText(line, { x: 54, y: 655 - lineIndex * 20, size: 12, font }));
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await pdf.save());
  return outputPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))) {
  createFixturePdf().then((output) => console.log(`Created ${output}`));
}
