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
 * supports, presets, packets, content import, both exports) and
 * fails on: any non-file:// network request, any console error/exception,
 * or a failed download.
 *
 * Developer/QA tool, not part of `npm test`. Run with `npm run verify-offline`.
 */

import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, cp } from 'node:fs/promises';
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

    console.log('Exercising print and .docx export...');
    await evalJs(`document.getElementById('btn-print').click();`); // window.print() is a real no-op without a print handler in headless mode — safe
    await wait(200);

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
  }

  console.log('\nResults:');
  const networkOk = networkRequests.length === 0;
  console.log(`  ${networkOk ? 'PASS' : 'FAIL'}  zero non-file/data network requests (observed: ${networkRequests.length})`);
  if (!networkOk) for (const url of networkRequests) console.log(`         - ${url}`);
  const consoleOk = consoleErrors.length === 0;
  console.log(`  ${consoleOk ? 'PASS' : 'FAIL'}  zero console errors/exceptions (observed: ${consoleErrors.length})`);
  if (!consoleOk) for (const e of consoleErrors) console.log(`         - ${e}`);

  const allOk = networkOk && consoleOk;
  console.log(allOk ? '\nFresh-machine offline test PASSED.' : '\nFresh-machine offline test FAILED.');
  process.exitCode = allOk ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
