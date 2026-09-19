/**
 * Converts the shared worksheet model into an editable .docx via the
 * `docx` package. Reuses the exact same StyledRun[] the HTML renderer
 * consumes — no separate coloring logic (blueprint 8.6/8.9).
 *
 * Known Phase-0 limitation, recorded rather than hidden: bundled fonts are
 * *declared* on each run (`font: "Andika"` etc.) but not embedded in the
 * file. `docx`'s FontTable only registers a font-family reference; true
 * OOXML font embedding requires obfuscated embedded font parts the library
 * does not expose. Word/LibreOffice will substitute a fallback font unless
 * the chosen font is installed on the machine that opens the file. This is
 * exactly the go/no-go risk the blueprint (8.9) flags for Phase 0 —
 * resolved here as "not yet embedded," not silently assumed.
 *
 * settings.lineStripes (zebra striping) is deliberately NOT implemented
 * here. Blueprint 8.6 is explicit about why: "alternating paragraphs is
 * not equivalent to alternating physical lines... if a line wraps again in
 * Word, the feature fails the compatibility gate" — and 8.6 again: "this
 * feature is deliberately scheduled after basic exports." Reproducing it in
 * Word would mean pre-splitting the passage into one paragraph per line at
 * the SAME character offsets the browser wrapped at, then trusting Word's
 * own layout engine to wrap identically at those conservative widths —
 * unverified without the real cross-application "compatibility gate"
 * testing (actual Word, actual LibreOffice, actual content) the blueprint
 * calls for, which is a separate, later effort. Everything else about the
 * passage (text, colors, personalization, sentence-per-line, trace,
 * tint) still exports correctly; only the striped background is skipped.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  HeightRule,
  WidthType,
  VerticalAlign,
  ShadingType,
  convertMillimetersToTwip
} from 'docx';
import { FONT_FAMILIES, TWIPS_PER_PT, mmToPx, mmToTwips, TINTS_BY_ID } from '../config.js';

/**
 * @param {import('../text/runs.js').StyledRun[]} runs
 * @param {{ fontFamily: string, fontSizePt: number, characterSpacingTwips: number }} options
 * @returns {TextRun[]}
 */
function toWordRuns(runs, { fontFamily, fontSizePt, characterSpacingTwips }) {
  return runs.map(
    (run) =>
      new TextRun({
        text: run.text,
        color: run.color.replace('#', ''),
        font: fontFamily,
        size: Math.round(fontSizePt * 2),
        characterSpacing: characterSpacingTwips || undefined
      })
  );
}

/**
 * @param {import('../worksheet/build.js').WorksheetModel} model
 * @param {{ rowCount: number }} layout the fit-checked layout decision from layout/measure.js
 * @param {Uint8Array | Buffer | undefined} imageBytes decoded bytes of model.image
 * @returns {Promise<Blob>} browser- and Node-compatible; tests convert via .arrayBuffer()
 */
export async function exportDocx(model, layout, imageBytes) {
  const s = model.settings;
  const fontFamily = FONT_FAMILIES[s.fontId] ?? s.fontId;
  const characterSpacingTwips = Math.round((s.letterSpacingPt ?? 0) * TWIPS_PER_PT);

  /** @type {(Paragraph | Table)[]} */
  const children = [];

  // Page tint (brief section 5) is print-optional to save ink (blueprint
  // 8.5); reuses paragraph shading rather than page background, since Word
  // page color is a screen-only feature by default and often isn't printed
  // (blueprint 8.6: "Test cell/paragraph/page shading rather than assume a
  // screen background prints").
  const tintHex = s.tintId && s.tintId !== 'none' ? TINTS_BY_ID[s.tintId] : undefined;
  const shading = s.printTint && tintHex ? { type: ShadingType.CLEAR, fill: tintHex.replace('#', '') } : undefined;

  if (model.header.nameLine || model.header.date) {
    const parts = [];
    if (model.header.nameLine) {
      parts.push(new TextRun({ text: 'Ime: _______________________', font: fontFamily, size: 22 }));
    }
    if (model.header.date) {
      parts.push(new TextRun({ text: '          Datum: ________________', font: fontFamily, size: 22 }));
    }
    children.push(new Paragraph({ children: parts, spacing: { after: 200 }, shading }));
  }

  if (model.header.title) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: model.header.titleText, bold: true, font: fontFamily, size: Math.round((s.fontSizePt + 4) * 2) })
        ],
        spacing: { after: 200 },
        shading
      })
    );
  }

  if (imageBytes) {
    const widthMm = 60;
    const heightMm = 45;
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            type: 'jpg',
            data: imageBytes,
            transformation: { width: Math.round(mmToPx(widthMm)), height: Math.round(mmToPx(heightMm)) }
          })
        ],
        spacing: { after: 200 },
        shading
      })
    );
  }

  for (const paragraphRuns of model.bodyParagraphs) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { line: Math.round((s.lineHeightMultiplier ?? 1.5) * 240) },
        children: toWordRuns(paragraphRuns, { fontFamily, fontSizePt: s.fontSizePt, characterSpacingTwips }),
        shading
      })
    );
  }

  // Copy-practice lines: a single-column table with one row per line.
  // Paragraph-border "exact" spacing on empty/near-empty paragraphs was
  // tried first and verified (via real LibreOffice conversion) to collapse
  // unpredictably -- office layout engines don't treat pPr spacing the way
  // browsers treat CSS line-height. A table's row height is authoritative
  // across Word/LibreOffice, which is why this is the standard technique
  // for ruled lines in generated Word documents. The full three-line guide
  // (top + dashed midline + baseline) is still deferred to a PNG-guide
  // adapter (blueprint 8.7) -- a bottom border alone is the Phase 0 subset.
  if (s.writingMode === 'read-copy' && layout?.rowCount > 0) {
    const rowHeightTwips = mmToTwips(s.guideHeightMm ?? 10);
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const rows = [];
    for (let i = 0; i < layout.rowCount; i++) {
      rows.push(
        new TableRow({
          height: { value: rowHeightTwips, rule: HeightRule.EXACT },
          children: [
            new TableCell({
              width: { size: mmToTwips(170), type: WidthType.DXA },
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              verticalAlign: VerticalAlign.BOTTOM,
              borders: { top: noBorder, left: noBorder, right: noBorder, bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } },
              children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })]
            })
          ]
        })
      );
    }
    children.push(
      new Table({
        width: { size: mmToTwips(170), type: WidthType.DXA },
        borders: {
          top: noBorder,
          bottom: noBorder,
          left: noBorder,
          right: noBorder,
          insideHorizontal: noBorder,
          insideVertical: noBorder
        },
        rows
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
            margin: {
              top: convertMillimetersToTwip(s.marginMm),
              bottom: convertMillimetersToTwip(s.marginMm),
              left: convertMillimetersToTwip(s.marginMm),
              right: convertMillimetersToTwip(s.marginMm)
            }
          }
        },
        children
      }
    ]
  });

  return Packer.toBlob(doc);
}
