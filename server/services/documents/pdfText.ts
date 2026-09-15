import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedPdfText {
  fullText: string;
  extractedLinks: string[];
}

/**
 * Extracts text plus embedded link annotations from a PDF buffer.
 *
 * The asterisk substitutions preserve GeM's redaction markers: the portal
 * masks consignee addresses with runs of '*', and downstream prompts rely
 * on that being stated rather than silently dropped.
 */
export async function extractTextFromBuffer(
  buffer: ArrayBuffer | Uint8Array
): Promise<ExtractedPdfText> {
  // Node hands us a Buffer (a Uint8Array view); axios/fetch hand us an
  // ArrayBuffer. pdfjs wants a Uint8Array either way.
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;

  let fullText = '';
  const extractedLinks: string[] = [];

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);

    const textContent = await page.getTextContent();
    let pageText = textContent.items.map((item: any) => item.str).join(' ');
    pageText = pageText.replace(/\*{7,}/g, () => '(Exact Location not visible due to security reasons) ');
    pageText = pageText.replace(/\*{5,}([A-Z\s,]+)/g, '$1');
    fullText += pageText + '\n';

    try {
      const annotations = await page.getAnnotations();
      annotations.forEach((anno: any) => {
        if (anno.subtype === 'Link' && anno.url) {
          extractedLinks.push(anno.url);
        }
      });
    } catch (e) {
      console.warn(`⚠️ Warning: Failed to extract annotations from page ${pageNum}. Continuing without links from this page.`);
    }
  }

  const relativeLinks = fullText.match(/\/bidding\/buyer\/[a-zA-Z0-9\/_-]+/g) || [];
  relativeLinks.forEach(u => extractedLinks.push(`https://bidplus.gem.gov.in${u}`));

  return {
    fullText,
    extractedLinks: Array.from(new Set(extractedLinks)),
  };
}

/** Collects GeM document links from raw RFP text when none were supplied. */
export function collectLinksFromText(content: string): string[] {
  const relativeLinks = content.match(/\/bidding\/buyer\/[a-zA-Z0-9\/_-]+/g) || [];
  const absoluteLinks = content.match(/https?:\/\/[^\s"')]+/g) || [];
  const mappedRelative = relativeLinks.map((u: string) => `https://bidplus.gem.gov.in${u}`);
  return Array.from(new Set([...absoluteLinks, ...mappedRelative]));
}
