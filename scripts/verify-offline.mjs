#!/usr/bin/env node
/**
 * Phase 7 release qualification: fresh-machine offline test.
 *
 * Blueprint section 12: "Open the extracted release through file:// with
 * network access disabled and a fresh profile. Record and fail unexpected
 * HTTP(S) requests." This is stronger than merely observing traffic — the
 * point of --host-resolver-rules below is that even if some future change
 * accidentally tried to reach the network, the attempt would fail closed
 * (DNS resolution forced to NOTFOUND) rather than happening to succeed
 * because this dev machine has internet access.
 *
 * Takes an --unzip <path-to-zip> argument to exercise the actual packaged
 * deliverable (what `npm run package` produces) extracted to a scratch
 * directory outside the repo — the real "extract a ZIP on a fresh machine"
 * scenario — rather than the repo's own release/ folder. Falls back to
 * release/ if no zip is given.
 *
 * Exercises a broad real user journey (every bundled language, dyslexia
 * supports, presets, packets, a multi-page worksheet, print, and real
 * .docx export with the download tracked to completion) and fails on:
 * any non-file:// network request, any console error/exception, or a
 * .docx export that doesn't produce a real OOXML file. (Until 2026-09-20
 * this header claimed the script failed on a failed download, but it had
 * no download tracking at all and never clicked the export button — the
 * "print and .docx export" step only pressed Print.)
 *
 * Developer/QA tool, not part of `npm test`. Run with `npm run verify-offline`.
 */

import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, cp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CDP_PORT = 9423;

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

async function resolveIndexPath() {
  const unzipArgIndex = process.argv.indexOf('--unzip');
  if (unzipArgIndex === -1) {
    console.log('No --unzip <path-to-zip> given — testing repo release/ directly.');
    return path.join(root, 'release/index.html');
  }
  const zipPath = process.argv[unzipArgIndex + 1];
  if (!zipPath) throw new Error('--unzip requires a path to a .zip file');
  const stageDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-offline-extract-'));
  console.log(`Extracting ${zipPath} to ${stageDir} (a location outside the repo, simulating a fresh machine)...`);
  execFileSync('unzip', ['-q', zipPath, '-d', stageDir]);
  const entries = await (await import('node:fs/promises')).readdir(stageDir);
  const extractedRoot = path.join(stageDir, entries[0]);
  return path.join(extractedRoot, 'index.html');
}

async function main() {
  const indexPath = await resolveIndexPath();
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-offline-profile-'));
  const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-offline-downloads-'));

  const chrome = spawn(
    '/usr/bin/chromium',
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${profileDir}`,
      // Force every DNS lookup to fail — a network request would error out
      // rather than happening to succeed because this dev machine is online.
      '--host-resolver-rules=MAP * ~NOTFOUND',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  const networkRequests = [];
  const consoleErrors = [];
  /** @type {Array<{ label: string, ok: boolean, note: string }>} */
  const journeyChecks = [];

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
    await cdp.send('Network.enable');
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });

    const downloadEvents = [];
    cdp.on((method, params) => {
      if (method === 'Browser.downloadProgress') downloadEvents.push(params);
    });

    cdp.on((method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const url = params.request.url;
        if (!url.startsWith('file://') && !url.startsWith('data:') && url !== 'about:blank') {
          networkRequests.push(url);
        }
      }
      if (method === 'Runtime.exceptionThrown') {
        consoleErrors.push(JSON.stringify(params.exceptionDetails));
      }
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        consoleErrors.push((params.args || []).map((a) => a.value ?? a.description).join(' '));
      }
    });

    let loaded = false;
    cdp.on((method) => {
      if (method === 'Page.loadEventFired') loaded = true;
    });
    await cdp.send('Page.navigate', { url: `file://${indexPath}` });
    for (let i = 0; i < 40 && !loaded; i++) await wait(250);
    if (!loaded) throw new Error('page never fired load event');
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

    // Clicks "Export as Word", waits for the real download to complete,
    // and checks the file on disk is a non-trivial OOXML zip. Same
    // download-tracking mechanism as verify-docx-libreoffice.mjs.
    async function exportDocxAndCheck(label) {
      const ready = await evalJs(`!document.getElementById('btn-docx').disabled`);
      if (!ready) {
        journeyChecks.push({ label, ok: false, note: 'export button was disabled' });
        return;
      }
      const beforeCount = downloadEvents.filter((e) => e.state === 'completed').length;
      await evalJs(`document.getElementById('btn-docx').click();`);
      let completed = null;
      for (let i = 0; i < 40 && !completed; i++) {
        await wait(200);
        const finished = downloadEvents.filter((e) => e.state === 'completed');
        if (finished.length > beforeCount) completed = finished[finished.length - 1];
      }
      if (!completed) {
        journeyChecks.push({ label, ok: false, note: 'download never completed' });
        return;
      }
      // Chromium names the file from the app's download attribute; there is
      // exactly one new .docx per export, so read whichever is newest.
      const { readdir, stat } = await import('node:fs/promises');
      const files = (await readdir(downloadDir)).filter((f) => f.endsWith('.docx'));
      let newest = null;
      for (const f of files) {
        const info = await stat(path.join(downloadDir, f));
        if (!newest || info.mtimeMs > newest.mtimeMs) newest = { name: f, mtimeMs: info.mtimeMs };
      }
      const bytes = newest ? await readFile(path.join(downloadDir, newest.name)) : Buffer.alloc(0);
      const isZip = bytes.length > 1000 && bytes.subarray(0, 2).toString('hex') === '504b';
      journeyChecks.push({
        label,
        ok: isZip,
        note: isZip ? `${newest.name}, ${bytes.length} bytes, PK signature` : `file missing or not OOXML (${bytes.length} bytes)`
      });
    }

    console.log('Exercising a broad user journey across all 5 languages...');
    for (const language of ['sl', 'en', 'de', 'fr', 'es']) {
      await evalJs(`
        (function() {
          document.getElementById('language-select').value = '${language}';
          document.getElementById('language-select').dispatchEvent(new Event('change', { bubbles: true }));
        })();
      `);
      await waitForFit();
      await evalJs(`document.getElementById('btn-add-to-packet').click();`);
    }

    console.log('Exercising dyslexia-support toggles, presets, and a custom-font switch...');
    await evalJs(`
      (function() {
        document.getElementById('btn-dyslexia-preset').click();
        window.prompt = () => 'offline-test-preset';
        document.getElementById('btn-save-preset').click();
      })();
    `);
    await wait(200);

    console.log('Checking built-in presets keep the current language and text (workstream H)...');
    await evalJs(`
      document.getElementById('language-select').value = 'en';
      document.getElementById('language-select').dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await waitForFit();
    const titleBeforeBuiltin = await evalJs(`document.querySelector('#preview .ws-title')?.textContent ?? ''`);
    await evalJs(`
      document.getElementById('preset-select').value = 'builtin-standard';
      document.getElementById('btn-load-preset').click();
    `);
    await waitForFit();
    const langAfterBuiltin = await evalJs(`document.documentElement.lang`);
    const titleAfterBuiltin = await evalJs(`document.querySelector('#preview .ws-title')?.textContent ?? ''`);
    const presetOptionTexts = await evalJs(`[...document.getElementById('preset-select').options].slice(0, 2).map((o) => o.textContent)`);
    journeyChecks.push({
      label: 'loading the built-in Standard preset in an English session keeps English and the current text',
      ok: langAfterBuiltin === 'en' && titleAfterBuiltin === titleBeforeBuiltin,
      note: `lang=${langAfterBuiltin}, title ${titleAfterBuiltin === titleBeforeBuiltin ? 'unchanged' : 'CHANGED'}`
    });
    journeyChecks.push({
      label: 'built-in preset names re-translate on language switch',
      ok: presetOptionTexts[0] === 'Standard copy practice' && presetOptionTexts[1] === 'Dyslexia-friendly',
      note: JSON.stringify(presetOptionTexts)
    });
    // A teacher-saved setup, by contrast, must still restore its language.
    await evalJs(`
      window.prompt = () => 'offline-test-english-setup';
      document.getElementById('btn-save-preset').click();
    `);
    await wait(100);
    await evalJs(`
      document.getElementById('language-select').value = 'de';
      document.getElementById('language-select').dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await waitForFit();
    await evalJs(`
      const select = document.getElementById('preset-select');
      select.value = [...select.options].find((o) => o.textContent === 'offline-test-english-setup').value;
      document.getElementById('btn-load-preset').click();
    `);
    await waitForFit();
    const langAfterSaved = await evalJs(`document.documentElement.lang`);
    journeyChecks.push({
      label: 'loading a teacher-saved setup restores the language it was saved in',
      ok: langAfterSaved === 'en',
      note: `lang=${langAfterSaved}`
    });

    console.log('Checking "Reset image" re-renders the worksheet (workstream G)...');
    const bundledImageSrc = await evalJs(`document.querySelector('#preview .ws-image').src`);
    // A minimal valid 1x1 PNG, written to disk so the real file input can be driven via CDP.
    const pngPath = path.join(downloadDir, 'tiny.png');
    await (await import('node:fs/promises')).writeFile(
      pngPath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    );
    const { root: domRoot } = await cdp.send('DOM.getDocument');
    const { nodeId: uploadNodeId } = await cdp.send('DOM.querySelector', { nodeId: domRoot.nodeId, selector: '#image-upload' });
    await cdp.send('DOM.setFileInputFiles', { nodeId: uploadNodeId, files: [pngPath] });
    await waitForFit();
    await wait(300);
    const customImageSrc = await evalJs(`document.querySelector('#preview .ws-image').src`);
    await evalJs(`document.getElementById('btn-reset-image').click();`);
    await waitForFit();
    await wait(300);
    const previewSrcAfterReset = await evalJs(`document.querySelector('#preview .ws-image').src`);
    const printSurfaceSrcAfterReset = await evalJs(`document.querySelector('#print-surface .ws-image').src`);
    journeyChecks.push({
      label: 'uploading a custom image changes the preview image',
      ok: customImageSrc !== bundledImageSrc,
      note: customImageSrc !== bundledImageSrc ? 'preview switched to the uploaded image' : 'preview did NOT change'
    });
    journeyChecks.push({
      label: '"Reset image" restores the bundled image in the preview and the print surface (not just the button state)',
      ok: previewSrcAfterReset === bundledImageSrc && printSurfaceSrcAfterReset === bundledImageSrc,
      note: previewSrcAfterReset === bundledImageSrc ? 'both restored' : 'still showing the uploaded image'
    });

    console.log('Exercising print and .docx export...');
    await evalJs(`document.getElementById('btn-print').click();`); // window.print() is a real no-op without a print handler in headless mode — safe
    await wait(200);
    await exportDocxAndCheck('.docx export of the current worksheet completed');

    console.log('Exercising packet print...');
    await evalJs(`document.getElementById('btn-print-packet').click();`);
    await wait(300);

    console.log('Exercising a multi-page worksheet print (upgrade blueprint v3, workstream A)...');
    await evalJs(`
      (function() {
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
      })();
    `);
    const multiPageFitText = await waitForFit();
    const pageCount = await evalJs(`Number(document.getElementById('fit-indicator').dataset.pageCount)`);
    if (!(pageCount > 1)) {
      throw new Error(`expected max settings on a level-5 text to report more than 1 page, got pageCount=${pageCount} ("${multiPageFitText}")`);
    }
    await evalJs(`document.getElementById('btn-print').click();`);
    await wait(200);
    await exportDocxAndCheck('.docx export of a multi-page worksheet completed');

    console.log('Exercising teacher content import (blueprint 8.11 / ui/contentImport.js)...');
    // A one-entry English pack referencing a brand-new image, driven through
    // the real file inputs: import must (1) reject a broken file with the
    // localized message and change nothing, (2) accept the pack, add the
    // image, and make the entry the only candidate for its theme/level.
    const fs = await import('node:fs/promises');
    const badJsonPath = path.join(downloadDir, 'broken-pack.json');
    await fs.writeFile(badJsonPath, '{ this is not json');
    const importedImagePath = path.join(downloadDir, 'imported_tiny.png');
    await fs.copyFile(pngPath, importedImagePath);
    const packPath = path.join(downloadDir, 'imported-pack.json');
    await fs.writeFile(packPath, JSON.stringify({
      schemaVersion: 1,
      packId: 'offline-test-import',
      language: 'en',
      entries: [{
        id: 'stories_offline_import_1',
        version: 1,
        theme: 'stories',
        level: 1,
        title: 'Offline Import Check',
        body: 'The cat sat on the mat. It was warm.',
        imageId: 'imported_tiny',
        review: { status: 'draft' }
      }]
    }));
    const setImportFiles = async (selector, files) => {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      await cdp.send('DOM.setFileInputFiles', { nodeId, files });
    };
    const titleBeforeImport = await evalJs(`document.querySelector('#preview .ws-title')?.textContent || ''`);
    await setImportFiles('#import-json-input', [badJsonPath]);
    await evalJs(`document.getElementById('btn-import-content').click();`);
    await wait(500);
    const brokenStatus = await evalJs(`document.getElementById('import-status').textContent`);
    const titleAfterBroken = await evalJs(`document.querySelector('#preview .ws-title')?.textContent || ''`);
    journeyChecks.push({
      label: 'importing a broken content file reports it and changes nothing',
      ok: brokenStatus === 'The selected file is not valid JSON.' && titleAfterBroken === titleBeforeImport,
      note: `status="${brokenStatus}", worksheet ${titleAfterBroken === titleBeforeImport ? 'unchanged' : 'CHANGED'}`
    });

    await setImportFiles('#import-json-input', [packPath]);
    await setImportFiles('#import-images-input', [importedImagePath]);
    await evalJs(`document.getElementById('btn-import-content').click();`);
    await wait(800);
    const importStatus = await evalJs(`document.getElementById('import-status').textContent`);
    await evalJs(`
      (function() {
        document.getElementById('theme-select').value = 'stories';
        document.getElementById('theme-select').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('level-select').value = '1';
        document.getElementById('level-select').dispatchEvent(new Event('change', { bubbles: true }));
      })();
    `);
    await wait(100);
    const candidateText = await evalJs(`document.getElementById('candidate-count').textContent`);
    await evalJs(`document.getElementById('btn-create').click();`);
    await waitForFit();
    await wait(300);
    const importedTitle = await evalJs(`document.querySelector('#preview .ws-title')?.textContent || ''`);
    const importedImageSrc = await evalJs(`document.querySelector('#preview .ws-image')?.src || ''`);
    const importOk = importStatus === 'Imported 1 text(s) for English.'
      && candidateText === 'Available: 1'
      && importedTitle === 'Offline Import Check'
      && importedImageSrc.startsWith('data:image/');
    journeyChecks.push({
      label: 'importing a content pack with a new image replaces the language\'s texts for the session',
      ok: importOk,
      note: importOk
        ? 'status, candidate count, rendered title and imported image all as expected'
        : `status="${importStatus}", candidates="${candidateText}", title="${importedTitle}", image=${importedImageSrc.slice(0, 20)}`
    });
  } finally {
    chrome.kill();
    // Give Chromium a moment to actually release its profile-directory file
    // locks before cleanup — deleting it immediately after kill() can race
    // and throw ENOTEMPTY. A failed cleanup here must not mask the actual
    // test results below (it's just a leftover /tmp directory).
    await wait(500);
    await rm(profileDir, { recursive: true, force: true }).catch((error) => {
      console.log(`(cleanup note: couldn't remove ${profileDir}: ${error.message})`);
    });
    await rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log('\nResults:');
  const networkOk = networkRequests.length === 0;
  console.log(`  ${networkOk ? 'PASS' : 'FAIL'}  zero non-file/data network requests (observed: ${networkRequests.length})`);
  if (!networkOk) for (const url of networkRequests) console.log(`         - ${url}`);
  const consoleOk = consoleErrors.length === 0;
  console.log(`  ${consoleOk ? 'PASS' : 'FAIL'}  zero console errors/exceptions (observed: ${consoleErrors.length})`);
  if (!consoleOk) for (const e of consoleErrors) console.log(`         - ${e}`);

  let journeyOk = true;
  for (const c of journeyChecks) {
    journeyOk = journeyOk && c.ok;
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label} (${c.note})`);
  }

  const allOk = networkOk && consoleOk && journeyOk;
  console.log(allOk ? '\nFresh-machine offline test PASSED.' : '\nFresh-machine offline test FAILED.');
  process.exitCode = allOk ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
