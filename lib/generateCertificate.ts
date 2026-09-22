'use client';

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { layoutName, type NameMetrics } from './certificateLayout';

interface GenerateCertificateOptions {
  name: string;
  templateUrl: string;
}

export interface BuildCertificateOptions {
  name: string;
  /** PNG or JPEG bytes of the certificate template. */
  templateBytes: ArrayBuffer | Uint8Array;
  /** TrueType bytes of the font used for the name. */
  fontBytes: ArrayBuffer | Uint8Array;
}

const NAME_COLOR = rgb(0.067, 0.145, 0.427); // #11254D — deep navy, matches the template's blues

/**
 * OpenType features for the name. Every multi-letter substitution is off:
 * Great Vibes' ligature (`ff`, `fi`) and contextual-alternate (`en`, `or`,
 * `th`, ...) glyphs get an advance in the PDF that doesn't match their ink,
 * so "Jaffrey" rendered as "Jaff rey" and "Venkat" as "Ven kat". The plain
 * single glyphs join up fine in this face.
 */
const NAME_FEATURES = { liga: false, dlig: false, clig: false, calt: false } as const;

/** Reference page width in pt (A4 landscape). Height follows the template's aspect ratio. */
const PAGE_WIDTH = 841.89;

const toBytes = (b: ArrayBuffer | Uint8Array): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b));

/**
 * Ink extents of `text` in em, placed the way pdf-lib places it: each glyph
 * advanced by its raw advance width. (fontkit's `layout().bbox` would also
 * apply GPOS kerning, which never reaches the PDF, so it drifts off-centre
 * for a script face like Great Vibes.)
 */
function measureInk(font: ReturnType<typeof fontkit.create>, text: string): NameMetrics {
  const upm = font.unitsPerEm;
  let x = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const glyph of font.layout(text, NAME_FEATURES).glyphs) {
    const b = glyph.bbox;
    if (Number.isFinite(b.minX)) minX = Math.min(minX, x + b.minX);
    if (Number.isFinite(b.maxX)) maxX = Math.max(maxX, x + b.maxX);
    if (Number.isFinite(b.maxY)) maxY = Math.max(maxY, b.maxY);
    x += glyph.advanceWidth;
  }
  // Whitespace-only input has no ink: fall back to the advance box.
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) [minX, maxX] = [0, x];
  if (!Number.isFinite(maxY)) maxY = font.ascent;
  return { inkMinXEm: minX / upm, inkMaxXEm: maxX / upm, inkMaxYEm: maxY / upm };
}

/**
 * Fetches the Great Vibes TrueType font from local public static assets.
 */
async function fetchFont(): Promise<ArrayBuffer> {
  const res = await fetch('/fonts/GreatVibes-Regular.ttf');
  if (!res.ok) {
    throw new Error('Failed to load certificate font.');
  }
  return res.arrayBuffer();
}

/**
 * Builds the certificate PDF: the template as a full-page image, sized to the
 * template's own aspect ratio so the artwork is never stretched, with the
 * participant's name fitted onto the underline (see lib/certificateLayout.ts).
 *
 * Pure (no DOM, no fetch) so it can run in Node for previews and tests.
 */
export async function buildCertificatePdf({ name, templateBytes, fontBytes }: BuildCertificateOptions): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // 1. Detect PNG vs JPEG and embed the template image
  const template = toBytes(templateBytes);
  const isPng = template[0] === 0x89 && template[1] === 0x50 && template[2] === 0x4e && template[3] === 0x47;

  let templateImage;
  try {
    templateImage = isPng ? await pdfDoc.embedPng(template) : await pdfDoc.embedJpg(template);
  } catch {
    // Fallback attempt opposite format if header check failed
    try {
      templateImage = isPng ? await pdfDoc.embedJpg(template) : await pdfDoc.embedPng(template);
    } catch {
      throw new Error('Failed to parse certificate template image. Please ensure the template is a valid PNG or JPG file.');
    }
  }

  // 2. Page takes the template's aspect ratio (1532 × 1343 → 841.89 × 738.03 pt)
  const { width: imgW, height: imgH } = templateImage.scale(1);
  const pageWidth = PAGE_WIDTH;
  const pageHeight = (pageWidth * imgH) / imgW;
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawImage(templateImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });

  // 3. Embed the name font and measure this name's real glyph extents
  const font = await pdfDoc.embedFont(fontBytes, { features: NAME_FEATURES });
  const metricsFont = fontkit.create(toBytes(fontBytes));
  const { size, x, y } = layoutName(measureInk(metricsFont, name), pageWidth, pageHeight);

  // 4. Draw the name, ink-centred on the underline
  page.drawText(name, { x, y, size, font, color: NAME_COLOR });

  return pdfDoc.save();
}

/**
 * Generates the certificate PDF client-side and triggers a browser download.
 */
export async function generateAndDownloadCertificate({
  name,
  templateUrl,
}: GenerateCertificateOptions): Promise<void> {
  // Fetch the certificate template image from Supabase (with cache buster)
  const fetchUrl = templateUrl.includes('?') ? `${templateUrl}&_cb=${Date.now()}` : `${templateUrl}?_cb=${Date.now()}`;
  const templateRes = await fetch(fetchUrl);
  if (!templateRes.ok) {
    throw new Error('Failed to load certificate template from Supabase Storage. Please try again.');
  }
  const [templateBytes, fontBytes] = await Promise.all([templateRes.arrayBuffer(), fetchFont()]);

  const pdfBytes = await buildCertificatePdf({ name, templateBytes, fontBytes });

  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Hypervision-LaunchPad-Certificate-${name.replace(/\s+/g, '-')}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Cleanup
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
