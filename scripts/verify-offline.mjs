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

    // Highlight letters (B6): valid groups are bold and coloured in the
    // preview and print surface; invalid input shows a message and changes
    // nothing; an empty field clears them.
    console.log('Driving the "Highlight letters" field...');
    const groupState = `(() => {
      const read = (root) => [...document.querySelectorAll(root + ' .ws-sentence span')]
        .filter((s) => s.style.fontWeight === '700')
        .map((s) => s.textContent.toLowerCase() + '|' + s.style.color);
      return {
        preview: read('#preview'), print: read('#print-surface'),
        field: document.getElementById('graphemes-input').value,
        message: document.getElementById('graphemes-status').textContent
      };
    })()`;
    const typeGroups = async (value) => {
      await evalJs(`(() => { const el = document.getElementById('graphemes-input'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await wait(300);
      await waitForFit();
      return evalJs(groupState);
    };
    const groupsOn = await typeGroups(' A, E ');
    const groupsInvalid = await typeGroups('a, e1');
    const groupsCleared = await typeGroups('');
    const onlyAE = (list) => list.length > 0 && list.every((x) => /^(a\|rgb\(30, 58, 138\)|e\|rgb\(15, 118, 110\))$/.test(x));
    const groupsOk = onlyAE(groupsOn.preview) && JSON.stringify(groupsOn.print) === JSON.stringify(groupsOn.preview)
      && groupsOn.field === 'a, e' && groupsOn.message === ''
      && groupsInvalid.message.includes('e1') && JSON.stringify(groupsInvalid.preview) === JSON.stringify(groupsOn.preview)
      && groupsCleared.preview.length === 0 && groupsCleared.message === '';
    journeyChecks.push({
      label: '"Highlight letters": groups bold and coloured in preview and print; invalid input changes nothing and says why; empty clears',
      ok: groupsOk,
      note: groupsOk ? `${groupsOn.preview.length} highlighted runs; message "${groupsInvalid.message}"` : JSON.stringify({ groupsOn, groupsInvalid, groupsCleared })
    });

    // Visible word spaces (B10): a faint "_" span before each space
    // between two words of a sentence, the same in preview and print, and
    // gone when switched off.
    console.log('Driving the visible word spaces toggle...');
    const markState = `(() => {
      const read = (root) => {
        const marks = [...document.querySelectorAll(root + ' .ws-sentence span')].filter((s) => s.textContent === '\\u00A0_');
        return { count: marks.length, spaceAfter: marks.every((m) => /^\\s/.test(m.nextElementSibling?.textContent ?? '')) };
      };
      return { preview: read('#preview'), print: read('#print-surface') };
    })()`;
    await evalJs(`document.getElementById('word-space-marks-toggle').click()`);
    await waitForFit();
    const marksOn = await evalJs(markState);
    await evalJs(`document.getElementById('word-space-marks-toggle').click()`);
    await waitForFit();
    const marksOff = await evalJs(markState);
    const marksOk = marksOn.preview.count > 0 && marksOn.preview.spaceAfter && marksOn.print.count === marksOn.preview.count
      && marksOff.preview.count === 0 && marksOff.print.count === 0;
    journeyChecks.push({
      label: 'visible word spaces: a "_" before each word space in preview and print, gone when switched off',
      ok: marksOk,
      note: marksOk ? `${marksOn.preview.count} marks` : JSON.stringify({ marksOn, marksOff })
    });

    // Gap-fill (A1): picking words in the preview (click and keyboard),
    // every Nth word leaving the first sentence whole, the cap, one gap
    // width, the same boxes in preview and print, answers hidden only in
    // print media, and nothing clickable once the mode is left.
    const setSelect = async (id, value) => {
      await evalJs(`(() => { const el = document.getElementById('${id}'); el.value = '${value}'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await waitForFit();
    };
    console.log('Driving "Fill the gaps"...');
    const clozeState = `(() => {
      const gaps = (root) => [...document.querySelectorAll(root + ' .ws-blank')];
      const preview = gaps('#preview');
      const firstGap = preview[0];
      let before = '';
      if (firstGap) { const r = document.createRange(); r.setStart(document.querySelector('#preview .ws-sentence'), 0); r.setEndBefore(firstGap); before = r.toString(); }
      return {
        answers: preview.map((g) => g.textContent),
        printAnswers: gaps('#print-surface').map((g) => g.textContent),
        widths: [...new Set(preview.map((g) => g.offsetWidth))],
        printWidths: [...new Set(gaps('#print-surface').map((g) => g.offsetWidth))],
        textBeforeFirstGap: before,
        hint: !document.getElementById('preview-hint').hidden,
        controls: !document.getElementById('cloze-controls').hidden,
        status: document.getElementById('cloze-status').textContent,
        notices: [...document.querySelectorAll('#fit-notices li')].map((l) => l.dataset.notice),
        instruction: Boolean(document.querySelector('#preview .ws-instruction')),
        picking: document.getElementById('preview').classList.contains('is-picking'),
        focusable: document.querySelectorAll('#preview [tabindex]').length,
        focusedW: document.activeElement?.dataset?.w ?? null
      };
    })()`;
    await setSelect('writing-mode-select', 'cloze');
    const clozeOn = await evalJs(clozeState);
    await evalJs(`document.querySelector('#preview .ws-sentence [data-w="1"]').click()`);
    await wait(300);
    await waitForFit();
    const clozeClicked = await evalJs(clozeState);
    await evalJs(`(() => { document.getElementById('cloze-every-nth-input').value = '4'; document.getElementById('btn-cloze-every-nth').click(); })()`);
    await wait(300);
    await waitForFit();
    const clozeNth = await evalJs(clozeState);
    // Print media: the answer is hidden, the gap's border and size are not.
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    const printPaint = await evalJs(`(() => { const g = document.querySelector('#print-surface .ws-blank'); return { answer: getComputedStyle(g.firstElementChild).visibility, border: getComputedStyle(g).borderBottomStyle, width: g.offsetWidth }; })()`);
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });
    // Keyboard: the roving tab stop, two words right, Space.
    await evalJs(`document.getElementById('btn-cloze-clear').click()`);
    await wait(300);
    await waitForFit();
    // The tab stop stays on the last word picked; two words right of it.
    const tabStopW = Number(await evalJs(`(() => { const el = document.querySelector('#preview [tabindex="0"]'); el.focus(); return el.dataset.w; })()`));
    for (const key of ['ArrowRight', 'ArrowRight']) await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: 39 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await wait(300);
    await waitForFit();
    const clozeKeyboard = await evalJs(clozeState);
    await setSelect('writing-mode-select', 'read-copy');
    const clozeOff = await evalJs(clozeState);
    const clozeOk = clozeOn.hint && clozeOn.controls && clozeOn.instruction && clozeOn.picking && clozeOn.notices.includes('NO_GAPS') && clozeOn.answers.length === 0
      && clozeClicked.answers.length === 1 && JSON.stringify(clozeClicked.printAnswers) === JSON.stringify(clozeClicked.answers) && !clozeClicked.notices.includes('NO_GAPS')
      && clozeNth.answers.length > 1 && clozeNth.widths.length === 1 && JSON.stringify(clozeNth.printWidths) === JSON.stringify(clozeNth.widths) && /[.!?]/.test(clozeNth.textBeforeFirstGap)
      && printPaint.answer === 'hidden' && printPaint.border === 'solid' && printPaint.width === clozeNth.widths[0]
      && clozeKeyboard.answers.length === 1 && clozeKeyboard.focusedW === String(tabStopW + 2)
      && !clozeOff.hint && !clozeOff.controls && !clozeOff.picking && clozeOff.focusable === 0 && clozeOff.answers.length === 0;
    journeyChecks.push({
      label: '"Fill the gaps": click and keyboard gaps, every Nth after the first sentence, one width, same boxes in print with answers hidden, off again in read & copy',
      ok: clozeOk,
      note: clozeOk ? `${clozeNth.answers.length} gaps at ${clozeNth.widths[0]}px; keyboard gap "${clozeKeyboard.answers[0]}"` : JSON.stringify({ clozeOn, clozeClicked, clozeNth, printPaint, clozeKeyboard, clozeOff })
    });

    // Write about the picture (A4) + the instruction line: title, the
    // locale's instruction, the large picture, no passage, copy rows. Its
    // select disables "None", and choosing the mode while "None" is set
    // switches back to the picture. Other modes print no instruction.
    // (A square picture fills 90 × 90 of the large 120 × 90 mm box, and
    // 45 × 45 of the normal 60 × 45 mm one.)
    // Copy target (A3), in read & copy: each choice marks its lines (or the
    // title) in preview and print without moving anything; "One sentence"
    // asks for a click, then marks that sentence; the row estimate, when
    // shown, names both numbers.
    console.log('Driving "Copy:"...');
    const copyState = `(() => {
      const bars = (root) => document.querySelectorAll(root + ' .ws-copy-mark-bar').length;
      return {
        row: !document.getElementById('copy-target-row').hidden,
        bars: bars('#preview'), printBars: bars('#print-surface'),
        titleMark: document.querySelector('#preview .ws-title')?.classList.contains('ws-copy-mark') ?? false,
        printTitleMark: document.querySelector('#print-surface .ws-title')?.classList.contains('ws-copy-mark') ?? false,
        hint: document.getElementById('preview-hint').hidden ? null : document.getElementById('preview-hint').textContent,
        picking: document.getElementById('preview').classList.contains('is-picking'),
        notices: [...document.querySelectorAll('#fit-notices li')].map((l) => ({ code: l.dataset.notice, text: l.textContent })),
        // Relative to the sheet: the hint bar above the preview moves the whole page on screen.
        firstLineTop: document.querySelector('#preview .ws-sentence').getBoundingClientRect().top - document.querySelector('#preview .ws-page').getBoundingClientRect().top,
        used: document.getElementById('fit-indicator').dataset.usedMm
      };
    })()`;
    await setSelect('writing-mode-select', 'read-copy');
    const copyWhole = await evalJs(copyState);
    await setSelect('copy-target-select', 'first-sentences');
    const copyFirst = await evalJs(copyState);
    await setSelect('copy-target-select', 'title');
    const copyTitle = await evalJs(copyState);
    await setSelect('copy-target-select', 'sentence');
    const copyUnchosen = await evalJs(copyState);
    await evalJs(`document.querySelector('#preview .ws-sentence [data-w="0"]').click()`);
    await wait(300);
    await waitForFit();
    const copyChosen = await evalJs(copyState);
    await setSelect('copy-target-select', 'passage');
    const copyBack = await evalJs(copyState);
    const shortNotice = [copyWhole, copyFirst, copyTitle, copyChosen].flatMap((st) => st.notices).find((n) => n.code === 'COPY_SPACE_SHORT');
    const copyOk = copyWhole.row && copyWhole.bars === 0 && !copyWhole.titleMark && !copyWhole.picking
      && copyFirst.bars > 0 && copyFirst.printBars === copyFirst.bars
      && copyTitle.titleMark && copyTitle.printTitleMark && copyTitle.bars === 0
      && copyUnchosen.picking && copyUnchosen.hint && copyUnchosen.bars === 0 && copyUnchosen.notices.some((n) => n.code === 'COPY_TARGET_UNCHOSEN')
      && copyChosen.bars > 0 && copyChosen.printBars === copyChosen.bars && !copyChosen.notices.some((n) => n.code === 'COPY_TARGET_UNCHOSEN')
      && [copyFirst, copyTitle, copyUnchosen, copyChosen].every((st) => st.firstLineTop === copyWhole.firstLineTop && st.used === copyWhole.used)
      && (!shortNotice || (shortNotice.text.match(/\d+/g) ?? []).length >= 2)
      && copyBack.bars === 0 && !copyBack.picking;
    journeyChecks.push({
      label: '"Copy:" marks the first sentences, a clicked sentence or the title in preview and print, asks for a click, and moves nothing',
      ok: copyOk,
      note: copyOk ? `bars ${copyFirst.bars} / ${copyChosen.bars}; estimate notice ${shortNotice ? `"${shortNotice.text}"` : 'not needed here'}` : JSON.stringify({ copyWhole, copyFirst, copyTitle, copyUnchosen, copyChosen, copyBack })
    });

    // "Put in order" (A2): 3–6 shuffled sentences with empty square boxes,
    // the same in print, none in its original place; the key numbers the
    // boxes 1…n and adds the tag.
    console.log('Driving "Put in order"...');
    const seqState = `(() => {
      const items = (root) => [...document.querySelectorAll(root + ' .ws-sequence-item')].map((i) => i.querySelector('.ws-sequence-box').textContent);
      const box = document.querySelector('#preview .ws-sequence-box');
      return {
        preview: items('#preview'), print: items('#print-surface'),
        square: box ? box.offsetWidth === box.offsetHeight && box.offsetWidth > 0 : false,
        instruction: Boolean(document.querySelector('#preview .ws-instruction')),
        passage: Boolean(document.querySelector('#preview [data-block="passage"]')),
        answersRow: !document.getElementById('answers-row').hidden,
        tag: document.querySelector('#preview .ws-answer-tag')?.textContent ?? null
      };
    })()`;
    await setSelect('writing-mode-select', 'sequence');
    const seqStudent = await evalJs(seqState);
    await evalJs(`document.getElementById('show-answers-toggle').click()`);
    await wait(300);
    await waitForFit();
    const seqKey = await evalJs(seqState);
    await evalJs(`document.getElementById('show-answers-toggle').click()`);
    await wait(300);
    await waitForFit();
    await setSelect('writing-mode-select', 'read-copy');
    const seqOff = await evalJs(seqState);
    const n = seqStudent.preview.length;
    const positions = seqKey.preview.map(Number);
    const seqOk = n >= 3 && n <= 6 && seqStudent.preview.every((t) => t === '') && seqStudent.print.length === n
      && seqStudent.square && seqStudent.instruction && !seqStudent.passage && seqStudent.answersRow && seqStudent.tag === null
      && [...positions].sort().join() === [...Array(n).keys()].map((i) => i + 1).join() && positions.every((p, i) => p !== i + 1)
      && JSON.stringify(seqKey.print) === JSON.stringify(seqKey.preview) && seqKey.tag
      && seqOff.preview.length === 0 && !seqOff.answersRow;
    journeyChecks.push({
      label: '"Put in order": 3–6 shuffled sentences with square boxes in preview and print, none in place; the key numbers them and adds the tag',
      ok: seqOk,
      note: seqOk ? `${n} items, key order ${positions.join(' ')}` : JSON.stringify({ seqStudent, seqKey, seqOff })
    });

    // Syllable arcs (B7): one arc per syllable in preview and print; the
    // line-spacing notice below 1.6 and not at it; the Word-file notices
    // for arcs and stripes; and a printed packet keeps its arcs (F9).
    console.log('Driving syllable arcs...');
    const arcState = `(() => ({
      arcs: document.querySelectorAll('#preview .ws-arc').length,
      printArcs: document.querySelectorAll('#print-surface .ws-arc').length,
      syllables: new Set([...document.querySelectorAll('#preview .ws-sentence [data-w][data-syl]')].map((s) => s.dataset.w + ':' + s.dataset.syl)).size,
      notices: [...document.querySelectorAll('#fit-notices li')].map((l) => l.dataset.notice)
    }))()`;
    const lineHeightBefore = await evalJs(`document.getElementById('line-height-input').value`);
    await setSelect('line-height-input', '1.4');
    await evalJs(`document.getElementById('syllable-arcs-toggle').click()`);
    await wait(300);
    await waitForFit();
    const arcsTight = await evalJs(arcState);
    await setSelect('line-height-input', '1.6');
    const arcsRoomy = await evalJs(arcState);
    await evalJs(`document.getElementById('btn-add-to-packet').click()`);
    await wait(300);
    await evalJs(`window.__realPrint = window.print; window.print = () => { window.__packetArcs = document.querySelectorAll('#print-surface .ws-arc').length; }`);
    await evalJs(`document.getElementById('btn-print-packet').click()`);
    await wait(500);
    const packetArcs = await evalJs(`window.__packetArcs ?? -1`);
    await evalJs(`window.print = window.__realPrint`);
    await evalJs(`document.getElementById('line-stripes-toggle').click()`);
    await wait(300);
    await waitForFit();
    const stripesState = await evalJs(arcState);
    await evalJs(`document.getElementById('line-stripes-toggle').click()`);
    await evalJs(`document.getElementById('syllable-arcs-toggle').click()`);
    await wait(300);
    await setSelect('line-height-input', lineHeightBefore);
    const arcsOff = await evalJs(arcState);
    const arcsOk = arcsTight.arcs > 0 && arcsTight.arcs === arcsTight.syllables && arcsTight.printArcs === arcsTight.arcs
      && arcsTight.notices.includes('ARCS_NEED_LINE_SPACING') && arcsTight.notices.includes('DOCX_OMITS_ARCS')
      && arcsRoomy.arcs === arcsRoomy.syllables && !arcsRoomy.notices.includes('ARCS_NEED_LINE_SPACING')
      && packetArcs >= arcsRoomy.arcs && stripesState.notices.includes('DOCX_OMITS_STRIPES')
      && arcsOff.arcs === 0 && !arcsOff.notices.includes('DOCX_OMITS_ARCS');
    journeyChecks.push({
      label: 'syllable arcs: one per syllable in preview and print and in a printed packet; line-spacing and Word notices',
      ok: arcsOk,
      note: arcsOk ? `${arcsTight.arcs} arcs = ${arcsTight.syllables} syllables; packet print ${packetArcs}` : JSON.stringify({ arcsTight, arcsRoomy, packetArcs, stripesState, arcsOff })
    });

    // "Continue the text" (story starter): the title, the instruction, the
    // picture, the first sentences of the text (a strict beginning of it),
    // then copy lines; no copy-row estimate, since nothing is copied.
    console.log('Driving "Continue the text"...');
    const passageText = `[...document.querySelectorAll('#preview .ws-body .ws-sentence')].map((p) => p.textContent).join(' ')`;
    await setSelect('writing-mode-select', 'read-only');
    const fullText = await evalJs(passageText);
    await setSelect('writing-mode-select', 'starter');
    const starter = await evalJs(`(() => ({
      text: ${passageText},
      printText: [...document.querySelectorAll('#print-surface .ws-body .ws-sentence')].map((p) => p.textContent).join(' '),
      instruction: Boolean(document.querySelector('#preview .ws-instruction')),
      lines: Boolean(document.querySelector('#preview .ws-copy-area')),
      notices: [...document.querySelectorAll('#fit-notices li')].map((l) => l.dataset.notice)
    }))()`);
    await setSelect('writing-mode-select', 'read-copy');
    const squashText = (t) => t.replace(/\s+/g, ' ').trim();
    const starterOk = starter.text.length > 0 && squashText(fullText).startsWith(squashText(starter.text)) && starter.text.length < fullText.length
      && /[.!?»«"”]$/.test(starter.text.trim()) && starter.printText === starter.text
      && starter.instruction && starter.lines && !starter.notices.includes('COPY_SPACE_SHORT');
    journeyChecks.push({
      label: '"Continue the text": the instruction, the first sentences only (same in print), then lines, and no copy estimate',
      ok: starterOk,
      note: starterOk ? `"${starter.text}"` : JSON.stringify({ starter, fullText })
    });

    // Gap-fill word bank: the missing words, alphabetical, in a box above
    // the text, the same in print; gone when switched off.
    console.log('Driving the gap-fill word bank...');
    const bankState = `(() => ({
      bank: [...document.querySelectorAll('#preview .ws-word-bank-word')].map((w) => w.textContent),
      printBank: [...document.querySelectorAll('#print-surface .ws-word-bank-word')].map((w) => w.textContent),
      answers: [...document.querySelectorAll('#preview .ws-blank')].map((g) => g.textContent),
      beforeText: document.querySelector('#preview [data-block="wordBank"]')?.nextElementSibling?.dataset.block ?? null
    }))()`;
    await setSelect('writing-mode-select', 'cloze');
    await evalJs(`(() => { document.getElementById('cloze-every-nth-input').value = '4'; document.getElementById('btn-cloze-every-nth').click(); })()`);
    await wait(300);
    await waitForFit();
    await evalJs(`document.getElementById('cloze-word-bank-toggle').click()`);
    await wait(300);
    await waitForFit();
    const bankOn = await evalJs(bankState);
    await evalJs(`document.getElementById('cloze-word-bank-toggle').click()`);
    await wait(300);
    await waitForFit();
    const bankOff = await evalJs(bankState);
    await setSelect('writing-mode-select', 'read-copy');
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
    const bankOk = bankOn.bank.length > 0 && JSON.stringify(bankOn.bank) === JSON.stringify([...bankOn.answers].sort(collator.compare))
      && JSON.stringify(bankOn.printBank) === JSON.stringify(bankOn.bank) && bankOn.beforeText === 'passage' && bankOff.bank.length === 0;
    journeyChecks.push({
      label: 'gap-fill word bank: the missing words, alphabetical, in a box above the text, same in print, gone when off',
      ok: bankOk,
      note: bankOk ? bankOn.bank.join(', ') : JSON.stringify({ bankOn, bankOff })
    });

    // The teacher's own questions: typed in the sidebar, printed after the
    // text, numbered, each with its answer lines, the same in print;
    // cleared when another text is shown.
    console.log('Driving the teacher\'s own questions...');
    const questionState = `(() => ({
      preview: [...document.querySelectorAll('#preview .ws-question')].map((q) => [q.querySelector('.ws-question-text').textContent, q.querySelectorAll('svg').length]),
      print: document.querySelectorAll('#print-surface .ws-question').length,
      inputs: [...document.querySelectorAll('.question-input')].map((i) => i.value),
      afterText: (() => { const q = document.querySelector('#preview [data-block="questions"]'); return q ? q.previousElementSibling?.dataset.block : null; })()
    }))()`;
    await evalJs(`(() => { const [a, , c] = document.querySelectorAll('.question-input'); a.value = ' First question? '; a.dispatchEvent(new Event('change', { bubbles: true })); c.value = 'Third box'; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(300);
    await waitForFit();
    const typed = await evalJs(questionState);
    await evalJs(`document.getElementById('btn-create').click()`);
    await wait(300);
    await waitForFit();
    const cleared = await evalJs(questionState);
    // The boxes keep what was typed where it was typed (box 3 stays box 3),
    // trimmed; the sheet numbers the filled ones 1…n.
    const questionsOk = JSON.stringify(typed.preview) === JSON.stringify([['1. First question?', 1], ['2. Third box', 1]])
      && JSON.stringify(typed.inputs) === JSON.stringify(['First question?', '', 'Third box'])
      && typed.print === 2 && typed.afterText === 'passage'
      && cleared.preview.length === 0 && cleared.inputs.every((v) => v === '');
    journeyChecks.push({
      label: 'the teacher\'s own questions: numbered after the text with answer lines, same in print, cleared for another text',
      ok: questionsOk,
      note: questionsOk ? 'two questions, then cleared' : JSON.stringify({ typed, cleared })
    });

    // The answer key (U3b): "Show the answers" adds the "Answers" tag to the
    // preview and the print surface and prints the answers; the key goes
    // into the packet as its own sheet; off again, no tag.
    console.log('Driving the answer key...');
    const keyState = `(() => ({
      tag: document.querySelector('#preview .ws-answer-tag')?.textContent ?? null,
      printTag: document.querySelector('#print-surface .ws-answer-tag')?.textContent ?? null,
      packet: document.querySelectorAll('#packet-list li').length
    }))()`;
    await setSelect('writing-mode-select', 'cloze');
    await evalJs(`document.getElementById('btn-cloze-every-nth').click()`);
    await wait(300);
    await waitForFit();
    const keyBefore = await evalJs(keyState);
    await evalJs(`document.getElementById('show-answers-toggle').click()`);
    await wait(300);
    await waitForFit();
    const keyOn = await evalJs(keyState);
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    const keyPaint = await evalJs(`getComputedStyle(document.querySelector('#print-surface .ws-blank-answer')).visibility`);
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });
    await evalJs(`document.getElementById('btn-add-to-packet').click()`);
    await wait(300);
    const keyPacked = await evalJs(keyState);
    await evalJs(`document.getElementById('show-answers-toggle').click()`);
    await wait(300);
    await waitForFit();
    const keyOff = await evalJs(keyState);
    await setSelect('writing-mode-select', 'read-copy');
    const keyOk = keyBefore.tag === null && keyOn.tag && keyOn.printTag === keyOn.tag && keyPaint === 'visible'
      && keyPacked.packet === keyOn.packet + 1 && keyOff.tag === null && keyOff.printTag === null;
    journeyChecks.push({
      label: 'answer key: the tag on preview and print, answers printed, added to the packet, gone when switched off',
      ok: keyOk,
      note: keyOk ? `tag "${keyOn.tag}", packet ${keyOn.packet} → ${keyPacked.packet}` : JSON.stringify({ keyBefore, keyOn, keyPaint, keyPacked, keyOff })
    });

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
    // The imported text has no syllable_body, and syllable colours are on by default.
    const importNotices = await evalJs(`[...document.querySelectorAll('#fit-notices li')].map((l) => l.dataset.notice)`);
    const importOk = importNotices.includes('NO_SYLLABLE_DATA') && importStatus === 'Imported 2 text(s) for English.'
      && candidateText === 'Available: 1'
      && pickerHiddenForSingleText
      && importedTitle === 'Offline Import Check'
      && importedImageSrc.startsWith('data:image/');
    journeyChecks.push({
      label: 'importing a content pack with a new image replaces the language\'s texts for the session (a single-text cell hides the title list; a text without syllable data says so)',
      ok: importOk,
      note: importOk
        ? 'status, candidate count, hidden title list, rendered title and imported image all as expected'
        : `status="${importStatus}", candidates="${candidateText}", pickerHidden=${pickerHiddenForSingleText}, title="${importedTitle}", image=${importedImageSrc.slice(0, 20)}, notices=${importNotices}`
    });

    // "Put in order" on a text with 2 sentences (the imported one above):
    // the option is disabled and says why; forcing the mode anyway, as a
    // saved setup could, blocks the sheet with TOO_FEW_SENTENCES.
    console.log('Checking "Put in order" on a text with too few sentences...');
    const tooFewOption = await evalJs(`(() => { const o = document.querySelector('#writing-mode-select option[value="sequence"]'); return { disabled: o.disabled, label: o.textContent }; })()`);
    await evalJs(`(() => { const el = document.getElementById('writing-mode-select'); el.value = 'sequence'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const tooFewFit = await waitForFit();
    await wait(300);
    const tooFewPrintDisabled = await evalJs(`document.getElementById('btn-print').disabled`);
    await evalJs(`(() => { const el = document.getElementById('writing-mode-select'); el.value = 'read-copy'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitForFit();
    const tooFewOk = tooFewOption.disabled && /: 2\)$/.test(tooFewOption.label) && /TOO_FEW_SENTENCES/.test(tooFewFit) && tooFewPrintDisabled;
    journeyChecks.push({
      label: '"Put in order" is disabled with the reason for a 2-sentence text, and blocked (not printable) if forced',
      ok: tooFewOk,
      note: tooFewOk ? `option "${tooFewOption.label}"` : JSON.stringify({ tooFewOption, tooFewFit, tooFewPrintDisabled })
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
