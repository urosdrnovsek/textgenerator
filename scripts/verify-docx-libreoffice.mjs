#!/usr/bin/env node
/**
 * The Word check, in real LibreOffice: the app (release/, driven in
 * Chromium as a teacher would) exports each case in CASES; LibreOffice
 * converts each file to PDF; and the PDF must have the page count the app
 * reported and contain the title, instruction and passage the preview
 * showed. The Word file is exported by the app itself, never built here:
 * the copy lines' count comes from the app's own fit check.
 *
 * LibreOffice gets the bundled fonts through a private fontconfig file.
 * Without them it substitutes a font, and that hid a line-spacing bug
 * once. The script prints what each font resolves to.
 *
 * Needs `soffice` and poppler (pdfinfo, pdftotext), and a build. Run with
 * `npm run verify-docx`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MARGIN_MM, MM_PER_INCH } from '../src/config.js';
import { launchChromium, pageScripts, wait } from './lib/chromium.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Representative pairwise combinations + boundary cases (blueprint 12),
 * not an exhaustive permutation: every language once, every font once,
 * every writing mode once, the near-max-content level-5 boundary case
 * (twice — once per script author's higher-risk languages), tint,
 * and sentence-per-line each exercised at least once.
 */
// entryId pins the text when a theme/level cell holds more than one (the
// English pack has three or four per cell, French, German and Spanish two, Slovene three since 2026-09-21). Without it a
// case gets the cell's first text in pack order — "Create text" is
// deterministic (catalog.js chooseEntry) — which is fine for a case that
// only needs *a* worksheet, but a boundary case that exists because of one
// specific text must say which one.
const CASES = [
  { label: 'sl-andika-level1-readcopy-colors', language: 'sl', theme: 'stories', level: 1, entryId: 'stories_muc_1', fontId: 'andika', writingMode: 'read-copy', letterColors: true, syllableColors: true },
  { label: 'sl-andika-level5-readcopy-stress', language: 'sl', theme: 'stories', level: 5, entryId: 'stories_muc_5', fontId: 'andika', writingMode: 'read-copy' },
  { label: 'en-lexend-level3-trace', language: 'en', theme: 'stories', level: 3, entryId: 'stories_piscancek_3', fontId: 'lexend', writingMode: 'trace' },
  { label: 'de-opendyslexic-level3-readonly-tint', language: 'de', theme: 'stories', level: 3, entryId: 'stories_wollmuetze_3', fontId: 'opendyslexic', writingMode: 'read-only', tintId: 'cream', printTint: true },
  { label: 'fr-comicneue-level3-readcopy-sentenceperline', language: 'fr', theme: 'stories', level: 3, entryId: 'stories_velo_bleu_3', fontId: 'comicneue', writingMode: 'read-copy', sentencePerLine: true },
  { label: 'es-andika-level5-readcopy-stress', language: 'es', theme: 'stories', level: 5, entryId: 'stories_cometa_verde_5', fontId: 'andika', writingMode: 'read-copy' },
  // Regression coverage for a real bug: every DE/FR level-5 entry used to
  // overflow the page under default settings (fixed by trimming the
  // content — see the content-review commit history). Both fit now, but
  // stay right at the edge of the budget, so keep them as permanent
  // boundary cases rather than trusting they'll never regress silently.
  { label: 'de-andika-level5-readcopy-stress', language: 'de', theme: 'amazing_science', level: 5, entryId: 'amazing_science_pendel_5', fontId: 'andika', writingMode: 'read-copy' },
  { label: 'fr-andika-level5-readcopy-stress', language: 'fr', theme: 'nature_seasons', level: 5, entryId: 'nature_seasons_bourgeon_printemps_5', fontId: 'andika', writingMode: 'read-copy' },
  // Word spacing (extraWordSpacePt) is now exported to DOCX (workstream
  // D3) — this exercises the full path at the maximum setting. pdftotext
  // can't see character spacing (it's a rendering-only visual effect), so
  // this only proves the file still exports/converts/paginates correctly
  // at a nonzero wordSpacingPt; the actual per-space characterSpacing
  // value is asserted directly against the generated XML in
  // tests/unit/docx-export.test.js.
  // level 1, not 3 — must not collide with 'en-lexend-level3-trace' above:
  // the download filename is worksheet-<language>-level-<level>.docx with
  // no label in it, and Chrome's headless auto-download silently overwrites
  // same-named files rather than uniquifying them, so two 'en'+level-3
  // cases would leave only one actually verified.
  { label: 'en-andika-level1-readonly-wordspacing', language: 'en', theme: 'stories', level: 1, entryId: 'stories_kite_in_tree_1', fontId: 'andika', writingMode: 'read-only', wordSpacingPt: 6 },
  // Multi-page DOCX cases (upgrade blueprint v3, workstream A.9) — the
  // app now allows a worksheet to extend past one page instead of
  // blocking it; this proves Word/LibreOffice pagination actually agrees
  // with the app's own reported page count for a genuinely multi-page
  // export, not just that a 1-page export still converts. 'en'+level-5
  // and 'de'+level-4 are both otherwise-unused language+level pairs (see
  // the filename-collision note above).
  // The 'en' level-5 case used to carry toleratedPageDelta: 1 (LibreOffice
  // produced 3 pages where the app said 2), documented at the time as a
  // "cross-application pagination difference, not an app bug". It was an
  // app bug: DOCX body line spacing used Word's "auto" rule (a multiple of
  // the font's own line height) instead of an exact multiple of the font
  // size like the preview's CSS. With the EXACT rule (0.8.1, F4) this case
  // is 2 pages with the real Andika and with a substitute font alike, so
  // the tolerance is gone. toleratedPageDelta itself stays supported for
  // a future case that genuinely needs it.
  { label: 'en-andika-level5-readcopy-multipage', language: 'en', theme: 'stories', level: 5, entryId: 'stories_svetilnik_5', fontId: 'andika', writingMode: 'read-copy', fontSizePt: 24 },
  { label: 'de-andika-level4-readonly-multipage', language: 'de', theme: 'stories', level: 4, fontId: 'andika', writingMode: 'read-only', fontSizePt: 20, lineHeightMultiplier: 2.0 },
  // Line numbers (B9): Word's own numbering, continuous across a page
  // break, with the header/title/picture and the copy-row table left
  // unnumbered. 'sl'+level-4 is an otherwise-unused pair.
  { label: 'sl-andika-level4-readcopy-linenumbers-multipage', language: 'sl', theme: 'stories', level: 4, entryId: 'stories_piscancek_4', fontId: 'andika', writingMode: 'read-copy', fontSizePt: 28, lineHeightMultiplier: 2.0, lineNumbers: true },
  // Drawing box (A5): the 90 mm box after the passage, then the copy rows
  // in what remains, at a size that leaves only a little room for them.
  // 'es'+level-2 is an otherwise-unused pair.
  // Write about the picture (A4): the instruction line and the large
  // picture, no passage, copy rows after. 'de'+level-2 is otherwise unused.
  { label: 'de-andika-level2-writeown', language: 'de', theme: 'stories', level: 2, entryId: 'stories_leuchtturmfenster_2', fontId: 'andika', writingMode: 'write-own' },
  // Highlighted letter groups (B6): bold, so wider than regular text; the
  // page count and the full passage must still hold. 'fr'+level-4 is an
  // otherwise-unused pair.
  { label: 'fr-andika-level4-readcopy-lettergroups', language: 'fr', theme: 'stories', level: 4, entryId: 'stories_clef_minuscule_4', fontId: 'andika', writingMode: 'read-copy', graphemes: 'ou, on, eau' },
  // Visible word spaces (B10) in trace mode: the "_" marks widen every
  // gap, so the page count and the full passage (marks included) must
  // hold. 'en'+level-4 is an otherwise-unused pair.
  { label: 'en-andika-level4-trace-wordspacemarks', language: 'en', theme: 'stories', level: 4, entryId: 'stories_treehouse_4', fontId: 'andika', writingMode: 'trace', wordSpaceMarks: true },
  // Gap-fill (A1): every 5th word after the first sentence is a gap, an
  // underlined run of no-break spaces in the Word file (an estimate of the
  // preview's fixed-width gap), so the page count must still match. The
  // hidden answers are left out of the text compared. 'sl'+level-3 is
  // otherwise unused.
  { label: 'sl-andika-level3-cloze', language: 'sl', theme: 'stories', level: 3, entryId: 'stories_polz_tito_3', fontId: 'andika', writingMode: 'cloze', clozeEveryNth: 5 },
  // The answer key (U3b): the same gap-fill with the answers shown — bold
  // in the middle of each underline — and the "Corrigé" tag. The PDF must
  // contain the passage with its answers. 'fr'+level-2 is otherwise unused.
  { label: 'fr-andika-level2-cloze-answerkey', language: 'fr', theme: 'stories', level: 2, entryId: 'stories_boite_a_musique_2', fontId: 'andika', writingMode: 'cloze', clozeEveryNth: 5, showAnswers: true },
  // Copy target (A3): the first two sentences, one per line, so each is a
  // whole paragraph and the Word file marks them with a left border. The
  // border must not change the page count. 'de'+level-1 is otherwise unused.
  { label: 'de-andika-level1-readcopy-copytarget', language: 'de', theme: 'stories', level: 1, entryId: 'stories_wollmuetze_1', fontId: 'andika', writingMode: 'read-copy', sentencePerLine: true, copyTarget: 'first-sentences' },
  // "Put in order" (A2): the shuffled sentences in a two-column table with
  // an exact square box per row; the key numbers the boxes. Every item
  // must be in the PDF and the page count must match. 'en'+level-2 and
  // 'es'+level-3 are otherwise unused.
  { label: 'en-andika-level2-sequence', language: 'en', theme: 'stories', level: 2, entryId: 'stories_blue_kite_2', fontId: 'andika', writingMode: 'sequence' },
  { label: 'es-andika-level3-sequence-answerkey', language: 'es', theme: 'stories', level: 3, entryId: 'stories_caracol_carrera_3', fontId: 'andika', writingMode: 'sequence', showAnswers: true },
  // "Continue the text" (story starter): the first two sentences, then
  // lines. 'sl'+level-2 is otherwise unused.
  { label: 'sl-andika-level2-starter', language: 'sl', theme: 'stories', level: 2, entryId: 'stories_piscancek_2', fontId: 'andika', writingMode: 'starter' },
  // The teacher's own questions: two, each with ruled answer lines, before
  // the copy lines. 'fr'+level-1 is otherwise unused.
  { label: 'fr-andika-level1-readcopy-questions', language: 'fr', theme: 'stories', level: 1, entryId: 'stories_boite_a_musique_1', fontId: 'andika', writingMode: 'read-copy', questions: ['Où est le chaton ?', 'Que fait la fille ?'] },
  // Gap-fill with the word bank: the missing words in a bordered box above
  // the text. 'es'+level-1 is otherwise unused.
  { label: 'es-andika-level1-cloze-wordbank', language: 'es', theme: 'stories', level: 1, entryId: 'stories_cometa_verde_1', fontId: 'andika', writingMode: 'cloze', clozeEveryNth: 4, wordBank: true },
  // The teacher's own text, without a picture (and so without an image in
  // the Word file): an original ~126-word Spanish text, which its length
  // places at level 4 — 'es'+level-4 is the last unused pair.
  { label: 'es-andika-level4-owntext-nopicture', language: 'es', theme: 'stories', level: 4, fontId: 'andika', writingMode: 'read-copy', ownText: { title: 'El mercado del sábado', body: "El sábado por la mañana, Lucía y su abuelo fueron al mercado del pueblo. Llevaban una cesta grande y una lista escrita con letra redonda. Primero compraron tomates rojos, pimientos verdes y una calabaza tan pesada que el abuelo tuvo que llevarla en brazos.\n\nDespués pasaron por el puesto de la señora Rosa, que vendía queso y miel. Rosa les dejó probar un poco de miel de romero, dulce y espesa, y Lucía sonrió con los ojos cerrados. Al final compraron un tarro pequeño para el desayuno.\n\nCuando volvieron a casa, prepararon juntos una sopa de verduras. Lucía lavó los tomates y el abuelo cortó la calabaza en trozos. Por la tarde, toda la familia se sentó a la mesa y la sopa se terminó enseguida.", picture: false } },
  { label: 'es-andika-level2-readcopy-drawingbox', language: 'es', theme: 'stories', level: 2, entryId: 'stories_huevo_blanco_2', fontId: 'andika', writingMode: 'read-copy', fontSizePt: 24, lineHeightMultiplier: 1.8, imageSlot: 'drawing-box' },
  // Romanian (2026-09-29): one case per level, each font Romanian is offered
  // in (Comic Neue isn't: it has no ș), so LibreOffice draws ă â î ș ț in
  // all three. Level 5 is the pack's longest text (1016 characters).
  { label: 'ro-andika-level1-readcopy-colors', language: 'ro', theme: 'stories', level: 1, entryId: 'stories_pisoiul_ud_1', fontId: 'andika', writingMode: 'read-copy', letterColors: true, syllableColors: true },
  { label: 'ro-lexend-level2-cloze-wordbank', language: 'ro', theme: 'animal_facts', level: 2, entryId: 'animal_facts_testoasa_2', fontId: 'lexend', writingMode: 'cloze', clozeEveryNth: 5, wordBank: true },
  { label: 'ro-opendyslexic-level3-sequence', language: 'ro', theme: 'stories', level: 3, entryId: 'stories_melcul_campion_3', fontId: 'opendyslexic', writingMode: 'sequence' },
  { label: 'ro-lexend-level4-starter', language: 'ro', theme: 'around_the_world', level: 4, entryId: 'around_the_world_dunarea_4', fontId: 'lexend', writingMode: 'starter' },
  { label: 'ro-andika-level5-readcopy-stress', language: 'ro', theme: 'nature_seasons', level: 5, entryId: 'nature_seasons_anotimpurile_5', fontId: 'andika', writingMode: 'read-copy' }
];

// The development machine's LibreOffice; CI sets SOFFICE_BIN (and
// CHROMIUM_BIN, read by lib/chromium.mjs).
const SOFFICE_BIN = process.env.SOFFICE_BIN ?? 'soffice';

/**
 * The controls a case sets after its text is shown, in order: every one,
 * back to its default when the case doesn't name it (the cases share one
 * app session), plus the three spacing boxes only when the case sets them.
 * @param {object} testCase an entry of CASES
 * @returns {Array<[string, string | number | boolean]>} [element id, value]
 */
function caseFields(testCase) {
  return [
    ['font-select', testCase.fontId],
    ['writing-mode-select', testCase.writingMode],
    ['letter-colors-toggle', Boolean(testCase.letterColors)],
    ['syllable-colors-toggle', Boolean(testCase.syllableColors)],
    ['sentence-per-line-toggle', Boolean(testCase.sentencePerLine)],
    ['tint-select', testCase.tintId ?? 'none'],
    ['print-tint-toggle', Boolean(testCase.printTint)],
    ['line-numbers-toggle', Boolean(testCase.lineNumbers)],
    ['copy-target-select', testCase.copyTarget ?? 'passage'],
    ['image-slot-select', testCase.imageSlot ?? 'picture'],
    ['word-space-marks-toggle', Boolean(testCase.wordSpaceMarks)],
    ['cloze-word-bank-toggle', Boolean(testCase.wordBank)],
    ['graphemes-input', testCase.graphemes ?? ''],
    ...(testCase.wordSpacingPt !== undefined ? [['word-spacing-input', testCase.wordSpacingPt]] : []),
    ...(testCase.fontSizePt !== undefined ? [['font-size-input', testCase.fontSizePt]] : []),
    ...(testCase.lineHeightMultiplier !== undefined ? [['line-height-input', testCase.lineHeightMultiplier]] : [])
  ];
}

async function main() {
  const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-lo-downloads-'));
  const indexPath = path.join(root, 'release/index.html');
  const browser = await launchChromium({ port: 9422, downloadDir });
  const { evalJs, waitForFit } = browser;

  const downloaded = [];
  try {
    await browser.open(indexPath);

    console.log(`Building and exporting ${CASES.length} representative worksheets through the real app...`);
    for (const testCase of CASES) {
      await evalJs(pageScripts.setField('language-select', testCase.language));
      await wait(150);
      await evalJs(`
        ${pageScripts.setField('theme-select', testCase.theme)};
        ${pageScripts.setField('level-select', testCase.level)};
        document.getElementById('btn-create').click();
        if (${JSON.stringify(testCase.entryId ?? null)}) {
          const picker = document.getElementById('text-select');
          if (picker.hidden || ![...picker.options].some((o) => o.value === ${JSON.stringify(testCase.entryId ?? null)})) {
            throw new Error('case ${testCase.label}: entry ${testCase.entryId} is not offered by the title picker');
          }
          ${pageScripts.setField('text-select', testCase.entryId ?? '')};
        }
        ${caseFields(testCase).map(([id, value]) => pageScripts.setField(id, value)).join(';\n')};
      `);
      if (testCase.clozeEveryNth) {
        // Gap-fill: the gaps are chosen after the text is on screen.
        await waitForFit();
        await evalJs(`(() => {
          document.getElementById('cloze-every-nth-input').value = '${testCase.clozeEveryNth}';
          document.getElementById('btn-cloze-every-nth').click();
        })();`);
        await wait(500); // the fit line still shows the pre-gap result until the new render settles
      }
      if (testCase.ownText) {
        // The teacher's own text: typed into the panel and added; the app
        // places it at the level its length gives and shows it.
        await waitForFit();
        await evalJs(`(() => {
          document.getElementById('own-title-input').value = ${JSON.stringify(testCase.ownText.title)};
          document.getElementById('own-body-input').value = ${JSON.stringify(testCase.ownText.body)};
          document.getElementById('own-picture-toggle').checked = ${Boolean(testCase.ownText.picture)};
          document.getElementById('btn-own-add').click();
        })();`);
        await wait(800);
      }
      if (testCase.questions) {
        // The teacher's own questions, typed into the sidebar boxes.
        await waitForFit();
        await evalJs(`(() => {
          const texts = ${JSON.stringify(testCase.questions)};
          document.querySelectorAll('.question-input').forEach((input, i) => { input.value = texts[i] ?? ''; input.dispatchEvent(new Event('change', { bubbles: true })); });
        })();`);
        await wait(500);
      }
      if (testCase.showAnswers) {
        // The answer key (gap-fill or "Put in order").
        await waitForFit();
        await evalJs(`document.getElementById('show-answers-toggle').click();`);
        await wait(500);
      }
      const fitText = await waitForFit();
      const docxReady = await evalJs(`!document.getElementById('btn-docx').disabled`);
      if (!docxReady) {
        downloaded.push({ testCase, ok: false, note: `not print-ready after settling: "${fitText}"` });
        continue;
      }
      // Read the app's own reported page count (upgrade blueprint v3,
      // workstream A.9) — the expectation each case's PDF is checked
      // against, instead of a hardcoded 1.
      const expectedPages = Number(await evalJs(`document.getElementById('fit-indicator').dataset.pageCount`));

      const completedBefore = browser.completedDownloads().length;
      // The rendered passage, captured from the real app before export, is
      // what the PDF is later checked against — "non-empty text" proved
      // nothing (a header line alone passed it).
      const renderedTitle = await evalJs(`document.querySelector('#preview .ws-title')?.textContent ?? ''`);
      // The text paragraphs only: overlays inside .ws-body (line numbers)
      // carry text of their own that isn't part of the passage.
      // Gap answers are hidden on paper (and absent from the Word file), so
      // they are left out of the text the PDF must contain — unless the
      // sheet is the answer key, which prints them.
      const renderedBody = await evalJs(`[...document.querySelectorAll('#preview .ws-body .ws-sentence')].map((p) => {
        const copy = p.cloneNode(true);
        if (!p.closest('.ws-body--answers')) copy.querySelectorAll('.ws-blank-answer').forEach((a) => a.remove());
        return copy.textContent;
      }).join('')`);
      const renderedTag = await evalJs(`document.querySelector('#preview .ws-answer-tag')?.textContent ?? ''`);
      // "Put in order": each sentence item, checked on its own (in the key,
      // the box numbers sit between them in the extracted text).
      const renderedItems = await evalJs(`[...document.querySelectorAll('#preview .ws-sequence-text, #preview .ws-question-text, #preview .ws-word-bank-word')].map((p) => p.textContent)`);
      const renderedInstruction = await evalJs(`document.querySelector('#preview .ws-instruction')?.textContent ?? ''`);
      const previewLineNumbers = await evalJs(`document.querySelectorAll('#preview .ws-line-number').length`);

      await evalJs(pageScripts.click('btn-docx'));
      const completed = await browser.waitForDownload(completedBefore);
      if (!completed) {
        downloaded.push({ testCase, ok: false, note: 'docx download never completed' });
        continue;
      }
      downloaded.push({ testCase, ok: true, guid: completed.guid, fitText, expectedPages, renderedTitle, renderedBody, renderedInstruction, renderedTag, renderedItems, previewLineNumbers });
    }
  } finally {
    await browser.close();
  }

  const filesInDownloadDir = await readdir(downloadDir);
  console.log(`Downloaded ${filesInDownloadDir.length} .docx file(s). Converting via real LibreOffice...`);

  let allOk = true;
  const okCases = downloaded.filter((d) => d.ok);
  for (const d of downloaded.filter((d) => !d.ok)) {
    // A case that never produced its file is a failure of the run, not a
    // footnote — until 2026-09-20 these were logged and then ignored, so a
    // disabled export button or a hung download could not fail this check.
    allOk = false;
    console.log(`  FAIL  ${d.testCase.label}  — export never happened: ${d.note}`);
  }

  // Each case downloads to worksheet-<language>-level-<level>.docx (never
  // the case label) — CASES must use a distinct language+level pair per
  // case, or Chromium's headless auto-download silently overwrites the
  // earlier file rather than uniquifying it (a real gotcha hit adding the
  // word-spacing case in 0.8; see docs/compatibility.md).
  const expectedPagesByFile = new Map(
    okCases.map((d) => [`worksheet-${d.testCase.language}-level-${d.testCase.level}.docx`, d])
  );

  // Every case in CASES must have produced its artifact — a shrunken
  // results table must never look like a pass.
  const expectedFiles = new Set(CASES.map((c) => `worksheet-${c.language}-level-${c.level}.docx`));
  const actualFiles = new Set(filesInDownloadDir.filter((f) => f.endsWith('.docx')));
  for (const f of expectedFiles) {
    if (!actualFiles.has(f)) {
      allOk = false;
      console.log(`  FAIL  ${f}  — expected artifact missing from the download directory`);
    }
  }
  for (const f of actualFiles) {
    if (!expectedFiles.has(f)) {
      allOk = false;
      console.log(`  FAIL  ${f}  — unexpected artifact (a case's filename doesn't match its language/level?)`);
    }
  }

  const docxPaths = filesInDownloadDir.filter((f) => f.endsWith('.docx')).map((f) => path.join(downloadDir, f));
  if (docxPaths.length > 0) {
    // A private fontconfig that adds assets/fonts on top of the system
    // configuration; LibreOffice (and fc-match, for the log) read it via
    // FONTCONFIG_FILE. Nothing is installed on the machine.
    const fontsConfPath = path.join(downloadDir, 'fonts.conf');
    await writeFile(
      fontsConfPath,
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${path.join(root, 'assets/fonts')}</dir>
  <cachedir>${path.join(downloadDir, 'fc-cache')}</cachedir>
</fontconfig>
`
    );
    const fontEnv = { ...process.env, FONTCONFIG_FILE: fontsConfPath };
    console.log(execFileSync(SOFFICE_BIN, ['--version'], { env: fontEnv }).toString().trim());
    for (const family of ['Andika', 'Lexend', 'OpenDyslexic', 'Comic Neue']) {
      let resolved = '(fc-match not available)';
      try {
        resolved = execFileSync('fc-match', [family], { env: fontEnv }).toString().trim();
      } catch {}
      console.log(`  font "${family}" -> ${resolved}`);
    }
    execFileSync(SOFFICE_BIN, ['--headless', '--convert-to', 'pdf', '--outdir', downloadDir, ...docxPaths], {
      stdio: 'pipe',
      timeout: 180_000,
      env: fontEnv
    });
  }

  // LibreOffice re-wraps lines and pdftotext inserts its own line breaks
  // and hyphen-less line joins, so the only stable comparison is
  // whitespace-insensitive: NFC-normalize, then strip every whitespace
  // character, and check the PDF *contains* the rendered title and body.
  // Hyphens go too: a line that breaks after a hyphen in the text
  // (Romanian "floarea-|soarelui", "s-|a") comes out of pdftotext joined
  // without it.
  const normalizeForCompare = (s) => s.normalize('NFC').replace(/[\s-]+/g, '');

  console.log('\nResults:');
  for (const docxPath of docxPaths) {
    const pdfPath = docxPath.replace(/\.docx$/, '.pdf');
    const label = path.basename(docxPath);
    const matched = expectedPagesByFile.get(label);
    const expectedPages = matched?.expectedPages ?? 1;
    const toleratedDelta = matched?.testCase.toleratedPageDelta ?? 0;
    try {
      const info = execFileSync('pdfinfo', [pdfPath]).toString();
      const pagesMatch = info.match(/^Pages:\s+(\d+)/m);
      const pages = pagesMatch ? Number(pagesMatch[1]) : null;
      // Word draws line numbers in the page margin, left of the text
      // column, and pdftotext mixes them into the text (sometimes mid-line).
      // For those cases, read only the column (x from the left margin, in
      // PDF points); the numbers are checked on their own below.
      const marginPt = Math.floor((DEFAULT_MARGIN_MM / MM_PER_INCH) * 72);
      const columnOnly = matched?.testCase.lineNumbers ? ['-x', String(marginPt), '-y', '0', '-W', String(595 - marginPt), '-H', '842'] : [];
      // Wide empty gaps (gap-fill) and the two-column "Put in order" table
      // (at large sizes) make pdftotext's reading-order guess split a line
      // into columns and interleave lines; -layout keeps line order.
      const keepLineOrder = matched?.testCase.clozeEveryNth || matched?.testCase.writingMode === 'sequence' ? ['-layout'] : [];
      const text = execFileSync('pdftotext', [...keepLineOrder, ...columnOnly, pdfPath, '-']).toString();
      const pdfNormalized = normalizeForCompare(text);
      const bodyOk = matched ? pdfNormalized.includes(normalizeForCompare(matched.renderedBody)) : false;
      const titleOk = matched ? pdfNormalized.includes(normalizeForCompare(matched.renderedTitle)) : false;
      // Empty for activities without an instruction line.
      const instructionOk = matched ? pdfNormalized.includes(normalizeForCompare(matched.renderedInstruction)) : false;
      // The answer key's tag (printed in capitals in Word, so compared case-insensitively).
      const tagOk = matched ? pdfNormalized.toLowerCase().includes(normalizeForCompare(matched.renderedTag).toLowerCase()) : false;
      const itemsOk = matched ? matched.renderedItems.every((item) => pdfNormalized.includes(normalizeForCompare(item))) : false;
      const pagesOk = pages !== null && Math.abs(pages - expectedPages) <= toleratedDelta;
      // Line numbers: in -layout text each numbered line starts with its
      // number, then a gap. They must run 1…K in order (one count across
      // pages, nothing outside the passage numbered), with K the number of
      // lines the preview numbered — the same wrap in both.
      let lineNumbersOk = true;
      let lineNumbersNote = '';
      if (matched?.testCase.lineNumbers) {
        const layoutText = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
        const numbers = [...layoutText.matchAll(/^\s*(\d+)\s{2,}\S/gm)].map((m) => Number(m[1]));
        const inOrder = numbers.every((n, i) => n === i + 1);
        lineNumbersOk = inOrder && numbers.length === matched.previewLineNumbers;
        lineNumbersNote = `  line numbers 1…${numbers.length}${inOrder ? '' : ' OUT OF ORDER'} (preview ${matched.previewLineNumbers})`;
      }
      const ok = pagesOk && bodyOk && titleOk && instructionOk && tagOk && itemsOk && lineNumbersOk;
      allOk = allOk && ok;
      const textNote = bodyOk && titleOk && instructionOk
        ? `${matched.renderedBody ? 'full passage' : 'no passage; title'}${matched.renderedInstruction ? ' and instruction' : ''}${matched.renderedItems.length ? `, ${matched.renderedItems.length} items (sentences or questions)` : ''}${matched.renderedTag ? ` and "${matched.renderedTag}" tag` : ''} present`
        : `text MISMATCH (title ${titleOk ? 'ok' : 'missing'}, body ${bodyOk ? 'ok' : 'incomplete'}, instruction ${instructionOk ? 'ok' : 'missing'}, tag ${tagOk ? 'ok' : 'missing'}, items ${itemsOk ? 'ok' : 'missing'})`;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  pages=${pages} (expected ${expectedPages}${toleratedDelta ? ` ±${toleratedDelta}` : ''})  ${textNote}${lineNumbersNote}`);
    } catch (error) {
      allOk = false;
      console.log(`  FAIL  ${label}  — conversion/inspection failed: ${error.message}`);
    }
  }

  await rm(downloadDir, { recursive: true, force: true });

  console.log(allOk ? '\nAll LibreOffice compatibility checks passed.' : '\nSome LibreOffice compatibility checks FAILED.');
  process.exitCode = allOk ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
