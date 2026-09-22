/**
 * Name placement for the Hypervision LaunchPad certificate.
 *
 * Pure math with no dependencies so the placement can be previewed and tested
 * outside the browser with exactly the logic the download uses.
 *
 * The name goes on the blue underline below "This certificate is presented
 * to". Where that underline is depends on how the template was exported, so
 * the slot is detected from the template's own pixels at render time
 * (`detectNameSlot`); `DEFAULT_NAME_SLOT` is the fallback, measured from
 * public/certificate-template.png (2000 × 1414 px).
 */

/** Slot geometry as fractions of the template size (origin top-left). */
export interface NameSlot {
  /** Top edge of the name underline / template height. */
  lineY: number;
  /** Underline extent / template width. */
  lineX0: number;
  lineX1: number;
  /** Bottom edge of the text line above the slot / template height. */
  textAboveBottom: number;
  /** Top edge of the paragraph below the underline / template height. */
  textBelowTop: number;
}

export const DEFAULT_NAME_SLOT: NameSlot = {
  lineY: 736 / 1414,
  lineX0: 617 / 2000,
  lineX1: 1381 / 2000,
  textAboveBottom: 644 / 1414,
  textBelowTop: 769 / 1414,
};

/** How the name is fitted into the slot (fractions of page size, pt for sizes). */
export const NAME_FIT = {
  baselineLift: 0.002,  // baseline sits this far above the underline
  topPadding: 0.004,    // clearance under the text above
  bottomPadding: 0.002, // descenders stay this far above the paragraph below
  widthFill: 0.94,      // max share of the underline the name may span
  maxFontSize: 60,
  minFontSize: 14,
} as const;

/**
 * Finds the name slot in a template's RGBA pixels: the widest single
 * contiguous steel-blue horizontal rule in the middle of the page, and the
 * nearest dark text above it. Returns null when the template doesn't look
 * like this design, so the caller can fall back to DEFAULT_NAME_SLOT.
 */
export function detectNameSlot(rgba: ArrayLike<number>, width: number, height: number): NameSlot | null {
  const isLineBlue = (i: number) =>
    rgba[i + 3] > 128 && rgba[i + 2] > rgba[i] + 25 && rgba[i + 2] > 90 && rgba[i] < 140;
  const isDarkText = (i: number) =>
    rgba[i + 3] > 128 && rgba[i] + rgba[i + 1] + rgba[i + 2] < 420 && rgba[i + 2] < rgba[i] + 40;

  // 1. Rows that look like one contiguous rule, in the central band of the page
  const xStart = Math.floor(width * 0.2);
  const xEnd = Math.ceil(width * 0.8);
  const rows: { y: number; x0: number; x1: number }[] = [];
  for (let y = Math.floor(height * 0.3); y < Math.ceil(height * 0.75); y++) {
    let count = 0;
    let x0 = width;
    let x1 = -1;
    for (let x = xStart; x < xEnd; x++) {
      if (isLineBlue((y * width + x) * 4)) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (count >= width * 0.12 && count >= (x1 - x0 + 1) * 0.85) rows.push({ y, x0, x1 });
  }
  if (rows.length === 0) return null;

  // 2. Group consecutive rows into rules; the name underline is the widest one
  const rules: { top: number; bottom: number; x0: number; x1: number }[] = [];
  for (const r of rows) {
    const last = rules[rules.length - 1];
    if (last && r.y === last.bottom + 1) {
      last.bottom = r.y;
      last.x0 = Math.min(last.x0, r.x0);
      last.x1 = Math.max(last.x1, r.x1);
    } else {
      rules.push({ top: r.y, bottom: r.y, x0: r.x0, x1: r.x1 });
    }
  }
  rules.sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
  const rule = rules[0];
  if (rule.bottom - rule.top > height * 0.01) return null; // too thick to be a rule

  // 3. Nearest text ink above the rule
  let textBottom = -1;
  const tx0 = Math.floor(width * 0.25);
  const tx1 = Math.ceil(width * 0.75);
  for (let y = rule.top - 2; y > rule.top - height * 0.15; y--) {
    let dark = 0;
    for (let x = tx0; x < tx1 && dark < 3; x++) if (isDarkText((y * width + x) * 4)) dark++;
    if (dark >= 3) {
      textBottom = y + 1;
      break;
    }
  }
  if (textBottom < 0 || rule.top - textBottom < height * 0.02) return null;

  // 4. Nearest text ink below the rule (descenders must not reach it)
  let textTop = -1;
  for (let y = rule.bottom + 2; y < rule.bottom + height * 0.15 && y < height; y++) {
    let dark = 0;
    for (let x = tx0; x < tx1 && dark < 3; x++) if (isDarkText((y * width + x) * 4)) dark++;
    if (dark >= 3) {
      textTop = y;
      break;
    }
  }
  if (textTop < 0) textTop = Math.min(height, rule.bottom + height * 0.15);

  return {
    lineY: rule.top / height,
    lineX0: rule.x0 / width,
    lineX1: rule.x1 / width,
    textAboveBottom: textBottom / height,
    textBelowTop: textTop / height,
  };
}

/**
 * Ink extents of the laid-out name in em, relative to the text origin. Ink —
 * not advance width — is what the eye centres, which matters for a script
 * face whose swashes overhang asymmetrically.
 */
export interface NameMetrics {
  inkMinXEm: number;
  inkMaxXEm: number;
  /** Highest glyph extent above the baseline, in em. */
  inkMaxYEm: number;
  /** Lowest glyph extent, in em (negative when the name has descenders). */
  inkMinYEm: number;
}

export interface NameLayout {
  /** Font size in pt. */
  size: number;
  /** Text origin, PDF coordinates (origin bottom-left). */
  x: number;
  y: number;
}

/**
 * Picks the largest font size whose ink fits the slot — in width, in height
 * under the text above, and with its descenders clear of the paragraph below,
 * all using the real extents of this name — and returns where to draw it so
 * the ink is centred on the underline.
 */
export function layoutName(
  metrics: NameMetrics,
  pageWidth: number,
  pageHeight: number,
  slot: NameSlot = DEFAULT_NAME_SLOT,
): NameLayout {
  const lineY = pageHeight * (1 - slot.lineY);
  const baseline = lineY + pageHeight * NAME_FIT.baselineLift;
  const ceiling = pageHeight * (1 - slot.textAboveBottom - NAME_FIT.topPadding);
  const lineWidth = pageWidth * (slot.lineX1 - slot.lineX0);
  const lineCenterX = pageWidth * ((slot.lineX0 + slot.lineX1) / 2);

  const inkWidthEm = Math.max(metrics.inkMaxXEm - metrics.inkMinXEm, 0.01);
  const sizeByWidth = (lineWidth * NAME_FIT.widthFill) / inkWidthEm;
  const sizeByHeight = (ceiling - baseline) / Math.max(metrics.inkMaxYEm, 0.01);
  const floor = pageHeight * (1 - slot.textBelowTop + NAME_FIT.bottomPadding);
  const descentEm = Math.max(-metrics.inkMinYEm, 0);
  const sizeByDescent = descentEm > 0.01 ? (baseline - floor) / descentEm : Infinity;
  const size = Math.max(
    NAME_FIT.minFontSize,
    Math.min(NAME_FIT.maxFontSize, sizeByWidth, sizeByHeight, sizeByDescent),
  );

  const inkCenterEm = (metrics.inkMinXEm + metrics.inkMaxXEm) / 2;
  return { size, x: lineCenterX - inkCenterEm * size, y: baseline };
}
