#!/usr/bin/env node
/**
 * Phase 7 release qualification: real LibreOffice compatibility check.
 *
 * Blueprint section 1 (risk B) and section 12 ("Office verification: actual
 * Word, LibreOffice, and OpenOffice import tests... XML inspection alone
 * cannot prove layout") are explicit that a browser fit-check does not run
 * Word/LibreOffice's own layout engine, and that this project's earlier
 * DOCX tests (tests/unit/docx-export.test.js) only unzip and inspect XML —
 * never actually proving an exported .docx renders as one page in a real
 * office application. This script closes that gap for LibreOffice
 * specifically (the office suite actually installed in this environment;
 * real Word/OpenOffice still need the user's own machine, tracked in
 * docs/compatibility.md).
 *
 * Deliberately drives the REAL built release (release/index.html) through
 * real headless Chromium exactly the way a teacher would — pick language/
 * theme/level, click Create text, adjust settings, click Export as Word —
 * rather than hand-building a WorksheetModel in Node. That matters
 * specifically for read-copy mode: the number of handwriting-line rows is
 * decided by layout/measure.js's real-DOM fit check, and guessing that
 * number here instead would silently test a different (and possibly
 * invalid) document than the one the app actually produces.
 *
 * For each downloaded .docx this converts to PDF with real headless
 * LibreOffice and checks the PDF has the page count the app itself
 * reported for that worksheet (1 for most cases; more for the multi-page
 * cases) and contains the complete rendered title and passage — not just
 * that no exception was thrown, and not just that *some* text came out.
 * A case whose export never happened fails the run, and every case in
 * CASES must produce its file.
 *
 * LibreOffice is run with the project's bundled fonts (assets/fonts) made
 * visible through a private fontconfig file, so the conversion uses the
 * real Andika/Lexend/OpenDyslexic/Comic Neue — what a school machine that
 * installed them would use — rather than whatever the machine substitutes.
 * That distinction is not academic: the development machine had none of
 * them installed, LibreOffice fell back to Liberation Sans, and a DOCX
 * line-spacing bug that put every read-copy worksheet onto two pages with
 * the real Andika stayed invisible until the fonts were present (0.8.1,
 * workstream F4). The script prints what each family resolves to.
 *
 * Developer/QA tool only, per blueprint 12 ("never a teacher prerequisite")
 * — not part of `npm test` or the build gate: requires `soffice` and
 * `pdfinfo`/`pdftotext` (poppler-utils) locally, and `npm run build` to
 * have already produced release/. Run with `npm run verify-docx`.
 */

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CDP_PORT = 9422;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(200);
  }
  throw new Error('Chromium DevTools endpoint never came up');
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message.method, message.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(listener) {
    this.listeners.push(listener);
  }
}

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
  { label: 'de-andika-level4-readonly-multipage', language: 'de', theme: 'stories', level: 4, fontId: 'andika', writingMode: 'read-only', fontSizePt: 20, lineHeightMultiplier: 2.0 }
];

// Binaries: the defaults match the development machine; CI (and anyone
// whose Chromium/LibreOffice live elsewhere) overrides them with
// CHROMIUM_BIN / SOFFICE_BIN (workstream F4).
const CHROMIUM_BIN = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
const SOFFICE_BIN = process.env.SOFFICE_BIN ?? 'soffice';

async function main() {
  const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-lo-downloads-'));
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-lo-profile-'));
  const indexPath = path.join(root, 'release/index.html');

  const chrome = spawn(
    CHROMIUM_BIN,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${profileDir}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  const downloaded = [];
  try {
    await waitForCdp();
    const created = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });

    const downloadEvents = [];
    cdp.on((method, params) => {
      if (method === 'Browser.downloadProgress') downloadEvents.push(params);
    });

    let loaded = false;
    cdp.on((method) => {
      if (method === 'Page.loadEventFired') loaded = true;
    });
    await cdp.send('Page.navigate', { url: `file://${indexPath}` });
    for (let i = 0; i < 40 && !loaded; i++) await wait(250);
    await wait(300);

    async function evalJs(expression, awaitPromise = false) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (result.exceptionDetails) throw new Error(`JS error: ${JSON.stringify(result.exceptionDetails)}`);
      return result.result.value;
    }

    async function waitForFit() {
      for (let i = 0; i < 20; i++) {
        await wait(250);
        const fitText = await evalJs(`document.getElementById('fit-indicator')?.textContent || ''`);
        if (fitText && !/measuring|preverjanje|midiendo|wird geprüft|vérification/i.test(fitText)) return fitText;
      }
      throw new Error('fit check never settled');
    }

    console.log(`Building and exporting ${CASES.length} representative worksheets through the real app...`);
    for (const testCase of CASES) {
      await evalJs(`
        (function() {
          const sel = document.getElementById('language-select');
          sel.value = '${testCase.language}';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        })();
      `);
      await wait(150);
      await evalJs(`
        (function() {
          document.getElementById('theme-select').value = '${testCase.theme}';
          document.getElementById('theme-select').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('level-select').value = '${testCase.level}';
          document.getElementById('level-select').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('btn-create').click();
          if (${JSON.stringify(testCase.entryId ?? null)}) {
            const picker = document.getElementById('text-select');
            if (picker.hidden || ![...picker.options].some((o) => o.value === ${JSON.stringify(testCase.entryId ?? null)})) {
              throw new Error('case ${testCase.label}: entry ${testCase.entryId} is not offered by the title picker');
            }
            picker.value = ${JSON.stringify(testCase.entryId ?? null)};
            picker.dispatchEvent(new Event('change', { bubbles: true }));
          }
          document.getElementById('font-select').value = '${testCase.fontId}';
          document.getElementById('font-select').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('writing-mode-select').value = '${testCase.writingMode}';
          document.getElementById('writing-mode-select').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('letter-colors-toggle').checked = ${Boolean(testCase.letterColors)};
          document.getElementById('letter-colors-toggle').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('syllable-colors-toggle').checked = ${Boolean(testCase.syllableColors)};
          document.getElementById('syllable-colors-toggle').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('sentence-per-line-toggle').checked = ${Boolean(testCase.sentencePerLine)};
          document.getElementById('sentence-per-line-toggle').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('tint-select').value = '${testCase.tintId ?? 'none'}';
          document.getElementById('tint-select').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('print-tint-toggle').checked = ${Boolean(testCase.printTint)};
          document.getElementById('print-tint-toggle').dispatchEvent(new Event('change', { bubbles: true }));
          ${testCase.wordSpacingPt !== undefined ? `
          document.getElementById('word-spacing-input').value = '${testCase.wordSpacingPt}';
          document.getElementById('word-spacing-input').dispatchEvent(new Event('change', { bubbles: true }));
          ` : ''}
          ${testCase.fontSizePt !== undefined ? `
          document.getElementById('font-size-input').value = '${testCase.fontSizePt}';
          document.getElementById('font-size-input').dispatchEvent(new Event('change', { bubbles: true }));
          ` : ''}
          ${testCase.lineHeightMultiplier !== undefined ? `
          document.getElementById('line-height-input').value = '${testCase.lineHeightMultiplier}';
          document.getElementById('line-height-input').dispatchEvent(new Event('change', { bubbles: true }));
          ` : ''}
        })();
      `);
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

      const beforeCount = downloadEvents.filter((e) => e.state === 'completed').length;
      // The rendered passage, captured from the real app before export, is
      // what the PDF is later checked against — "non-empty text" proved
      // nothing (a header line alone passed it).
      const renderedTitle = await evalJs(`document.querySelector('#preview .ws-title')?.textContent ?? ''`);
      const renderedBody = await evalJs(`document.querySelector('#preview .ws-body').textContent`);

      await evalJs(`document.getElementById('btn-docx').click();`);
      let completed = null;
      for (let i = 0; i < 40; i++) {
        await wait(200);
        const finished = downloadEvents.filter((e) => e.state === 'completed');
        if (finished.length > beforeCount) {
          completed = finished[finished.length - 1];
          break;
        }
      }
      if (!completed) {
        downloaded.push({ testCase, ok: false, note: 'docx download never completed' });
        continue;
      }
      downloaded.push({ testCase, ok: true, guid: completed.guid, fitText, expectedPages, renderedTitle, renderedBody });
    }
  } finally {
    chrome.kill();
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
  const normalizeForCompare = (s) => s.normalize('NFC').replace(/\s+/g, '');

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
      const text = execFileSync('pdftotext', [pdfPath, '-']).toString();
      const pdfNormalized = normalizeForCompare(text);
      const bodyOk = matched ? pdfNormalized.includes(normalizeForCompare(matched.renderedBody)) : false;
      const titleOk = matched ? pdfNormalized.includes(normalizeForCompare(matched.renderedTitle)) : false;
      const pagesOk = pages !== null && Math.abs(pages - expectedPages) <= toleratedDelta;
      const ok = pagesOk && bodyOk && titleOk;
      allOk = allOk && ok;
      const textNote = bodyOk && titleOk ? 'full passage present' : `text MISMATCH (title ${titleOk ? 'ok' : 'missing'}, body ${bodyOk ? 'ok' : 'incomplete'})`;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  pages=${pages} (expected ${expectedPages}${toleratedDelta ? ` ±${toleratedDelta}` : ''})  ${textNote}`);
    } catch (error) {
      allOk = false;
      console.log(`  FAIL  ${label}  — conversion/inspection failed: ${error.message}`);
    }
  }

  await rm(downloadDir, { recursive: true, force: true });
  await rm(profileDir, { recursive: true, force: true });

  console.log(allOk ? '\nAll LibreOffice compatibility checks passed.' : '\nSome LibreOffice compatibility checks FAILED.');
  process.exitCode = allOk ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
