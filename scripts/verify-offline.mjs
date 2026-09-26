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

// Default matches the development machine; CI overrides it (workstream F4).
const CHROMIUM_BIN = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';

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
    CHROMIUM_BIN,
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
    // With the grayscale view off, no notice is shown on a default sheet
    // (its GRAY_COLLISION is computed but held back), so the notice line
    // (worksheet/advice.js, under the fit indicator) stays hidden.
    const noticeState = await evalJs(`(() => { const el = document.getElementById('fit-notices'); return el ? { hidden: el.hidden, items: el.children.length } : null; })()`);
    const noticesHiddenOk = noticeState !== null && noticeState.hidden && noticeState.items === 0;
    journeyChecks.push({
      label: 'the notice line exists and is hidden when no notice is shown',
      ok: noticesHiddenOk,
      note: noticesHiddenOk ? 'hidden, empty' : `state=${JSON.stringify(noticeState)}`
    });

    // Grayscale preview (B8): view only. The default letter palette's b/d
    // pair is a GRAY_COLLISION, shown only while the grayscale view is on.
    console.log('Driving the grayscale preview toggle...');
    const grayState = `(() => {
      const notice = document.querySelector('#fit-notices [data-notice="GRAY_COLLISION"]');
      return {
        previewFilter: getComputedStyle(document.getElementById('preview')).filter,
        printFilter: getComputedStyle(document.getElementById('print-surface')).filter,
        printPageFilter: getComputedStyle(document.querySelector('#print-surface .ws-page')).filter,
        listHidden: document.getElementById('fit-notices').hidden,
        notice: notice ? notice.textContent : null
      };
    })()`;
    await evalJs(`document.getElementById('grayscale-preview-toggle').click()`);
    const grayOn = await evalJs(grayState);
    await evalJs(`document.getElementById('letter-colors-toggle').click()`);
    await waitForFit();
    const grayOnNoLetters = await evalJs(grayState);
    await evalJs(`document.getElementById('letter-colors-toggle').click()`);
    await waitForFit();
    await evalJs(`document.getElementById('grayscale-preview-toggle').click()`);
    const grayOff = await evalJs(grayState);
    const grayOk = grayOn.previewFilter === 'grayscale(1)' && grayOn.printFilter === 'none' && grayOn.printPageFilter === 'none'
      && !grayOn.listHidden && Boolean(grayOn.notice)
      && grayOnNoLetters.notice === null && grayOnNoLetters.listHidden
      && grayOff.previewFilter === 'none' && grayOff.listHidden && grayOff.notice === null;
    journeyChecks.push({
      label: 'grayscale preview greys #preview only, and shows the grey-collision notice only while on',
      ok: grayOk,
      note: grayOk ? `notice "${grayOn.notice}"; gone with letter colours off and with the view off` : JSON.stringify({ grayOn, grayOnNoLetters, grayOff })
    });

    // Line numbers (B9): 1…N in the preview and the print surface alike,
    // one per measured line (no two at the same height), in a gutter the
    // passage makes room for; gone again when switched off.
    console.log('Driving the line numbers toggle...');
    const lineNumberState = `(() => {
      const read = (root) => {
        const numbers = [...document.querySelectorAll(root + ' .ws-line-number')];
        const body = document.querySelector(root + ' .ws-body');
        return {
          texts: numbers.map((n) => n.textContent),
          distinctTops: new Set(numbers.map((n) => n.style.top)).size,
          gutterPx: body ? parseFloat(getComputedStyle(body).paddingLeft) : null
        };
      };
      return { preview: read('#preview'), print: read('#print-surface') };
    })()`;
    await evalJs(`document.getElementById('line-numbers-toggle').click()`);
    await waitForFit();
    const numbersOn = await evalJs(lineNumberState);
    await evalJs(`document.getElementById('line-numbers-toggle').click()`);
    await waitForFit();
    const numbersOff = await evalJs(lineNumberState);
    const sequential = (texts) => texts.length > 0 && texts.every((t, i) => t === String(i + 1));
    const gutterPx = 8 * 96 / 25.4;
    const numbersOk = sequential(numbersOn.preview.texts)
      && JSON.stringify(numbersOn.print.texts) === JSON.stringify(numbersOn.preview.texts)
      && numbersOn.preview.distinctTops === numbersOn.preview.texts.length
      && Math.abs(numbersOn.preview.gutterPx - gutterPx) < 0.5
      && numbersOff.preview.texts.length === 0 && numbersOff.print.texts.length === 0 && numbersOff.preview.gutterPx === 0;
    journeyChecks.push({
      label: 'line numbers run 1…N in preview and print surface in an 8 mm gutter, and go when switched off',
      ok: numbersOk,
      note: numbersOk ? `${numbersOn.preview.texts.length} lines numbered` : JSON.stringify({ numbersOn, numbersOff })
    });

    // Image slot (A5): the picture above the passage, a 90 mm drawing box
    // after it (then the copy rows), or neither — in the preview and the
    // print surface alike.
    console.log('Driving the picture / drawing box / none select...');
    const slotState = `(() => {
      const read = (root) => {
        const page = document.querySelector(root + ' .ws-page');
        const box = page.querySelector('.ws-drawing-box');
        const passage = page.querySelector('[data-block="passage"]');
        const copy = page.querySelector('.ws-copy-area');
        return {
          image: Boolean(page.querySelector('img.ws-image')),
          box: Boolean(box),
          // offsetHeight, not getBoundingClientRect: the on-screen preview
          // is scaled down with a transform to fit the window.
          boxHeightMm: box ? Math.round(box.offsetHeight * 25.4 / 96 * 10) / 10 : null,
          boxAfterPassage: box ? Boolean(passage.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
          copyAfterBox: box && copy ? Boolean(box.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING) : null
        };
      };
      return { preview: read('#preview'), print: read('#print-surface') };
    })()`;
    const setSlot = async (slot) => {
      await evalJs(`(() => { const el = document.getElementById('image-slot-select'); el.value = '${slot}'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await waitForFit();
      return evalJs(slotState);
    };
    const slotBox = await setSlot('drawing-box');
    const slotNone = await setSlot('none');
    const slotPicture = await setSlot('picture');
    const both = (st, f) => f(st.preview) && f(st.print);
    const slotOk = both(slotBox, (x) => !x.image && x.box && x.boxHeightMm === 90 && x.boxAfterPassage && x.copyAfterBox !== false)
      && both(slotNone, (x) => !x.image && !x.box)
      && both(slotPicture, (x) => x.image && !x.box);
    journeyChecks.push({
      label: 'the picture select gives the picture, a 90 mm drawing box after the passage, or neither, in preview and print',
      ok: slotOk,
      note: slotOk ? `box ${slotBox.preview.boxHeightMm} mm, copy rows ${slotBox.preview.copyAfterBox ? 'after it' : 'not on this sheet'}` : JSON.stringify({ slotBox, slotNone, slotPicture })
    });

    // Write about the picture (A4) + the instruction line: title, the
    // locale's instruction, the large picture, no passage, copy rows. Its
    // select disables "None", and choosing the mode while "None" is set
    // switches back to the picture. Other modes print no instruction.
    // (A square picture fills 90 × 90 of the large 120 × 90 mm box, and
    // 45 × 45 of the normal 60 × 45 mm one.)
    console.log('Driving "write about the picture" and the instruction line...');
    const ownState = `(() => {
      const read = (root) => {
        const page = document.querySelector(root + ' .ws-page');
        const img = page.querySelector('img.ws-image');
        return {
          instruction: page.querySelector('.ws-instruction')?.textContent ?? null,
          passage: Boolean(page.querySelector('[data-block="passage"]')),
          imageWidthMm: img ? Math.round(img.offsetWidth * 25.4 / 96) : null,
          copy: Boolean(page.querySelector('.ws-copy-area'))
        };
      };
      const slot = document.getElementById('image-slot-select');
      return {
        preview: read('#preview'), print: read('#print-surface'),
        slot: slot.value, noneDisabled: slot.querySelector('option[value="none"]').disabled
      };
    })()`;
    const setSelect = async (id, value) => {
      await evalJs(`(() => { const el = document.getElementById('${id}'); el.value = '${value}'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await waitForFit();
    };
    await setSelect('image-slot-select', 'none');
    await setSelect('writing-mode-select', 'write-own');
    const own = await evalJs(ownState);
    await evalJs(`document.getElementById('header-instructions-toggle').click()`);
    await waitForFit();
    const ownNoLine = await evalJs(ownState);
    await evalJs(`document.getElementById('header-instructions-toggle').click()`);
    await setSelect('writing-mode-select', 'read-copy');
    const back = await evalJs(ownState);
    const ownOk = ['preview', 'print'].every((k) => own[k].instruction && !own[k].passage && own[k].imageWidthMm === 90 && own[k].copy)
      && own.slot === 'picture' && own.noneDisabled
      && ownNoLine.preview.instruction === null && ownNoLine.print.instruction === null
      && back.preview.instruction === null && back.preview.passage && back.preview.imageWidthMm === 45 && !back.noneDisabled;
    journeyChecks.push({
      label: '"write about the picture": instruction, 90 mm picture, no passage, copy rows; "None" disabled; line toggles off; read & copy unchanged',
      ok: ownOk,
      note: ownOk ? `instruction "${own.preview.instruction}"` : JSON.stringify({ own, ownNoLine, back })
    });

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

    console.log('Checking that line stripes do not block the worksheet (0.8.1 regression fix)...');
    // From 0.8 (cf502b9) until 0.8.1 the fit check took the stripes' 2mm
    // decorative bleed for an unbreakable word and blocked every striped
    // worksheet with WIDTH_OVERFLOW; nothing automated exercised the toggle.
    await evalJs(`
      (function() {
        const toggle = document.getElementById('line-stripes-toggle');
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      })();
    `);
    await waitForFit();
    await wait(500);
    const stripedPageCount = await evalJs(`document.getElementById('fit-indicator').dataset.pageCount`);
    const stripeCount = await evalJs(`document.querySelectorAll('#preview .ws-line-stripe').length`);
    const printDisabledWithStripes = await evalJs(`document.getElementById('btn-print').disabled`);
    journeyChecks.push({
      label: 'switching line stripes on keeps the worksheet renderable and printable',
      ok: Number(stripedPageCount) >= 1 && stripeCount > 0 && !printDisabledWithStripes,
      note: `pageCount=${stripedPageCount || '(blocked)'}, stripes=${stripeCount}, print ${printDisabledWithStripes ? 'DISABLED' : 'enabled'}`
    });
    await evalJs(`
      (function() {
        const toggle = document.getElementById('line-stripes-toggle');
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      })();
    `);
    await waitForFit();
    await wait(300);

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
      }, {
        // A genuinely unbreakable word wider than the page: the one case
        // WIDTH_OVERFLOW exists for, and the counterpart of the stripes
        // check above (the fix must not have silenced the real thing).
        id: 'animal_facts_offline_wide_1',
        version: 1,
        theme: 'animal_facts',
        level: 1,
        title: 'Width Overflow Check',
        body: `This word is too wide: ${'x'.repeat(160)}.`,
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
    // Every bundled pack now offers several texts per cell, so an imported
    // pack with one text per cell is the only place left to see the title
    // list hide itself (catalog.js chooseEntry / main.js populateTextSelect).
    const pickerHiddenForSingleText = await evalJs(`(() => { const s = document.getElementById('text-select'); return s.hidden && getComputedStyle(s).display === 'none'; })()`);
    await evalJs(`document.getElementById('btn-create').click();`);
    await waitForFit();
    await wait(300);
    const importedTitle = await evalJs(`document.querySelector('#preview .ws-title')?.textContent || ''`);
    const importedImageSrc = await evalJs(`document.querySelector('#preview .ws-image')?.src || ''`);
    const importOk = importStatus === 'Imported 2 text(s) for English.'
      && candidateText === 'Available: 1'
      && pickerHiddenForSingleText
      && importedTitle === 'Offline Import Check'
      && importedImageSrc.startsWith('data:image/');
    journeyChecks.push({
      label: 'importing a content pack with a new image replaces the language\'s texts for the session (and a single-text cell hides the title list)',
      ok: importOk,
      note: importOk
        ? 'status, candidate count, hidden title list, rendered title and imported image all as expected'
        : `status="${importStatus}", candidates="${candidateText}", pickerHidden=${pickerHiddenForSingleText}, title="${importedTitle}", image=${importedImageSrc.slice(0, 20)}`
    });

    console.log('Checking that an unbreakable word still reports WIDTH_OVERFLOW...');
    await evalJs(`
      (function() {
        document.getElementById('theme-select').value = 'animal_facts';
        document.getElementById('theme-select').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('btn-create').click();
      })();
    `);
    const wideFitText = await waitForFit();
    await wait(300);
    const widePageCount = await evalJs(`document.getElementById('fit-indicator').dataset.pageCount`);
    const widePrintDisabled = await evalJs(`document.getElementById('btn-print').disabled`);
    const wideBlocked = /WIDTH_OVERFLOW/.test(wideFitText) && widePageCount === '' && widePrintDisabled;
    journeyChecks.push({
      label: 'a word wider than the page is still blocked with WIDTH_OVERFLOW (print disabled)',
      ok: wideBlocked,
      note: wideBlocked ? 'blocked as expected' : `fit="${wideFitText}", pageCount="${widePageCount}", print ${widePrintDisabled ? 'disabled' : 'ENABLED'}`
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
