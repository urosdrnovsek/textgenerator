#!/usr/bin/env node
/**
 * Phase 7 release qualification: real Firefox compatibility check.
 *
 * Firefox does not speak Chrome DevTools Protocol (used by
 * verify-docx-libreoffice.mjs / verify-offline.mjs) — it speaks WebDriver
 * BiDi. `selenium-webdriver` + `geckodriver` (a system package, not
 * bundled — `sudo pacman -S geckodriver` on this Arch-based environment)
 * give a stable client for it instead of hand-rolling the BiDi WebSocket
 * protocol.
 *
 * Exercises the real built release the way a teacher would — every
 * bundled language, the dyslexia-friendly preset, saving a setup,
 * and both exports — then specifically verifies the
 * single highest cross-browser risk called out in docs/compatibility.md:
 * packet multi-page printing. `break-after: page` handling has
 * historically differed between browser print engines, so this doesn't
 * just click the button and hope — it uses WebDriver's real `printPage()`
 * command (Firefox's actual print/PDF engine, not a re-implementation) to
 * render the packet and checks the resulting PDF's page count with
 * `pdfinfo`, the same way verify-docx-libreoffice.mjs checks LibreOffice's
 * output.
 *
 * Network is hard-blocked via an unreachable proxy (not DNS-NOTFOUND —
 * Firefox has no exact equivalent of Chromium's --host-resolver-rules,
 * so any attempted request fails at connection time instead of at DNS
 * resolution time; same effect, different mechanism) with a fresh
 * profile, satisfying the same "fresh-machine offline" bar as
 * verify-offline.mjs.
 *
 * HISTORY WORTH KNOWING: from Phase 7 until 2026-09-20 this script carried
 * an "informational" section that reproduced what was documented as a
 * Firefox/Gecko print-engine bug (a 2-sheet packet printing as 5 pages
 * after unrelated settings changes). It was a bug in this script:
 * checkPacketPageCount() replaced #print-surface.replaceChildren with a
 * once-only wrapper and never restored it, so its second use in the same
 * page wrapped the already-spent wrapper and the second packet was never
 * written to the print surface at all — Firefox faithfully printed the
 * stale first packet. Restoring the method between calls (below) made
 * the "bug" vanish with no app change. That section is now a real,
 * failing check, and doubles as the regression test for a genuine app
 * bug fixed the same day (packet snapshots sharing the live settings
 * object — see src/worksheet/build.js). Lesson: a "known browser issue"
 * must be reproducible in a standalone page with no app code before it
 * is documented as one.
 *
 * Developer/QA tool, not part of `npm test`. Run with `npm run verify-firefox`.
 * Takes --unzip <path-to-zip> to test the actual packaged deliverable
 * (extracted outside the repo) instead of the repo's own release/.
 */

import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function resolveIndexPath() {
  const unzipArgIndex = process.argv.indexOf('--unzip');
  if (unzipArgIndex === -1) {
    console.log('No --unzip <path-to-zip> given — testing repo release/ directly.');
    return path.join(root, 'release/index.html');
  }
  const zipPath = process.argv[unzipArgIndex + 1];
  if (!zipPath) throw new Error('--unzip requires a path to a .zip file');
  const stageDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-ff-extract-'));
  console.log(`Extracting ${zipPath} to ${stageDir} (outside the repo, simulating a fresh machine)...`);
  execFileSync('unzip', ['-q', zipPath, '-d', stageDir]);
  const entries = await readdir(stageDir);
  return path.join(stageDir, entries[0], 'index.html');
}

/**
 * Freezes #print-surface right after the packet's pages are rendered
 * (swallowing main.js's post-print restore call, since there's no async
 * gap between the two synchronous replaceChildren() calls to intercept
 * any other way), prints via the real WebDriver printPage() command, and
 * returns the expected vs. actual counts for the caller to judge.
 *
 * Safe to call any number of times in the same page: the once-only
 * wrapper is installed as an own property over the prototype method and
 * deleted again afterwards. The earlier version bound and kept the
 * previous wrapper forever, which is how a second call silently printed
 * the first call's packet (see the header comment).
 *
 * Expected counts come from #packet-count's data attributes, which
 * main.js sets from the packet model — not from parsing its localized
 * label, whose first number is the sheet count, not the page count.
 */
async function checkPacketPageCount(driver, evalJs, downloadDir, label) {
  const expectedSheets = Number(await evalJs(`return document.getElementById('packet-count').dataset.sheetCount`));
  const expectedPages = Number(await evalJs(`return document.getElementById('packet-count').dataset.totalPages`));
  await evalJs(`
    const surface = document.getElementById('print-surface');
    const original = Object.getPrototypeOf(surface).replaceChildren;
    let calls = 0;
    surface.replaceChildren = function(...args) {
      calls++;
      if (calls === 1) original.apply(surface, args);
    };
  `);
  await evalJs(`document.getElementById('btn-print-packet').click();`);
  await driver.sleep(200);
  const frozenSheetCount = await evalJs(`return document.querySelectorAll('#print-surface .ws-page').length`);
  const frozenFontSizes = await evalJs(
    `return [...document.querySelectorAll('#print-surface .ws-page')].map((p) => p.style.getPropertyValue('--ws-font-size-pt'))`
  );

  const pdfBase64 = await driver.printPage();
  const pdfPath = path.join(downloadDir, `packet-${label}.pdf`);
  await writeFile(pdfPath, Buffer.from(pdfBase64, 'base64'));
  const actualPages = Number((execFileSync('pdfinfo', [pdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
  const text = execFileSync('pdftotext', [pdfPath, '-']).toString();

  // Restore the real method so the next call starts from a clean state.
  await evalJs(`delete document.getElementById('print-surface').replaceChildren;`);

  return { expectedSheets, expectedPages, frozenSheetCount, frozenFontSizes, actualPages, hasText: text.trim().length > 0 };
}

async function main() {
  const indexPath = await resolveIndexPath();
  const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-ff-downloads-'));

  const options = new firefox.Options();
  options.addArguments('-headless');
  // Selenium finds `firefox` on PATH by default; FIREFOX_BIN points it at a
  // specific build (CI's setup-firefox output) — workstream F4.
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  // Hard-block network egress: point at an unreachable local port rather
  // than relying on this dev machine happening to be offline. file:// URLs
  // are never proxied, so local navigation is unaffected.
  options.setPreference('network.proxy.type', 1);
  options.setPreference('network.proxy.http', '127.0.0.1');
  options.setPreference('network.proxy.http_port', 1);
  options.setPreference('network.proxy.ssl', '127.0.0.1');
  options.setPreference('network.proxy.ssl_port', 1);
  options.setPreference('network.proxy.no_proxies_on', '');
  // Auto-save downloads (no "Save As" dialog) so the .docx export can
  // actually be verified, the same way the Chromium scripts verify it.
  options.setPreference('browser.download.folderList', 2);
  options.setPreference('browser.download.dir', downloadDir);
  options.setPreference('browser.download.useDownloadDir', true);
  options.setPreference(
    'browser.helperApps.neverAsk.saveToDisk',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  // geckodriver gives each session a fresh temporary profile by default
  // (no --profile passed) — satisfies the "fresh profile" bar without
  // needing to manage one ourselves.
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();

  let failures = 0;
  function check(label, cond) {
    console.log(cond ? 'PASS:' : 'FAIL:', label);
    if (!cond) failures++;
  }

  try {
    await driver.get(`file://${indexPath}`);
    await driver.sleep(500);

    // geckodriver doesn't support the classic WebDriver getLog endpoint
    // ("HTTP method not allowed" when tried against this version) — hook
    // console.error and uncaught errors from inside the page instead.
    await driver.executeScript(`
      window.__errors = [];
      const originalError = console.error;
      console.error = function(...args) { window.__errors.push(args.map(String).join(' ')); originalError.apply(console, args); };
      window.addEventListener('error', (e) => window.__errors.push('uncaught: ' + e.message));
      // Never let a real print dialog attempt to open in headless mode.
      window.print = () => { window.__printCalled = (window.__printCalled || 0) + 1; };
    `);

    async function evalJs(script) {
      return driver.executeScript(script);
    }
    async function waitForFit() {
      for (let i = 0; i < 20; i++) {
        await driver.sleep(250);
        const fitText = await evalJs(`return document.getElementById('fit-indicator')?.textContent || ''`);
        if (fitText && !/measuring|preverjanje|midiendo|wird geprüft|vérification/i.test(fitText)) return fitText;
      }
      throw new Error('fit check never settled');
    }

    // The page count the app reports, and its count without the fit
    // check's 4 mm safety margin (config.FIT_SAFETY_MM). The margin only
    // ever makes the app say one page MORE than a sheet prints — when its
    // content ends within 4 mm of a page end — and the owner keeps it
    // (2026-09-26). So a print agrees when it matches the report, or is one
    // page shorter AND matches the no-margin count; anything else is a
    // real mismatch.
    async function reportedPages() {
      return evalJs(`return (() => { const f = document.getElementById('fit-indicator'); return { pages: Number(f.dataset.pageCount), withoutMargin: Number(f.dataset.pageCountWithoutMargin) }; })()`);
    }
    const pagesAgree = (printed, reported) => printed === reported.pages || (printed === reported.pages - 1 && printed === reported.withoutMargin);
    const pagesNote = (printed, reported) => `${printed} printed, ${reported.pages} reported${printed === reported.pages ? '' : ` (${reported.withoutMargin} without the 4 mm margin)`}`;

    const title = await evalJs(`return document.title`);
    check('page loaded with a real title', typeof title === 'string' && title.length > 0);

    // Runs first, before any other interaction, so it reflects the clean
    // "create one worksheet, print it" case rather than inheriting render
    // history from everything else this script does afterward (see the
    // known-issue demonstration near the end of this script for why that
    // history matters in real Firefox).
    console.log('\nSingle-worksheet print check (real Firefox print engine via printPage())...');
    await evalJs(`document.getElementById('btn-print').click();`);
    await driver.sleep(200);
    const singlePdfBase64 = await driver.printPage();
    const singlePdfPath = path.join(downloadDir, 'single-worksheet.pdf');
    await writeFile(singlePdfPath, Buffer.from(singlePdfBase64, 'base64'));
    const singlePages = Number((execFileSync('pdfinfo', [singlePdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    check('single worksheet prints as exactly 1 page in real Firefox', singlePages === 1);

    console.log('\nMulti-page worksheet print check (upgrade blueprint v3, workstream A)...');
    await evalJs(`
      document.getElementById('theme-select').value = 'stories';
      document.getElementById('theme-select').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('level-select').value = '5';
      document.getElementById('level-select').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('btn-create').click();
      const fontSize = document.getElementById('font-size-input');
      fontSize.value = '32';
      fontSize.dispatchEvent(new Event('change', { bubbles: true }));
      const lineHeight = document.getElementById('line-height-input');
      lineHeight.value = '2.5';
      lineHeight.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await waitForFit();
    const expectedMultiPages = Number(await evalJs(`return document.getElementById('fit-indicator').dataset.pageCount`));
    check('max settings on a level-5 text report more than 1 page', expectedMultiPages > 1);
    const multiPdfBase64 = await driver.printPage();
    const multiPdfPath = path.join(downloadDir, 'multi-page-worksheet.pdf');
    await writeFile(multiPdfPath, Buffer.from(multiPdfBase64, 'base64'));
    const multiPages = Number((execFileSync('pdfinfo', [multiPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    check(`real Firefox print engine renders the multi-page worksheet as exactly ${expectedMultiPages} pages (got ${multiPages})`, multiPages === expectedMultiPages);
    const multiText = execFileSync('pdftotext', [multiPdfPath, '-']).toString();
    check('multi-page worksheet PDF has non-empty extracted text', multiText.trim().length > 0);

    // Line numbers (B9) on the same multi-page sheet: the gutter strip of
    // the real print (x from the 20 mm margin, 8 mm wide, in PDF points)
    // holds the numbers, which must run 1…N across the pages
    // with N the count the preview drew from Firefox's own line boxes.
    console.log('\nLine numbers across pages in the real Firefox print...');
    await evalJs(`document.getElementById('line-numbers-toggle').click();`);
    await waitForFit();
    const numberedPages = await reportedPages();
    const previewNumbers = await evalJs(`return [...document.querySelectorAll('#preview .ws-line-number')].map((n) => n.textContent)`);
    const numberedPdfPath = path.join(downloadDir, 'line-numbers-worksheet.pdf');
    await writeFile(numberedPdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const printedPages = Number((execFileSync('pdfinfo', [numberedPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    check(`line-numbered worksheet page count agrees (${pagesNote(printedPages, numberedPages)})`, pagesAgree(printedPages, numberedPages));
    const marginPt = (20 / 25.4) * 72;
    const gutterText = execFileSync('pdftotext', ['-x', String(Math.floor(marginPt)), '-y', '0', '-W', String(Math.ceil((8 / 25.4) * 72)), '-H', '842', numberedPdfPath, '-']).toString();
    // The header and title also start at the margin edge, so the strip
    // holds their first characters too; keep the numeric tokens.
    const printedNumbers = gutterText.split(/\s+/).filter((token) => /^\d+$/.test(token));
    check(
      `printed line numbers run 1…${previewNumbers.length} across pages, as in the preview (printed ${printedNumbers.length})`,
      previewNumbers.length > 0 && previewNumbers.every((n, i) => n === String(i + 1)) && JSON.stringify(printedNumbers) === JSON.stringify(previewNumbers)
    );
    await evalJs(`document.getElementById('line-numbers-toggle').click();`);
    await waitForFit();

    // Drawing box (A5) on the same multi-page sheet: an atomic 90 mm block
    // after the passage, then copy rows; Firefox must paginate it as the app does.
    console.log('\nDrawing box in the real Firefox print...');
    await evalJs(`const el = document.getElementById('image-slot-select'); el.value = 'drawing-box'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();
    const boxPages = await reportedPages();
    const boxPdfPath = path.join(downloadDir, 'drawing-box-worksheet.pdf');
    await writeFile(boxPdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const boxPrintedPages = Number((execFileSync('pdfinfo', [boxPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    check(`drawing-box worksheet page count agrees (${pagesNote(boxPrintedPages, boxPages)})`, pagesAgree(boxPrintedPages, boxPages));
    await evalJs(`const el = document.getElementById('image-slot-select'); el.value = 'picture'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();

    // Write about the picture (A4) on the same sheet: instruction line,
    // large picture, copy rows; the real print must match the app's count.
    console.log('\nWrite about the picture in the real Firefox print...');
    await evalJs(`const el = document.getElementById('writing-mode-select'); el.value = 'write-own'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();
    const ownPages = await reportedPages();
    const ownPdfPath = path.join(downloadDir, 'write-own-worksheet.pdf');
    await writeFile(ownPdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const ownPrintedPages = Number((execFileSync('pdfinfo', [ownPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    check(`write-about-the-picture worksheet page count agrees (${pagesNote(ownPrintedPages, ownPages)})`, pagesAgree(ownPrintedPages, ownPages));
    const ownInstruction = await evalJs(`return document.querySelector('#preview .ws-instruction')?.textContent ?? ''`);
    const ownText = execFileSync('pdftotext', [ownPdfPath, '-']).toString().replace(/\s+/g, '');
    check('its printed PDF carries the instruction line', ownInstruction.length > 0 && ownText.includes(ownInstruction.replace(/\s+/g, '')));
    await evalJs(`const el = document.getElementById('writing-mode-select'); el.value = 'read-copy'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();

    // Highlighted letter groups (B6): bold highlights rewrap the passage;
    // Firefox must still paginate it as the app measured.
    console.log('\nHighlighted letter groups in the real Firefox print...');
    await evalJs(`const el = document.getElementById('graphemes-input'); el.value = 'a, e, i, o'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();
    const groupPages = await reportedPages();
    const groupBold = Number(await evalJs(`return [...document.querySelectorAll('#preview .ws-sentence span')].filter((s) => s.style.fontWeight === '700').length`));
    const groupPdfPath = path.join(downloadDir, 'letter-groups-worksheet.pdf');
    await writeFile(groupPdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const groupPrintedPages = Number((execFileSync('pdfinfo', [groupPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    check(`letter-group worksheet (${groupBold} bold runs) page count agrees (${pagesNote(groupPrintedPages, groupPages)})`, groupBold > 0 && pagesAgree(groupPrintedPages, groupPages));
    await evalJs(`const el = document.getElementById('graphemes-input'); el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();

    // Visible word spaces (B10): the marks widen every gap and rewrap the
    // passage; Firefox must still paginate it as the app measured.
    console.log('\nVisible word spaces in the real Firefox print...');
    await evalJs(`document.getElementById('word-space-marks-toggle').click();`);
    await waitForFit();
    const markPages = await reportedPages();
    const markPdfPath = path.join(downloadDir, 'word-space-marks-worksheet.pdf');
    await writeFile(markPdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const markPrintedPages = Number((execFileSync('pdfinfo', [markPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    const markUnderscores = (execFileSync('pdftotext', [markPdfPath, '-']).toString().match(/_/g) ?? []).length;
    check(`word-space-mark worksheet page count agrees (${pagesNote(markPrintedPages, markPages)}), with the marks printed (${markUnderscores} "_")`, pagesAgree(markPrintedPages, markPages) && markUnderscores > 20);
    await evalJs(`document.getElementById('word-space-marks-toggle').click();`);
    await waitForFit();

    // Gap-fill (A1) on the same sheet: gaps print as empty boxes of the
    // measured size — the passage without its answers is in the PDF, the
    // passage with them is not — and the page count still matches.
    console.log('\nGap-fill in the real Firefox print...');
    await evalJs(`const el = document.getElementById('writing-mode-select'); el.value = 'cloze'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();
    await evalJs(`document.getElementById('cloze-every-nth-input').value = '4'; document.getElementById('btn-cloze-every-nth').click();`);
    await driver.sleep(500);
    await waitForFit();
    const clozePages = await reportedPages();
    const clozeTexts = await evalJs(`return [...document.querySelectorAll('#preview .ws-sentence')].map((p) => {
      const copy = p.cloneNode(true);
      const full = copy.textContent;
      copy.querySelectorAll('.ws-blank-answer').forEach((a) => a.remove());
      return { full, gapped: copy.textContent, gaps: p.querySelectorAll('.ws-blank').length };
    })`);
    const clozePdfPath = path.join(downloadDir, 'cloze-worksheet.pdf');
    await writeFile(clozePdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const clozePrintedPages = Number((execFileSync('pdfinfo', [clozePdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    const squash = (text) => text.normalize('NFC').replace(/\s+/g, '');
    // -layout: wide empty gaps make pdftotext's default reading order interleave lines.
    const clozePdf = squash(execFileSync('pdftotext', ['-layout', clozePdfPath, '-']).toString());
    const gapCount = clozeTexts.reduce((n, p) => n + p.gaps, 0);
    check(`gap-fill worksheet (${gapCount} gaps) page count agrees (${pagesNote(clozePrintedPages, clozePages)})`, gapCount > 0 && pagesAgree(clozePrintedPages, clozePages));
    check('the printed gap-fill has the passage without its answers, and not the answers',
      clozeTexts.every((p) => clozePdf.includes(squash(p.gapped))) && clozeTexts.filter((p) => p.gaps > 0).every((p) => !clozePdf.includes(squash(p.full))));
    // The answer key (U3b): the same sheet with "Show the answers" prints
    // the passage with its answers and the "Answers" tag.
    await evalJs(`document.getElementById('show-answers-toggle').click();`);
    await driver.sleep(500);
    await waitForFit();
    const keyPages = await reportedPages();
    const keyTag = await evalJs(`return document.querySelector('#preview .ws-answer-tag')?.textContent ?? ''`);
    const keyPdfPath = path.join(downloadDir, 'answer-key-worksheet.pdf');
    await writeFile(keyPdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const keyPrintedPages = Number((execFileSync('pdfinfo', [keyPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    const keyPdf = squash(execFileSync('pdftotext', ['-layout', keyPdfPath, '-']).toString());
    check(`answer key page count agrees (${pagesNote(keyPrintedPages, keyPages)}), with the "${keyTag}" tag and every answer`,
      pagesAgree(keyPrintedPages, keyPages) && keyTag !== '' && keyPdf.toLowerCase().includes(squash(keyTag).toLowerCase()) && clozeTexts.every((p) => keyPdf.includes(squash(p.full))));
    await evalJs(`const el = document.getElementById('writing-mode-select'); el.value = 'read-copy'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();

    // Copy target (A3) on the same sheet: the marks are overlays, so the
    // print must still paginate as the app measured.
    console.log('\nCopy target marks in the real Firefox print...');
    await evalJs(`const el = document.getElementById('copy-target-select'); el.value = 'first-sentences'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();
    const copyPages = await reportedPages();
    const copyBars = Number(await evalJs(`return document.querySelectorAll('#print-surface .ws-copy-mark-bar').length`));
    const copyPdfPath = path.join(downloadDir, 'copy-target-worksheet.pdf');
    await writeFile(copyPdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const copyPrintedPages = Number((execFileSync('pdfinfo', [copyPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    check(`copy-target worksheet (${copyBars} marked lines) page count agrees (${pagesNote(copyPrintedPages, copyPages)})`, copyBars > 0 && pagesAgree(copyPrintedPages, copyPages));
    await evalJs(`const el = document.getElementById('copy-target-select'); el.value = 'passage'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();

    // "Put in order" (A2) on the same sheet: the items don't split across
    // pages, and the print must paginate as the app measured, with every
    // sentence item in the PDF.
    console.log('\n"Put in order" in the real Firefox print...');
    await evalJs(`const el = document.getElementById('writing-mode-select'); el.value = 'sequence'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();
    const seqPages = await reportedPages();
    const seqItems = await evalJs(`return [...document.querySelectorAll('#preview .ws-sequence-text')].map((p) => p.textContent)`);
    const seqPdfPath = path.join(downloadDir, 'sequence-worksheet.pdf');
    await writeFile(seqPdfPath, Buffer.from(await driver.printPage(), 'base64'));
    const seqPrintedPages = Number((execFileSync('pdfinfo', [seqPdfPath]).toString().match(/^Pages:\s+(\d+)/m) || [])[1]);
    const seqPdf = squash(execFileSync('pdftotext', ['-layout', seqPdfPath, '-']).toString());
    check(`"Put in order" worksheet (${seqItems.length} items) page count agrees (${pagesNote(seqPrintedPages, seqPages)}), every item printed`,
      seqItems.length >= 3 && pagesAgree(seqPrintedPages, seqPages) && seqItems.every((item) => seqPdf.includes(squash(item))));
    await evalJs(`const el = document.getElementById('writing-mode-select'); el.value = 'read-copy'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitForFit();

    // Reset back to defaults — the language loop below checks for the
    // localized "fits" wording specifically, which these settings would
    // break for languages whose content doesn't also extend at max size.
    await evalJs(`
      document.getElementById('level-select').value = '1';
      document.getElementById('level-select').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('btn-create').click();
      const fontSize = document.getElementById('font-size-input');
      fontSize.value = '16';
      fontSize.dispatchEvent(new Event('change', { bubbles: true }));
      const lineHeight = document.getElementById('line-height-input');
      lineHeight.value = '1.4';
      lineHeight.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await waitForFit();

    console.log('\nExercising all 5 languages...');
    for (const language of ['sl', 'en', 'de', 'fr', 'es']) {
      await evalJs(`
        document.getElementById('language-select').value = '${language}';
        document.getElementById('language-select').dispatchEvent(new Event('change', { bubbles: true }));
      `);
      const fitText = await waitForFit();
      check(`${language}: worksheet renders and fits`, /^(Ustreza|Fits|Cabe|Passt|Tient)/i.test(fitText));
      await evalJs(`document.getElementById('btn-add-to-packet').click();`);
    }

    console.log('\nPacket multi-page print check (the documented workflow: build, then print immediately)...');
    const primaryResult = await checkPacketPageCount(driver, evalJs, downloadDir, 'primary-flow');
    check(
      `#print-surface holds all ${primaryResult.expectedSheets} packet sheets right after printing`,
      primaryResult.frozenSheetCount === primaryResult.expectedSheets
    );
    check(
      `real Firefox print engine renders the packet as exactly ${primaryResult.expectedPages} pages (got ${primaryResult.actualPages})`,
      primaryResult.actualPages === primaryResult.expectedPages
    );
    check('packet PDF has non-empty extracted text', primaryResult.hasText);

    console.log('\nExercising dyslexia preset + saving a setup...');
    await evalJs(`
      document.getElementById('language-select').value = 'sl';
      document.getElementById('language-select').dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await waitForFit();
    await evalJs(`
      document.getElementById('btn-dyslexia-preset').click();
      window.prompt = () => 'firefox-test-preset';
      document.getElementById('btn-save-preset').click();
    `);
    await driver.sleep(200);
    const presetNames = await evalJs(`return Array.from(document.getElementById('preset-select').options).map(o => o.textContent)`);
    check('dyslexia preset applied and a new setup was saved', presetNames.includes('firefox-test-preset'));

    console.log('\n.docx export check (real download via Firefox)...');
    const docxReady = await evalJs(`return !document.getElementById('btn-docx').disabled`);
    if (docxReady) {
      await evalJs(`document.getElementById('btn-docx').click();`);
      let docxFile = null;
      for (let i = 0; i < 30; i++) {
        await driver.sleep(300);
        const files = await readdir(downloadDir);
        const found = files.find((f) => f.endsWith('.docx') && !f.endsWith('.part'));
        if (found) {
          docxFile = found;
          break;
        }
      }
      check('.docx export downloaded a real file', Boolean(docxFile));
      if (docxFile) {
        const buffer = await readFile(path.join(downloadDir, docxFile));
        check('.docx file starts with the zip/OOXML signature (PK)', buffer.subarray(0, 2).toString('hex') === '504b');
      }
    } else {
      check('.docx export button was ready to click', false);
    }

    console.log('\nSettings changed after building a packet must not affect the packet...');
    // Regression check for the packet-snapshot aliasing bug fixed in
    // src/worksheet/build.js (the model used to share main.js's live
    // settings object, so every sheet followed later changes at print
    // time). Build a 2-sheet packet, then push the *current* worksheet to
    // the maximum font size and line height: the frozen packet sheets must
    // still carry the size they were added at, and print as exactly the
    // page count they were added with.
    await evalJs(`
      document.getElementById('theme-select').value = 'stories';
      document.getElementById('theme-select').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('btn-create').click();
    `);
    await waitForFit();
    await evalJs(`document.getElementById('btn-clear-packet').click();`);
    for (const theme of ['stories', 'animal_facts']) {
      await evalJs(`
        document.getElementById('theme-select').value = '${theme}';
        document.getElementById('theme-select').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('btn-create').click();
      `);
      await waitForFit();
      await evalJs(`document.getElementById('btn-add-to-packet').click();`);
    }
    const fontSizeAtAdd = await evalJs(`return document.querySelector('#preview .ws-page').style.getPropertyValue('--ws-font-size-pt')`);
    await evalJs(`
      document.getElementById('font-size-input').value = '32';
      document.getElementById('font-size-input').dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await waitForFit();
    await evalJs(`
      document.getElementById('line-height-input').value = '2.5';
      document.getElementById('line-height-input').dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await waitForFit();
    const snapshotResult = await checkPacketPageCount(driver, evalJs, downloadDir, 'settings-changed-after-add');
    check(
      `packet sheets still render at the font size they were added with (${fontSizeAtAdd}pt, current worksheet is now 32pt)`,
      snapshotResult.frozenSheetCount === snapshotResult.expectedSheets &&
        snapshotResult.frozenFontSizes.every((size) => size === fontSizeAtAdd)
    );
    check(
      `real Firefox print engine renders the packet as exactly ${snapshotResult.expectedPages} pages after the settings change (got ${snapshotResult.actualPages})`,
      snapshotResult.actualPages === snapshotResult.expectedPages
    );

    const errors = await evalJs(`return window.__errors`);
    check('zero console errors/exceptions across the whole journey', Array.isArray(errors) && errors.length === 0);
    if (errors && errors.length > 0) for (const e of errors) console.log('  console error:', e);
  } finally {
    await driver.quit();
    await rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(failures === 0 ? '\nAll Firefox compatibility checks passed.' : `\n${failures} Firefox compatibility check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
