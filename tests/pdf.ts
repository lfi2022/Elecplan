import { PDFDocument, StandardFonts } from "pdf-lib";
export async function textPdf(content: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText(content, { x: 50, y: 700, font, size: 12 });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
