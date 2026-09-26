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
 * passage (text, colors, sentence-per-line, trace,
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
  LineRuleType,
  WidthType,
  VerticalAlign,
  ShadingType,
  LineNumberRestartFormat,
  convertMillimetersToTwip
} from 'docx';
import { FONT_FAMILIES, TWIPS_PER_PT, mmToPx, mmToTwips, TINTS_BY_ID, contentWidthMm, LINE_NUMBER_GUTTER_MM, DRAWING_BOX_GAP_MM } from '../config.js';
import { computeContainedImageSizeMm, IMAGE_BOX_LARGE } from '../layout/imageBox.js';

/** Matches src/render/html.js DEFAULT_LABELS — used only when a caller doesn't pass the active locale's translated labels. */
const DEFAULT_LABELS = {
  nameLine: 'Ime:',
  date: 'Datum:',
  instruction: (key) => {
    throw new Error(`MISSING_LABEL: sheet.instruction.${key}`);
  }
};

/**
 * Splits each run on whitespace so word spacing (settings.extraWordSpacePt)
 * can be applied only to the space runs, on top of the uniform letter
 * spacing applied to every run — the same two-property split CSS
 * letter-spacing/word-spacing gives the HTML preview, previously missing
 * from DOCX export entirely (upgrade blueprint v3, workstream D3).
 * @param {import('../text/runs.js').StyledRun[]} runs
 * @param {{ fontFamily: string, fontSizePt: number, characterSpacingTwips: number, wordSpacingTwips: number }} options
 * @returns {TextRun[]}
 */
function toWordRuns(runs, { fontFamily, fontSizePt, characterSpacingTwips, wordSpacingTwips }) {
  const wordRuns = [];
  for (const run of runs) {
    for (const segment of run.text.split(/(\s+)/)) {
      if (segment.length === 0) continue;
      const isSpace = /^\s+$/.test(segment);
      const spacingTwips = characterSpacingTwips + (isSpace ? wordSpacingTwips : 0);
      wordRuns.push(
        new TextRun({
          text: segment,
          color: run.color.replace('#', ''),
          bold: run.bold,
          font: fontFamily,
          size: Math.round(fontSizePt * 2),
          characterSpacing: spacingTwips || undefined
        })
      );
    }
  }
  return wordRuns;
}

/**
 * @typedef {object} BlockWriteContext
 * @property {import('../worksheet/build.js').WorksheetModel} model
 * @property {{ nameLine: string, date: string, instruction?: (key: string) => string }} labels
 * @property {Uint8Array | Buffer | undefined} imageBytes
 * @property {string} fontFamily
 * @property {object | undefined} shading paragraph shading when the tint prints, else undefined
 * @property {number} characterSpacingTwips
 * @property {number} wordSpacingTwips
 * @property {number} contentWidthTwips
 * @property {{ suppressLineNumbers?: true }} unnumbered spread into every non-passage paragraph: with line numbers on, Word numbers passage lines only (tables are never numbered)
 */

/**
 * One writer per block type (upgrade blueprint §11.5.3), each returning
 * the Word paragraphs/tables for its block. Must stay in step with
 * render/html.js BLOCK_RENDERERS (a unit test compares the key sets).
 * @type {Record<string, (block: any, context: BlockWriteContext) => (Paragraph | Table)[]>}
 */
export const BLOCK_WRITERS = {
  header: (block, { labels, fontFamily, shading, unnumbered }) => {
    const parts = [];
    if (block.nameLine) {
      parts.push(new TextRun({ text: `${labels.nameLine} _______________________`, font: fontFamily, size: 22 }));
    }
    if (block.date) {
      parts.push(new TextRun({ text: `          ${labels.date} ________________`, font: fontFamily, size: 22 }));
    }
    return [new Paragraph({ children: parts, spacing: { after: 200 }, shading, ...unnumbered })];
  },

  title: (block, { model, fontFamily, shading, unnumbered }) => [
    new Paragraph({
      children: [
        new TextRun({ text: block.text, bold: true, font: fontFamily, size: Math.round((model.settings.fontSizePt + 4) * 2) })
      ],
      spacing: { after: 200 },
      shading,
      ...unnumbered
    })
  ],

  instruction: (block, { model, labels, fontFamily, shading, unnumbered }) => [
    new Paragraph({
      children: [
        new TextRun({
          text: (labels.instruction ?? DEFAULT_LABELS.instruction)(block.key),
          font: fontFamily,
          size: Math.round(model.settings.fontSizePt * 2)
        })
      ],
      spacing: { after: 200 },
      shading,
      ...unnumbered
    })
  ],

  image: (block, { model, imageBytes, shading, unnumbered }) => {
    if (!imageBytes) return [];
    // Contains the image at its real aspect ratio within the same 60x45mm
    // slot the HTML preview uses (object-fit: contain) — previously a fixed
    // 60x45 forced every image (all bundled art is 512x512) into a
    // stretched 4:3 box (workstream D1).
    const { widthMm, heightMm } = block.size === 'large'
      ? computeContainedImageSizeMm(model.image.width, model.image.height, IMAGE_BOX_LARGE.widthMm, IMAGE_BOX_LARGE.heightMm)
      : computeContainedImageSizeMm(model.image.width, model.image.height);
    return [
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
        shading,
        ...unnumbered
      })
    ];
  },

  passage: (block, { model, fontFamily, shading, characterSpacingTwips, wordSpacingTwips }) => {
    const s = model.settings;
    // Line spacing must be EXACT, in twips of the font size, to mean the same
    // thing as the preview's CSS `line-height: <multiplier>` (a multiple of
    // the font size). The default "auto" rule multiplies the font's own
    // natural line height instead, which for Andika is 1.61em (Lexend
    // 1.25em) — so with the real fonts installed, 1.4x came out as 2.25em
    // per line, 60% taller than the preview, and every read-copy worksheet
    // that filled the page spilled its copy lines onto a second page. The
    // development machine had none of the bundled fonts installed and
    // LibreOffice's Liberation Sans substitute (1.15em) happened to fit, so
    // verify-docx passed until CI installed the real fonts (0.8.1, F4).
    const lineTwips = Math.round((s.lineHeightMultiplier ?? 1.5) * s.fontSizePt * TWIPS_PER_PT);
    // Same gap as the preview's `.ws-body.ws-sentence-per-line .ws-sentence {
    // margin-bottom: 0.25em }`, which applies whenever there is more than one
    // paragraph (sentence-per-line or authored paragraph breaks). DOCX had no
    // gap at all before 0.10, so it ran slightly shorter than the preview.
    const paragraphGapTwips = block.paragraphs.length > 1 ? Math.round(0.25 * s.fontSizePt * TWIPS_PER_PT) : 0;
    // Line numbers: the same gutter the preview reserves, so Word wraps at
    // the width the fit check measured. Word draws its numbers left of the
    // text column itself (section lnNumType, set in exportDocx).
    const gutter = block.lineNumbers ? { indent: { left: mmToTwips(LINE_NUMBER_GUTTER_MM) } } : {};
    return block.paragraphs.map(
      (paragraphRuns) =>
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: paragraphGapTwips > 0
            ? { line: lineTwips, lineRule: LineRuleType.EXACT, after: paragraphGapTwips }
            : { line: lineTwips, lineRule: LineRuleType.EXACT },
          children: toWordRuns(paragraphRuns, { fontFamily, fontSizePt: s.fontSizePt, characterSpacingTwips, wordSpacingTwips }),
          shading,
          ...gutter
        })
    );
  },

  // A table, like the copy lines, because a row's exact height is the one
  // height Word and LibreOffice both honour. The first, borderless row is
  // the gap above the box (the preview's margin-top). The small paragraph
  // after it keeps Word from merging this table with the copy-line table
  // that may follow, and a document may not end on a table.
  drawingBox: (block, { contentWidthTwips, unnumbered }) => {
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const line = { style: BorderStyle.SINGLE, size: 6, color: '333333' };
    const row = (heightMm, borders) =>
      new TableRow({
        height: { value: mmToTwips(heightMm), rule: HeightRule.EXACT },
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: contentWidthTwips, type: WidthType.DXA },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            borders,
            children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })]
          })
        ]
      });
    return [
      new Table({
        width: { size: contentWidthTwips, type: WidthType.DXA },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [
          row(DRAWING_BOX_GAP_MM, { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }),
          row(block.heightMm, { top: line, bottom: line, left: line, right: line })
        ]
      }),
      new Paragraph({ spacing: { before: 0, after: 0, line: mmToTwips(1), lineRule: LineRuleType.EXACT }, children: [], ...unnumbered })
    ];
  }
};

/**
 * @param {import('../worksheet/build.js').WorksheetModel} model
 * @param {{ copyBlocks: number[] }} layout the fit-checked layout decision from layout/measure.js — one entry in copyBlocks per copy-practice block (a second entry means a page break is needed before it)
 * @param {Uint8Array | Buffer | undefined} imageBytes decoded bytes of model.image
 * @param {{ nameLine: string, date: string, instruction?: (key: string) => string }} [labels] translated header.nameLine/header.date strings and instruction lines (i18n.sheetLabels) for the active locale (blueprint 8.1: every teacher-facing label must localize) — falls back to the Slovene defaults only if omitted
 * @returns {Promise<Blob>} browser- and Node-compatible; tests convert via .arrayBuffer()
 */
export async function exportDocx(model, layout, imageBytes, labels = DEFAULT_LABELS) {
  const s = model.settings;
  const fontFamily = FONT_FAMILIES[s.fontId] ?? s.fontId;
  const characterSpacingTwips = Math.round((s.letterSpacingPt ?? 0) * TWIPS_PER_PT);
  const wordSpacingTwips = Math.round((s.extraWordSpacePt ?? 0) * TWIPS_PER_PT);
  // Derived from the actual margin setting rather than hardcoded — margin
  // has no UI control today (always 20mm, giving 170mm), but a settings
  // field for it already exists and is validated, so this must not
  // silently drift from it if a control is ever added.
  const contentWidthTwips = mmToTwips(contentWidthMm(s.marginMm));

  /** @type {(Paragraph | Table)[]} */
  const children = [];

  // Page tint (brief section 5) is print-optional to save ink (blueprint
  // 8.5); reuses paragraph shading rather than page background, since Word
  // page color is a screen-only feature by default and often isn't printed
  // (blueprint 8.6: "Test cell/paragraph/page shading rather than assume a
  // screen background prints").
  const tintHex = s.tintId && s.tintId !== 'none' ? TINTS_BY_ID[s.tintId] : undefined;
  const shading = s.printTint && tintHex ? { type: ShadingType.CLEAR, fill: tintHex.replace('#', '') } : undefined;

  const lineNumbers = model.blocks.some((block) => block.type === 'passage' && block.lineNumbers);
  const unnumbered = lineNumbers ? { suppressLineNumbers: true } : {};

  /** @type {BlockWriteContext} */
  const context = { model, labels, imageBytes, fontFamily, shading, characterSpacingTwips, wordSpacingTwips, contentWidthTwips, unnumbered };
  for (const block of model.blocks) {
    const write = BLOCK_WRITERS[block.type];
    if (!write) throw new Error(`UNKNOWN_BLOCK: "${block.type}"`);
    children.push(...write(block, context));
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
  //
  // layout.copyBlocks (upgrade blueprint v3, workstream A) is one entry
  // per block the fit check decided on — a second entry means the copy
  // exercise needs a fresh page, same as the HTML/print output's
  // .ws-copy-block--new-page; a Word page break is inserted before it
  // rather than relying on the table simply overflowing, so Word's own
  // pagination matches the app's.
  if (model.task === 'lines' && layout?.copyBlocks?.length > 0) {
    const rowHeightTwips = mmToTwips(s.guideHeightMm ?? 10);
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    layout.copyBlocks.forEach((rowCount, blockIndex) => {
      if (blockIndex > 0) {
        children.push(new Paragraph({ children: [], pageBreakBefore: true, ...unnumbered }));
      }
      const rows = [];
      for (let i = 0; i < rowCount; i++) {
        rows.push(
          new TableRow({
            height: { value: rowHeightTwips, rule: HeightRule.EXACT },
            cantSplit: true,
            children: [
              new TableCell({
                width: { size: contentWidthTwips, type: WidthType.DXA },
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
          width: { size: contentWidthTwips, type: WidthType.DXA },
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
    });
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
          },
          // Word's own line numbering: every line, one count across pages.
          ...(lineNumbers ? { lineNumbers: { countBy: 1, restart: LineNumberRestartFormat.CONTINUOUS } } : {})
        },
        children
      }
    ]
  });

  return Packer.toBlob(doc);
}
