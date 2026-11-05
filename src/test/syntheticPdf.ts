/**
 * Builds tiny, entirely invented PDF files for tests. No real document is ever used as a
 * fixture. Pages hold plain Helvetica text; options add the kinds of active content a hostile
 * PDF might carry so tests can prove it is ignored.
 */
export interface SyntheticPdfOptions {
  /** One entry per page; each string is shown on its own line. */
  pages: string[][];
  /** Adds an OpenAction that would run JavaScript if a reader executed it. */
  javascript?: boolean;
  /** Adds a link annotation to an external address on the first page. */
  link?: boolean;
}

const escape = (text: string): string => text.replace(/([\\()])/g, '\\$1');

export function buildSyntheticPdf(options: SyntheticPdfOptions): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const pageCount = options.pages.length;
  // 1 catalog, 2 pages, 3 font, then (page, content[, annotation]) per page.
  const pageObjectNumber = (index: number): number => 4 + index * (options.link ? 3 : 2);
  const kids = options.pages.map((_, index) => `${pageObjectNumber(index)} 0 R`).join(' ');
  const action = options.javascript
    ? ' /OpenAction << /S /JavaScript /JS (app.alert\\(1\\);) >>'
    : '';
  add(`<< /Type /Catalog /Pages 2 0 R${action} >>`);
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  options.pages.forEach((lines, index) => {
    const page = pageObjectNumber(index);
    const annots = options.link && index === 0 ? ` /Annots [${page + 2} 0 R]` : '';
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R${annots} >>`,
    );
    const stream = lines
      .map((line, row) => `BT /F1 12 Tf 72 ${720 - row * 20} Td (${escape(line)}) Tj ET`)
      .join('\n');
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    if (options.link) {
      if (index === 0) {
        add(
          '<< /Type /Annot /Subtype /Link /Rect [72 700 300 730] /A << /S /URI /URI (example.invalid/never-followed) >> >>',
        );
      } else {
        add('<< /Type /Annot /Subtype /Text /Rect [0 0 1 1] >>');
      }
    }
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (char) => char.charCodeAt(0) & 0xff);
}
