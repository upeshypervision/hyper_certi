'use client';

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { detectNameSlot, layoutName, type NameMetrics, type NameSlot } from './certificateLayout';

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
  /** Where the name goes on this template (see detectNameSlot); default slot if omitted. */
  slot?: NameSlot;
}

const NAME_COLOR = rgb(0.067, 0.145, 0.427); // #11254D — deep navy, matches the template's blues

type FontkitFont = ReturnType<typeof fontkit.create>;
type GlyphRun = ReturnType<FontkitFont['layout']>;

/** Reference page width in pt (A4 landscape). Height follows the template's aspect ratio. */
const PAGE_WIDTH = 841.89;

const toBytes = (b: ArrayBuffer | Uint8Array): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b));

/**
 * Ink extents of a laid-out run in em, placed the way pdf-lib places it: each
 * glyph advanced by its raw advance width. (The run's own `bbox` would also
 * apply GPOS kerning, which never reaches the PDF, so it drifts off-centre
 * for a script face like Great Vibes.)
 */
function measureInk(font: FontkitFont, run: GlyphRun): NameMetrics {
  const upm = font.unitsPerEm;
  let x = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minY = Infinity;
  for (const glyph of run.glyphs) {
    const b = glyph.bbox;
    if (Number.isFinite(b.minX)) minX = Math.min(minX, x + b.minX);
    if (Number.isFinite(b.maxX)) maxX = Math.max(maxX, x + b.maxX);
    if (Number.isFinite(b.maxY)) maxY = Math.max(maxY, b.maxY);
    if (Number.isFinite(b.minY)) minY = Math.min(minY, b.minY);
    x += glyph.advanceWidth;
  }
  // Whitespace-only input has no ink: fall back to the advance box.
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) [minX, maxX] = [0, x];
  if (!Number.isFinite(maxY)) maxY = font.ascent;
  if (!Number.isFinite(minY)) minY = 0;
  return { inkMinXEm: minX / upm, inkMaxXEm: maxX / upm, inkMaxYEm: maxY / upm, inkMinYEm: minY / upm };
}

/**
 * pdf-lib writes glyph widths (/W) only for glyphs reachable from a Unicode
 * code point. Glyphs that exist purely through OpenType substitution — Great
 * Vibes' ligatures (`ff`) and contextual alternates (`en`, `or`, `th`, ...) —
 * fall back to the PDF default width of 1 em, which rendered "Jaffrey" as
 * "Jaff rey". Embed the font now and append those glyphs' real advances, so
 * the face keeps every flourish it has on screen.
 */
async function addSubstitutionGlyphWidths(pdfDoc: PDFDocument, font: PDFFont, metricsFont: FontkitFont, run: GlyphRun): Promise<void> {
  await font.embed(); // writes the font dicts now; a no-op again at save()
  const type0 = pdfDoc.context.lookup(font.ref, PDFDict);
  const cidFont = type0.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
  const widths = cidFont.lookup(PDFName.of('W'), PDFArray);

  const fromUnicode = new Set(metricsFont.characterSet.map((cp) => metricsFont.glyphForCodePoint(cp).id));
  const scale = 1000 / metricsFont.unitsPerEm;
  const added = new Set<number>();
  for (const glyph of run.glyphs) {
    if (fromUnicode.has(glyph.id) || added.has(glyph.id)) continue;
    added.add(glyph.id);
    widths.push(PDFNumber.of(glyph.id));
    widths.push(pdfDoc.context.obj([glyph.advanceWidth * scale]));
  }
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
export async function buildCertificatePdf({ name, templateBytes, fontBytes, slot }: BuildCertificateOptions): Promise<Uint8Array> {
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
  const font = await pdfDoc.embedFont(fontBytes);
  const metricsFont = fontkit.create(toBytes(fontBytes));
  const run = metricsFont.layout(name); // same default features pdf-lib uses to encode the text
  const { size, x, y } = layoutName(measureInk(metricsFont, run), pageWidth, pageHeight, slot);

  // 4. Draw the name, ink-centred on the underline
  page.drawText(name, { x, y, size, font, color: NAME_COLOR });
  await addSubstitutionGlyphWidths(pdfDoc, font, metricsFont, run);

  return pdfDoc.save();
}

/**
 * Decodes the template in the browser and locates the name slot in its
 * pixels. Undefined (→ default slot) if the image can't be decoded or the
 * template doesn't match the design.
 */
async function detectSlotInBrowser(templateBytes: ArrayBuffer): Promise<NameSlot | undefined> {
  try {
    const bitmap = await createImageBitmap(new Blob([templateBytes]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return detectNameSlot(data, canvas.width, canvas.height) ?? undefined;
  } catch {
    return undefined;
  }
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
  const slot = await detectSlotInBrowser(templateBytes);

  const pdfBytes = await buildCertificatePdf({ name, templateBytes, fontBytes, slot });

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
