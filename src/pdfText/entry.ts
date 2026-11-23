type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let ready: Promise<PdfJs> | null = null;

/** pdf.js warns about canvas polyfills it does not need for text; keep those out of the extension's output. */
async function load(): Promise<PdfJs> {
  const log = console.log;
  const warn = console.warn;
  console.log = console.warn = () => undefined;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // @ts-expect-error the worker ships no types; under Node it runs in-process (pdf.js "fake worker").
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return pdfjs;
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

export async function extractText(
  bytes: Uint8Array,
  maxPages = 30,
): Promise<string> {
  const pdfjs = await (ready ??= load());
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  try {
    let out = '';
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Last positioned item: a y jump starts a line, a horizontal gap on the same line separates words.
      let prev: { x: number; y: number; w: number; h: number } | null = null;
      for (const item of content.items as Array<{
        str?: string;
        hasEOL?: boolean;
        transform: number[];
        width: number;
        height: number;
      }>) {
        const str = item.str ?? '';
        if (str && prev) {
          const [, , , d, x, y] = item.transform;
          // Larger of the two font heights, so superscripts (raised a few points) stay on their line.
          const h = Math.max(prev.h, item.height || Math.abs(d));
          if (Math.abs(y - prev.y) > h * 0.6) {
            if (!out.endsWith('\n')) out += '\n';
          } else if (x > prev.x + prev.w + 1 && !/\s$/.test(out) && !/^\s/.test(str)) {
            out += ' ';
          }
        }
        if (str) prev = { x: item.transform[4], y: item.transform[5], w: item.width, h: item.height || Math.abs(item.transform[3]) };
        out += str + (item.hasEOL ? '\n' : '');
      }
      out += '\n';
      page.cleanup();
    }
    return out;
  } finally {
    await doc.destroy();
  }
}
