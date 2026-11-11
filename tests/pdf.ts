import { PDFDocument, StandardFonts } from "pdf-lib";
export async function textPdf(content: string, pages = 1) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++)
    pdf.addPage().drawText(content, { x: 50, y: 700, font, size: 12 });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
