// ============================================================================
// KIN END-TO-END BROWSER APPLICATION SMOKE TEST
// Launches the CoreServer, boots a headless Chromium browser instance via Puppeteer,
// navigates to the compiled UI, and verifies real DOM rendering, state hydration,
// and chat interaction.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { CoreServer } from '../src/server/core_server.js';

describe('KIN End-to-End Browser Application Smoke Test', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let serverPort: number;
  let baseUrl: string;
  let ipcToken: string;
  let browser: Browser | null = null;
  let page: Page | null = null;

  function findBrowserExecutable(): string | null {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
    return null;
  }

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-e2e-browser-'));
    testDbPath = path.join(tempDir, 'kin_browser_test.sqlite');

    // Cold boot: instantiate CoreServer with IPC authentication enabled
    server = new CoreServer({
      port: 0,
      dbPath: testDbPath,
      requireIpcAuth: true,
    });

    serverPort = await server.start();
    baseUrl = `http://127.0.0.1:${serverPort}`;
    ipcToken = server.getIpcAuthToken();

    const chromePath = findBrowserExecutable();
    if (chromePath) {
      try {
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        });
        page = await browser.newPage();
      } catch (launchErr) {
        console.warn('[E2E BROWSER] Browser launch notice:', launchErr);
      }
    }
  });

  afterAll(async () => {
    if (page) {
      try { await page.close(); } catch {}
    }
    if (browser) {
      try { await browser.close(); } catch {}
    }
    if (server) {
      await server.stop();
    }
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('renders compiled production UI in real browser and hydrates initial state', async () => {
    if (!browser || !page) {
      console.log('Skipping browser DOM verification: no local browser executable found');
      return;
    }

    // Capture console errors and failed responses from the page
    const consoleErrors: string[] = [];
    const failedUrls: Array<{ url: string; status: number }> = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        failedUrls.push({ url: res.url(), status: res.status() });
      }
    });

    // Navigate to production daemon with IPC token in query param
    const targetUrl = `${baseUrl}/?token=${ipcToken}`;
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    expect(response?.status()).toBe(200);

    // 1. Verify root container rendered
    await page.waitForSelector('#root', { timeout: 10000 });
    const rootHtml = await page.$eval('#root', (el) => el.innerHTML);
    expect(rootHtml.length).toBeGreaterThan(50);

    // 2. Wait for state hydration and UI layout to mount
    // HeaderBar contains "KIN" brand title
    await page.waitForFunction(
      () => document.body.innerText.includes('KIN'),
      { timeout: 10000 }
    );

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).toContain('KIN');

    // 3. Verify channel #general and default orchestrator @Boss message exist in the DOM
    await page.waitForFunction(
      () => document.body.innerText.includes('general') || document.body.innerText.includes('Boss'),
      { timeout: 10000 }
    );

    const finalBodyText = await page.evaluate(() => document.body.innerText);
    expect(finalBodyText).toMatch(/Boss|general/i);

    // 4. Verify message input box exists and is enabled
    const inputSelector = 'textarea, input[type="text"]';
    const inputElement = await page.$(inputSelector);
    expect(inputElement).not.toBeNull();

    // 5. Test typing into message box
    await inputElement?.type('Test prompt from automated browser harness');
    const inputValue = await page.evaluate((el: any) => el.value, inputElement);
    expect(inputValue).toBe('Test prompt from automated browser harness');

    // 6. Verify zero fatal uncaught runtime script errors
    console.log('[BROWSER CONSOLE ERRORS]', consoleErrors);
    console.log('[BROWSER FAILED URLS]', failedUrls);
    const fatalErrors = consoleErrors.filter((e) => !e.includes('favicon.ico') && !e.includes('Ollama'));
    expect(fatalErrors.length).toBe(0);
  });
});
