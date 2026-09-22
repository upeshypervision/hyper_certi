/**
 * Name placement for the Hypervision LaunchPad certificate template
 * (public/certificate-template.png, 1532 × 1343 px).
 *
 * Pure math with no dependencies so the placement can be previewed and tested
 * outside the browser with exactly the logic the download uses.
 *
 * Every value is a ratio of the template's width or height, measured from the
 * artwork's pixels, so the placement holds at any page size that keeps the
 * template's aspect ratio:
 *   - name underline ........ y = 689 px from top, x = 551..979 px
 *   - "presented to" text ... bottom edge at y = 632 px from top
 */
export const NAME_SLOT = {
  lineY: 689 / 1343,           // underline, from top
  lineX0: 551 / 1532,
  lineX1: 979 / 1532,
  textAboveBottom: 632 / 1343, // bottom of "This certificate is presented to", from top
  baselineLift: 4 / 1343,      // baseline sits this far above the underline
  topPadding: 8 / 1343,        // keep ascenders clear of the text above
  widthFill: 0.92,             // max share of the underline the name may span
  maxFontSize: 44,
  minFontSize: 14,
} as const;

/**
 * Ink extents of the laid-out name in em, relative to the text origin
 * (a font's `layout(name).bbox` divided by its unitsPerEm). Ink — not advance
 * width — is what the eye centres, which matters for a script face whose
 * swashes overhang asymmetrically.
 */
export interface NameMetrics {
  inkMinXEm: number;
  inkMaxXEm: number;
  /** Highest glyph extent above the baseline, in em. */
  inkMaxYEm: number;
}

export interface NameLayout {
  /** Font size in pt. */
  size: number;
  /** Text origin, PDF coordinates (origin bottom-left). */
  x: number;
  y: number;
}

/**
 * Picks the largest font size whose ink fits the blank slot above the
 * underline — both in width and in height, using the real extents of this
 * name — and returns where to draw it so the ink is centred on the underline.
 */
export function layoutName(metrics: NameMetrics, pageWidth: number, pageHeight: number): NameLayout {
  const lineY = pageHeight * (1 - NAME_SLOT.lineY);
  const baseline = lineY + pageHeight * NAME_SLOT.baselineLift;
  const ceiling = pageHeight * (1 - NAME_SLOT.textAboveBottom - NAME_SLOT.topPadding);
  const lineWidth = pageWidth * (NAME_SLOT.lineX1 - NAME_SLOT.lineX0);
  const lineCenterX = pageWidth * ((NAME_SLOT.lineX0 + NAME_SLOT.lineX1) / 2);

  const inkWidthEm = Math.max(metrics.inkMaxXEm - metrics.inkMinXEm, 0.01);
  const sizeByWidth = (lineWidth * NAME_SLOT.widthFill) / inkWidthEm;
  const sizeByHeight = (ceiling - baseline) / Math.max(metrics.inkMaxYEm, 0.01);
  const size = Math.max(NAME_SLOT.minFontSize, Math.min(NAME_SLOT.maxFontSize, sizeByWidth, sizeByHeight));

  const inkCenterEm = (metrics.inkMinXEm + metrics.inkMaxXEm) / 2;
  return { size, x: lineCenterX - inkCenterEm * size, y: baseline };
}
