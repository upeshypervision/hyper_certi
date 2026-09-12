'use client';

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

interface GenerateCertificateOptions {
  name: string;
  templateUrl: string;
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
 * Generates a certificate PDF client-side using pdf-lib.
 *
 * Strategy:
 * 1. Fetch the PNG template and embed it as a full-page image.
 * 2. Load Great Vibes font via fontkit.
 * 3. Draw the participant's name in the blank area of the certificate
 *    (between "THIS IS TO CERTIFY THAT" and the body paragraph).
 * 4. Trigger browser download of the PDF.
 *
 * The template is landscape A4: 1263 × 893 px (PNG resolution ~150dpi)
 * PDF points: A4 landscape = 841.89 × 595.28 pt
 */
export async function generateAndDownloadCertificate({
  name,
  templateUrl,
}: GenerateCertificateOptions): Promise<void> {
  // 1. Fetch the certificate template image from Supabase (with cache buster)
  const fetchUrl = templateUrl.includes('?') ? `${templateUrl}&_cb=${Date.now()}` : `${templateUrl}?_cb=${Date.now()}`;
  const templateRes = await fetch(fetchUrl);
  if (!templateRes.ok) {
    throw new Error('Failed to load certificate template from Supabase Storage. Please try again.');
  }
  const templateBytes = await templateRes.arrayBuffer();

  // 2. Create PDF document
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // A4 Landscape dimensions in points
  const pageWidth = 841.89;
  const pageHeight = 595.28;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // 3. Detect PNG vs JPEG/JPG and embed template image
  const header = new Uint8Array(templateBytes.slice(0, 4));
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;

  let templateImage;
  try {
    templateImage = isPng
      ? await pdfDoc.embedPng(templateBytes)
      : await pdfDoc.embedJpg(templateBytes);
  } catch (embedErr) {
    // Fallback attempt opposite format if header check failed
    try {
      templateImage = isPng
        ? await pdfDoc.embedJpg(templateBytes)
        : await pdfDoc.embedPng(templateBytes);
    } catch {
      throw new Error('Failed to parse certificate template image. Please ensure the template is a valid PNG or JPG file.');
    }
  }

  page.drawImage(templateImage, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  // 4. Load Great Vibes font
  const fontBytes = await fetchFont();
  const greatVibesFont = await pdfDoc.embedFont(fontBytes);

  // 5. Calculate name placement
  // New certificate layout (certi_latex.pdf / Advanced LaTeX Workshop):
  // - "This is to certify that" baseline  ≈ 406.5 pt  (ratio 0.682)
  // - Blank gap top (text bottom)          ≈ 393 pt   (ratio 0.660)
  // - Horizontal name-underline            ≈ 328.4 pt (ratio 0.552)
  // - "has successfully participated..."   ≈ 262.9 pt (ratio 0.441)
  //
  // Name baseline target: center of blank gap above the underline
  //   center = (393 + 328.4) / 2 ≈ 360.7 pt  → ratio ≈ 0.606
  //   At 40 pt Great Vibes, ascender ~32 pt above baseline (fits below 393)
  //   and descender ~12 pt below baseline stays above underline (328.4).
  let fontSize = 40;
  const maxAllowedWidth = pageWidth * 0.48; // ~404 pt — stays within the underline
  let nameWidth = greatVibesFont.widthOfTextAtSize(name, fontSize);

  // Auto-shrink font size if the name is unusually long
  while (nameWidth > maxAllowedWidth && fontSize > 20) {
    fontSize -= 2;
    nameWidth = greatVibesFont.widthOfTextAtSize(name, fontSize);
  }

  const x = (pageWidth - nameWidth) / 2;
  const y = pageHeight * 0.582; // Dropped lower toward the name underline (~346 pt)

  // 6. Draw name in deep navy blue (matching cert color scheme — #11254D)
  page.drawText(name, {
    x,
    y,
    font: greatVibesFont,
    size: fontSize,
    color: rgb(0.067, 0.145, 0.427), // #11254D — deep navy blue
  });

  // 7. Serialize to PDF bytes
  const pdfBytes = await pdfDoc.save();

  // 8. Trigger download
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Advanced-LaTeX-Workshop-Certificate-${name.replace(/\s+/g, '-')}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Cleanup
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
