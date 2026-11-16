import { createRequire } from 'node:module';
import { join } from 'node:path';

type Extract = (bytes: Uint8Array, maxPages?: number) => Promise<string>;
let loaded: Extract | null = null;

/**
 * Text of a PDF, read in memory. pdf.js lives in its own bundle next to the
 * extension (pdftext.js) and is loaded the first time a subject is read, so it
 * never slows the extension's start.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  if (!loaded) {
    loaded = (createRequire(__filename)(join(__dirname, 'pdftext.js')) as {
      extractText: Extract;
    }).extractText;
  }
  return loaded(bytes);
}
