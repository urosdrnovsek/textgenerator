/**
 * Drives a real headless Chromium over the DevTools protocol, for the
 * verify-* scripts and the tools in Instructions/tools. Each launch gets its
 * own profile directory (a shared one can hand off to a desktop Chromium
 * and hang), removed again by close().
 *
 * The page snippets at the end are plain JavaScript source, so the Firefox
 * check (selenium) uses the same ones.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LANGUAGE_CODES } from '../../src/languages.js';

/** The development machine's Chromium; CI sets CHROMIUM_BIN. */
export const CHROMIUM_BIN = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';

/** @param {number} ms */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One DevTools connection: numbered requests, and every event to every listener. */
class CdpClient {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this.lastId = 0;
    /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }>} */
    this.pending = new Map();
    /** @type {Array<(method: string, params: any) => void>} */
    this.listeners = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const request = this.pending.get(message.id);
      if (request) {
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message.method, message.params);
      }
    });
  }

  /**
   * @param {string} method e.g. "Page.navigate"
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  send(method, params = {}) {
    const id = ++this.lastId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** @param {(method: string, params: any) => void} listener */
  on(listener) {
    this.listeners.push(listener);
  }
}

/**
 * @param {number} port
 */
async function waitForEndpoint(port) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return;
    } catch {
      // not up yet
    }
    await wait(200);
  }
  throw new Error('Chromium DevTools endpoint never came up');
}

/**
 * Starts Chromium with one page and returns what the scripts drive it with.
 * Page and Runtime events are on; console errors and exceptions are
 * collected in `errors`. Downloads (when `downloadDir` is given) are
 * followed through completedDownloads() and waitForDownload().
 * @param {object} options
 * @param {number} options.port a DevTools port no other running script uses
 * @param {string[]} [options.args] extra command-line flags
 * @param {string} [options.downloadDir] where downloads go
 */
export async function launchChromium({ port, args = [], downloadDir }) {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-chromium-'));
  const chrome = spawn(
    CHROMIUM_BIN,
    [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${profileDir}`,
      ...args,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  async function close() {
    chrome.kill();
    // Give Chromium a moment to release its profile's file locks: removing
    // it at once can fail with ENOTEMPTY.
    await wait(500);
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }

  try {
    await waitForEndpoint(port);
    const created = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    /** @type {string[]} console errors and uncaught exceptions */
    const errors = [];
    /** @type {any[]} Browser.downloadProgress events */
    const downloads = [];
    let loaded = false;
    cdp.on((method, params) => {
      if (method === 'Page.loadEventFired') loaded = true;
      if (method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(params.exceptionDetails));
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        errors.push((params.args || []).map((a) => a.value ?? a.description).join(' '));
      }
      if (method === 'Browser.downloadProgress') downloads.push(params);
    });
    if (downloadDir) {
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    }

    /**
     * Evaluates an expression in the page and returns its value.
     * @param {string} expression
     * @param {boolean} [awaitPromise]
     */
    async function evalJs(expression, awaitPromise = false) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (result.exceptionDetails) throw new Error(`JS error: ${JSON.stringify(result.exceptionDetails)}`);
      return result.result.value;
    }

    /**
     * Opens a local file and waits for its load event.
     * @param {string} filePath absolute
     */
    async function open(filePath) {
      loaded = false;
      await cdp.send('Page.navigate', { url: `file://${filePath}` });
      for (let i = 0; i < 40 && !loaded; i++) await wait(250);
      if (!loaded) throw new Error(`${filePath} never fired its load event`);
      await wait(300);
    }

    /** Waits until the fit line no longer says it is measuring, and returns its text. */
    async function waitForFit() {
      for (let i = 0; i < 20; i++) {
        await wait(250);
        const fitText = await evalJs(pageScripts.fitText());
        if (fitText && !MEASURING.test(fitText)) return fitText;
      }
      throw new Error('fit check never settled');
    }

    /** How many downloads have finished so far: take it before the click that starts one. */
    const completedDownloads = () => downloads.filter((e) => e.state === 'completed');

    /**
     * Waits for the next download to finish.
     * @param {number} completedBefore completedDownloads().length before the click
     * @returns {Promise<any | null>} its Browser.downloadProgress event (with the guid); null after 8 s without one
     */
    async function waitForDownload(completedBefore) {
      for (let i = 0; i < 40; i++) {
        const completed = completedDownloads();
        if (completed.length > completedBefore) return completed[completed.length - 1];
        await wait(200);
      }
      return null;
    }

    return { cdp, evalJs, open, waitForFit, completedDownloads, waitForDownload, errors, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * The fit line while it says "Measuring…", in each interface language: read
 * from the locale files, so a new language needs nothing here.
 */
export const MEASURING = new RegExp(localeStrings('fit.measuring')
  .map((text) => escapeRegExp(text.replace(/…$/, '')))
  .join('|'), 'i');

/** The fit line of a sheet that fits on one page ("Fits on one page — …"), in each interface language. */
export const FITS = new RegExp(`^(${localeStrings('fit.fits')
  .map((text) => escapeRegExp(text.split(' — ')[0]))
  .join('|')})`, 'i');

/**
 * @param {string} key
 * @returns {string[]} that string in every registered language's locale file
 */
function localeStrings(key) {
  return LANGUAGE_CODES.map((code) => JSON.parse(readFileSync(new URL(`../../locales/${code}.json`, import.meta.url), 'utf8')).strings[key]);
}

/** @param {string} text a locale string, matched literally */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Page-side JavaScript, as source text, for either driver.
 */
export const pageScripts = {
  /**
   * Sets a control and fires `change`, as a person would: a checkbox is
   * ticked or not, anything else takes the value.
   * @param {string} id
   * @param {string | number | boolean} value
   */
  setField: (id, value) => `(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (el.type === 'checkbox') el.checked = ${JSON.stringify(Boolean(value))};
    else el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`,

  /** @param {string} id */
  click: (id) => `document.getElementById(${JSON.stringify(id)}).click()`,

  fitText: () => `document.getElementById('fit-indicator')?.textContent || ''`
};
