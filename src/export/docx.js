/**
 * The worksheet model as an editable Word file (the `docx` package). It
 * writes the same styled runs the HTML renderer draws, so colours and
 * syllables can't differ between the two.
 *
 * Not in the Word file, and said so by a notice on screen:
 * - the fonts themselves: they are named, not embedded (the library can't
 *   embed them), so Word substitutes one that isn't installed;
 * - zebra stripes and syllable arcs: they follow the browser's line breaks,
 *   and Word breaks lines on its own.
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
  UnderlineType,
  TableLayoutType,
  convertMillimetersToTwip
} from 'docx';
import { FONT_FAMILIES, TWIPS_PER_PT, mmToPx, mmToTwips, TINTS_BY_ID, contentWidthMm, LINE_NUMBER_GUTTER_MM, DRAWING_BOX_GAP_MM, CLOZE, COPY_MARK_COLOR, SEQUENCE_BOX_FACTOR, WORD_BANK, ptToMm } from '../config.js';
import { markedParagraphs } from '../worksheet/copyMark.js';
import { computeContainedImageSizeMm, IMAGE_BOX_LARGE } from '../layout/imageBox.js';

/**
 * Ruled handwriting lines as Word draws them reliably: a one-column table,
 * one exact-height row per line with a bottom border (copy lines, answer
 * lines). keepTogether keeps all rows on one page (answer lines stay with
 * their question); the copy lines don't need it.
 * @param {number} rowCount
 * @param {number} rowHeightTwips
 * @param {number} contentWidthTwips
 * @param {boolean} [keepTogether]
 * @returns {Table}
 */
function ruledLines(rowCount, rowHeightTwips, contentWidthTwips, keepTogether = false) {
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
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
            children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [], ...(keepTogether && i < rowCount - 1 ? { keepNext: true } : {}) })]
          })
        ]
      })
    );
  }
  return new Table({
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
  });
}

/**
 * The copy mark as Word can draw it: a left border on a whole paragraph.
 * Checked in LibreOffice: it sits left of the text and doesn't move it.
 */
const COPY_MARK_BORDER = { left: { style: BorderStyle.SINGLE, size: 12, color: COPY_MARK_COLOR.slice(1), space: 4 } };

/** Slovene, as in render/html.js: only when a caller passes no labels. */
const DEFAULT_LABELS = {
  nameLine: 'Ime:',
  date: 'Datum:',
  instruction: (key) => {
    throw new Error(`MISSING_LABEL: sheet.instruction.${key}`);
  },
  answers: 'Rešitve'
};

/**
 * Splits each run on whitespace, so the extra word spacing goes on the
 * spaces only and the letter spacing on everything, as CSS letter-spacing
 * and word-spacing do in the preview.
 * @param {import('../text/runs.js').StyledRun[]} runs
 * A gap (run.blank) becomes one underlined run of no-break spaces about
 * the sheet's gap width wide (CLOZE.docxNbspEm per space — an estimate;
 * verify-docx checks the page count), with no letter or word spacing, like
 * the preview's fixed-width box. The answer is not in the file — except in
 * the answer key (showAnswers), where the word sits bold in the middle of
 * the underline, padded to about the same width.
 * @param {{ fontFamily: string, fontSizePt: number, characterSpacingTwips: number, wordSpacingTwips: number, blankWidthEm?: number, showAnswers?: boolean }} options
 * @returns {TextRun[]}
 */
function toWordRuns(runs, { fontFamily, fontSizePt, characterSpacingTwips, wordSpacingTwips, blankWidthEm = 0, showAnswers = false }) {
  const wordRuns = [];
  const gapPart = (text, bold) => new TextRun({ text, bold, underline: { type: UnderlineType.SINGLE }, font: fontFamily, size: Math.round(fontSizePt * 2) });
  for (const run of runs) {
    if (run.blank) {
      const spaces = Math.max(1, Math.round(blankWidthEm / CLOZE.docxNbspEm));
      if (!showAnswers) {
        wordRuns.push(gapPart('\u00A0'.repeat(spaces)));
      } else {
        // The word's own width in no-break-space units, estimated like the gap width.
        const wordSpaces = Math.round(([...run.text].length * CLOZE.charWidthEm) / CLOZE.docxNbspEm);
        const pad = '\u00A0'.repeat(Math.max(1, Math.floor((spaces - wordSpaces) / 2)));
        wordRuns.push(gapPart(pad), gapPart(run.text, true), gapPart(pad));
      }
      continue;
    }
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
 * @property {{ nameLine: string, date: string, instruction?: (key: string) => string, answers?: string }} labels
 * @property {Uint8Array | Buffer | undefined} imageBytes
 * @property {string} fontFamily
 * @property {object | undefined} shading paragraph shading when the tint prints, else undefined
 * @property {number} characterSpacingTwips
 * @property {number} wordSpacingTwips
 * @property {number} contentWidthTwips
 * @property {{ suppressLineNumbers?: true }} unnumbered spread into every non-passage paragraph: with line numbers on, Word numbers passage lines only (tables are never numbered)
 */

/**
 * One writer per block type, each returning the block's Word paragraphs and
 * tables. The same keys as render/html.js BLOCK_RENDERERS (a test holds them
 * equal).
 * @type {Record<string, (block: any, context: BlockWriteContext) => (Paragraph | Table)[]>}
 */
export const BLOCK_WRITERS = {
  // "Answers", boxed and right-aligned like the preview's tag.
  answerTag: (_block, { labels, unnumbered }) => [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: labels.answers ?? DEFAULT_LABELS.answers,
          bold: true,
          allCaps: true,
          size: 22,
          border: { style: BorderStyle.SINGLE, size: 6, color: '202020', space: 2 }
        })
      ],
      ...unnumbered
    })
  ],
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
      ...(block.copyMark ? { border: COPY_MARK_BORDER } : {}),
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
    if (!imageBytes || !model.image) return [];
    // At its own aspect ratio, inside the preview's picture box (object-fit: contain).
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
    // EXACT line spacing, a multiple of the font size like CSS line-height.
    // Word's default ("auto") multiplies the font's own line height instead
    // (Andika's is 1.61em), which makes every line far taller than the preview.
    const lineTwips = Math.round((s.lineHeightMultiplier ?? 1.5) * s.fontSizePt * TWIPS_PER_PT);
    // The preview's gap between paragraphs (.ws-sentence margin-bottom: 0.25em).
    const paragraphGapTwips = block.paragraphs.length > 1 ? Math.round(0.25 * s.fontSizePt * TWIPS_PER_PT) : 0;
    // Line numbers: the same gutter the preview reserves, so Word wraps at
    // the width the fit check measured. Word draws its numbers left of the
    // text column itself (section lnNumType, set in exportDocx).
    const gutter = block.lineNumbers ? { indent: { left: mmToTwips(LINE_NUMBER_GUTTER_MM) } } : {};
    // Only paragraphs the copy target covers whole can carry the mark here.
    const marked = markedParagraphs(block).whole;
    return block.paragraphs.map(
      (paragraphRuns, i) =>
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: paragraphGapTwips > 0
            ? { line: lineTwips, lineRule: LineRuleType.EXACT, after: paragraphGapTwips }
            : { line: lineTwips, lineRule: LineRuleType.EXACT },
          children: toWordRuns(paragraphRuns, { fontFamily, fontSizePt: s.fontSizePt, characterSpacingTwips, wordSpacingTwips, blankWidthEm: block.blankWidthEm, showAnswers: block.showAnswers }),
          shading,
          // As the preview (orphans/widows 1): a page may break between any two
          // lines. Word's default keeps two together and can add a page.
          widowControl: false,
          ...(marked.has(i) ? { border: COPY_MARK_BORDER } : {}),
          ...gutter
        })
    );
  },

  // "Put in order": a borderless two-column table, one row per sentence,
  // rows never split (cantSplit), like the copy lines. The square box is a
  // one-cell table of exact height inside the first cell: a cell border
  // alone would stretch with a sentence that wraps. The answer key puts
  // the sentence's place in the box.
  sequence: (block, { model, fontFamily, characterSpacingTwips, wordSpacingTwips, contentWidthTwips, unnumbered }) => {
    const s = model.settings;
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
    const line = { style: BorderStyle.SINGLE, size: 6, color: '202020' };
    const boxTwips = mmToTwips(ptToMm(s.fontSizePt * SEQUENCE_BOX_FACTOR));
    const gapTwips = mmToTwips(4);
    const lineTwips = Math.round((s.lineHeightMultiplier ?? 1.5) * s.fontSizePt * TWIPS_PER_PT);
    // Fixed layout with explicit column widths: without them the grid is the
    // library's default (100 twips a column) and LibreOffice lays the
    // columns out its own way — the rows came out taller than the preview.
    const box = (position) =>
      new Table({
        width: { size: boxTwips, type: WidthType.DXA },
        columnWidths: [boxTwips],
        layout: TableLayoutType.FIXED,
        borders: { ...noBorders, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [
          new TableRow({
            height: { value: boxTwips, rule: HeightRule.EXACT },
            children: [
              new TableCell({
                width: { size: boxTwips, type: WidthType.DXA },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                verticalAlign: VerticalAlign.CENTER,
                borders: { top: line, bottom: line, left: line, right: line },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 0, after: 0 },
                    children: position ? [new TextRun({ text: String(position), bold: true, font: fontFamily, size: Math.round(s.fontSizePt * 2) })] : []
                  })
                ]
              })
            ]
          })
        ]
      });
    const rows = block.items.map(
      (item) =>
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: boxTwips + gapTwips, type: WidthType.DXA },
              margins: { top: 0, bottom: mmToTwips(3), left: 0, right: gapTwips },
              borders: noBorders,
              // A cell must end with a paragraph after a nested table.
              children: [box(block.showAnswers ? item.position : null), new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [] })]
            }),
            new TableCell({
              width: { size: contentWidthTwips - boxTwips - gapTwips, type: WidthType.DXA },
              margins: { top: 0, bottom: mmToTwips(3), left: 0, right: 0 },
              borders: noBorders,
              children: [
                new Paragraph({
                  spacing: { line: lineTwips, lineRule: LineRuleType.EXACT },
                  children: toWordRuns(item.runs, { fontFamily, fontSizePt: s.fontSizePt, characterSpacingTwips, wordSpacingTwips })
                })
              ]
            })
          ]
        })
    );
    return [
      new Table({
        width: { size: contentWidthTwips, type: WidthType.DXA },
        columnWidths: [boxTwips + gapTwips, contentWidthTwips - boxTwips - gapTwips],
        layout: TableLayoutType.FIXED,
        borders: { ...noBorders, insideHorizontal: noBorder, insideVertical: noBorder },
        rows
      }),
      new Paragraph({ spacing: { before: 0, after: 0, line: mmToTwips(1), lineRule: LineRuleType.EXACT }, children: [], ...unnumbered })
    ];
  },

  // Gap-fill word bank: one bordered cell holding the missing words, spaced
  // with no-break spaces (a normal space after each group lets the line
  // wrap). Explicit width and fixed layout, as for every table here.
  wordBank: (block, { model, fontFamily, contentWidthTwips, unnumbered }) => {
    const s = model.settings;
    const line = { style: BorderStyle.SINGLE, size: 6, color: '202020' };
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const gap = `${'\u00A0'.repeat(WORD_BANK.gapSpaces)} `;
    return [
      new Table({
        width: { size: contentWidthTwips, type: WidthType.DXA },
        columnWidths: [contentWidthTwips],
        layout: TableLayoutType.FIXED,
        // The box is the cell's border; the table's own stays off (the library's default would add a second frame).
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                width: { size: contentWidthTwips, type: WidthType.DXA },
                margins: { top: mmToTwips(2), bottom: mmToTwips(2), left: mmToTwips(3), right: mmToTwips(3) },
                borders: { top: line, bottom: line, left: line, right: line },
                children: [
                  new Paragraph({
                    spacing: { before: 0, after: 0, line: Math.round(WORD_BANK.lineHeight * s.fontSizePt * TWIPS_PER_PT), lineRule: LineRuleType.EXACT },
                    children: [new TextRun({ text: block.words.join(gap), font: fontFamily, size: Math.round(s.fontSizePt * 2) })]
                  })
                ]
              })
            ]
          })
        ]
      }),
      new Paragraph({ spacing: { before: 0, after: 0, line: mmToTwips(3), lineRule: LineRuleType.EXACT }, children: [], ...unnumbered })
    ];
  },

  // The teacher's own questions: each question (kept with its lines), then
  // its ruled answer lines; a small paragraph at the end so Word doesn't
  // merge the last table with the copy lines that may follow.
  questions: (block, { model, fontFamily, contentWidthTwips, unnumbered }) => {
    const s = model.settings;
    const lineTwips = Math.round((s.lineHeightMultiplier ?? 1.5) * s.fontSizePt * TWIPS_PER_PT);
    return [
      ...block.items.flatMap((question, i) => [
        new Paragraph({
          keepNext: true,
          spacing: { before: i === 0 ? mmToTwips(4) : 0, after: mmToTwips(1), line: lineTwips, lineRule: LineRuleType.EXACT },
          children: [new TextRun({ text: `${i + 1}. ${question}`, font: fontFamily, size: Math.round(s.fontSizePt * 2) })],
          ...unnumbered
        }),
        ruledLines(block.linesEach, mmToTwips(s.guideHeightMm ?? 10), contentWidthTwips, true),
        new Paragraph({ spacing: { before: 0, after: 0, line: mmToTwips(3), lineRule: LineRuleType.EXACT }, children: [], ...unnumbered })
      ])
    ];
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
 * @param {{ nameLine: string, date: string, instruction?: (key: string) => string, answers?: string }} [labels] the sheet's words in its language (i18n.sheetLabels)
 * @returns {Promise<Blob>} browser- and Node-compatible; tests convert via .arrayBuffer()
 */
export async function exportDocx(model, layout, imageBytes, labels = DEFAULT_LABELS) {
  const s = model.settings;
  const fontFamily = FONT_FAMILIES[s.fontId] ?? s.fontId;
  const characterSpacingTwips = Math.round((s.letterSpacingPt ?? 0) * TWIPS_PER_PT);
  const wordSpacingTwips = Math.round((s.extraWordSpacePt ?? 0) * TWIPS_PER_PT);
  const contentWidthTwips = mmToTwips(contentWidthMm(s.marginMm));

  /** @type {(Paragraph | Table)[]} */
  const children = [];

  // The tint, only when it prints: as paragraph shading, because Word's page
  // colour is often left out of the print.
  const tintHex = s.tintId && s.tintId !== 'none' ? TINTS_BY_ID[s.tintId] : undefined;
  const shading = s.printTint && tintHex ? { type: ShadingType.CLEAR, fill: tintHex.replace('#', '') } : undefined;

  const lineNumbers = model.blocks.some((block) => block.type === 'passage' && block.lineNumbers);
  const unnumbered = lineNumbers ? { suppressLineNumbers: /** @type {true} */ (true) } : {};

  /** @type {BlockWriteContext} */
  const context = { model, labels, imageBytes, fontFamily, shading, characterSpacingTwips, wordSpacingTwips, contentWidthTwips, unnumbered };
  for (const block of model.blocks) {
    const write = BLOCK_WRITERS[block.type];
    if (!write) throw new Error(`UNKNOWN_BLOCK: "${block.type}"`);
    children.push(...write(block, context));
  }

  // The copy lines: a table, one exact-height row per line, because a row's
  // height is the one height Word and LibreOffice both keep (paragraph
  // spacing on empty paragraphs collapsed). Only the bottom line of the
  // preview's three-line ruling. A second copy block starts on a new page,
  // as the fit check decided.
  if (model.task === 'lines' && layout?.copyBlocks?.length > 0) {
    const rowHeightTwips = mmToTwips(s.guideHeightMm ?? 10);
    layout.copyBlocks.forEach((rowCount, blockIndex) => {
      if (blockIndex > 0) {
        children.push(new Paragraph({ children: [], pageBreakBefore: true, ...unnumbered }));
      }
      children.push(ruledLines(rowCount, rowHeightTwips, contentWidthTwips));
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
