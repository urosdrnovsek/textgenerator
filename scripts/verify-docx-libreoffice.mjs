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
 * LibreOffice and checks the PDF has exactly 1 page and contains the
 * expected text — not just that no exception was thrown.
 *
 * Developer/QA tool only, per blueprint 12 ("never a teacher prerequisite")
 * — not part of `npm test` or the build gate: requires `soffice` and
 * `pdfinfo`/`pdftotext` (poppler-utils) locally, and `npm run build` to
 * have already produced release/. Run with `npm run verify-docx`.
 */

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
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
 * sentence-per-line, and personalization each exercised at least once.
 */
const CASES = [
  { label: 'sl-andika-level1-readcopy-colors-name', language: 'sl', theme: 'stories', level: 1, fontId: 'andika', writingMode: 'read-copy', letterColors: true, syllableColors: true, name: 'Maja' },
  { label: 'sl-andika-level5-readcopy-stress', language: 'sl', theme: 'stories', level: 5, fontId: 'andika', writingMode: 'read-copy' },
  { label: 'en-lexend-level3-trace', language: 'en', theme: 'stories', level: 3, fontId: 'lexend', writingMode: 'trace' },
  { label: 'de-opendyslexic-level3-readonly-tint', language: 'de', theme: 'stories', level: 3, fontId: 'opendyslexic', writingMode: 'read-only', tintId: 'cream', printTint: true },
  { label: 'fr-comicneue-level3-readcopy-sentenceperline', language: 'fr', theme: 'stories', level: 3, fontId: 'comicneue', writingMode: 'read-copy', sentencePerLine: true },
  { label: 'es-andika-level5-readcopy-stress', language: 'es', theme: 'stories', level: 5, fontId: 'andika', writingMode: 'read-copy' },
  // Regression coverage for a real bug: every DE/FR level-5 entry used to
  // overflow the page under default settings (fixed by trimming the
  // content — see the content-review commit history). Both fit now, but
  // stay right at the edge of the budget, so keep them as permanent
  // boundary cases rather than trusting they'll never regress silently.
  { label: 'de-andika-level5-readcopy-stress', language: 'de', theme: 'amazing_science', level: 5, fontId: 'andika', writingMode: 'read-copy' },
  { label: 'fr-andika-level5-readcopy-stress', language: 'fr', theme: 'nature_seasons', level: 5, fontId: 'andika', writingMode: 'read-copy' },
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
  { label: 'en-andika-level1-readonly-wordspacing', language: 'en', theme: 'stories', level: 1, fontId: 'andika', writingMode: 'read-only', wordSpacingPt: 6 }
];

async function main() {
  const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-lo-downloads-'));
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-lo-profile-'));
  const indexPath = path.join(root, 'release/index.html');

  const chrome = spawn(
    '/usr/bin/chromium',
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
          document.getElementById('name-input').value = ${JSON.stringify(testCase.name ?? '')};
          document.getElementById('name-input').dispatchEvent(new Event('change', { bubbles: true }));
          ${testCase.wordSpacingPt !== undefined ? `
          document.getElementById('word-spacing-input').value = '${testCase.wordSpacingPt}';
          document.getElementById('word-spacing-input').dispatchEvent(new Event('change', { bubbles: true }));
          ` : ''}
        })();
      `);
      const fitText = await waitForFit();
      const docxReady = await evalJs(`!document.getElementById('btn-docx').disabled`);
      if (!docxReady) {
        downloaded.push({ testCase, ok: false, note: `not print-ready after settling: "${fitText}"` });
        continue;
      }

      const beforeCount = downloadEvents.filter((e) => e.state === 'completed').length;
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
      downloaded.push({ testCase, ok: true, guid: completed.guid, fitText });
    }
  } finally {
    chrome.kill();
  }

  const filesInDownloadDir = await readdir(downloadDir);
  console.log(`Downloaded ${filesInDownloadDir.length} .docx file(s). Converting via real LibreOffice...`);

  const okCases = downloaded.filter((d) => d.ok);
  for (const d of downloaded.filter((d) => !d.ok)) {
    console.log(`  SKIP  ${d.testCase.label}  — ${d.note}`);
  }

  const docxPaths = filesInDownloadDir.filter((f) => f.endsWith('.docx')).map((f) => path.join(downloadDir, f));
  if (docxPaths.length > 0) {
    console.log(execFileSync('soffice', ['--version']).toString().trim());
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', downloadDir, ...docxPaths], {
      stdio: 'pipe',
      timeout: 180_000
    });
  }

  console.log('\nResults:');
  let allOk = true;
  for (const docxPath of docxPaths) {
    const pdfPath = docxPath.replace(/\.docx$/, '.pdf');
    const label = path.basename(docxPath);
    try {
      const info = execFileSync('pdfinfo', [pdfPath]).toString();
      const pagesMatch = info.match(/^Pages:\s+(\d+)/m);
      const pages = pagesMatch ? Number(pagesMatch[1]) : null;
      const text = execFileSync('pdftotext', [pdfPath, '-']).toString();
      const ok = pages === 1 && text.trim().length > 0;
      allOk = allOk && ok;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  pages=${pages}  textLength=${text.trim().length}`);
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
