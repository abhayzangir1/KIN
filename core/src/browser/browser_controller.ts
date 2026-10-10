// ============================================================================
// KIN PERSISTENT CONTROLLABLE BROWSER CONTROLLER
// Persistent browser contexts with session reuse, page inspection,
// controllable navigation, DOM extraction, and step-by-step state tracking.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { getDataDirectory } from '../storage/data_directory.js';

export interface BrowserSessionInfo {
  active: boolean;
  currentUrl?: string;
  pageTitle?: string;
  profilePath: string;
  browserExecutable?: string;
  cookiesCount?: number;
}

export interface InteractiveElement {
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  text?: string;
  placeholder?: string;
  selector: string;
  ariaLabel?: string;
  isVisible: boolean;
}

export interface PageInspectionResult {
  url: string;
  title: string;
  interactiveElements: InteractiveElement[];
  formsCount: number;
  bodySnippet: string;
}

export interface WebStepAction {
  action: 'navigate' | 'click' | 'type' | 'scroll' | 'screenshot' | 'evaluate' | 'wait';
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
  coordinates?: { x: number; y: number };
}

export interface WebStepResult {
  stepIndex: number;
  action: string;
  success: boolean;
  url: string;
  title: string;
  selector?: string;
  durationMs?: number;
  output?: any;
  error?: string;
  timestamp: number;
}

export class BrowserController {
  private browser: Browser | null = null;
  private activePage: Page | null = null;
  private profileDir: string;
  private stepHistory: WebStepResult[] = [];
  private stepCount: number = 0;
  private launchPromise: Promise<{ browser: Browser; page: Page }> | null = null;
  private lastKnownTitle: string = '';

  private agentId?: string;
  private pageProvider?: () => Promise<{ page: Page; browser?: Browser }>;

  constructor(
    customProfileDirOrOptions?:
      | string
      | {
          profileDir?: string;
          agentId?: string;
          page?: Page;
          browser?: Browser;
          pageProvider?: () => Promise<{ page: Page; browser?: Browser }>;
        }
  ) {
    if (typeof customProfileDirOrOptions === 'object' && customProfileDirOrOptions !== null) {
      this.agentId = customProfileDirOrOptions.agentId;
      if (customProfileDirOrOptions.page) {
        this.activePage = customProfileDirOrOptions.page;
      }
      if (customProfileDirOrOptions.browser) {
        this.browser = customProfileDirOrOptions.browser;
      }
      if (customProfileDirOrOptions.pageProvider) {
        this.pageProvider = customProfileDirOrOptions.pageProvider;
      }

      const dataDir = getDataDirectory();
      if (customProfileDirOrOptions.profileDir) {
        this.profileDir = customProfileDirOrOptions.profileDir;
      } else if (customProfileDirOrOptions.agentId) {
        this.profileDir = path.resolve(dataDir, '.kin', 'browser_profiles', customProfileDirOrOptions.agentId);
      } else {
        this.profileDir = path.resolve(dataDir, '.kin', 'browser_profile');
      }
    } else {
      const dataDir = getDataDirectory();
      this.profileDir =
        customProfileDirOrOptions ||
        path.resolve(dataDir, '.kin', 'browser_profile');
    }

    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }
  }

  /**
   * Finds the best installed Chromium-based browser executable on the host.
   */
  public findBrowserExecutable(): string | undefined {
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      const candidates = [
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      ];

      for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
      }
    } else {
      const macLinuxCandidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
      ];
      for (const p of macLinuxCandidates) {
        if (fs.existsSync(p)) return p;
      }
    }

    return undefined;
  }

  /**
   * Launches or reuses the persistent browser session with single-flight mutex serialization.
   */
  public async ensureBrowser(options: { headless?: boolean; remoteDebuggingUrl?: string } = {}): Promise<{ browser: Browser; page: Page }> {
    if (this.pageProvider) {
      const provided = await this.pageProvider();
      if (provided.page && !provided.page.isClosed()) {
        this.activePage = provided.page;
        if (provided.browser) this.browser = provided.browser;
        return { browser: this.browser || (provided.browser as Browser), page: this.activePage };
      }
    }

    if (this.browser && this.browser.connected) {
      if (this.activePage && !this.activePage.isClosed()) {
        return { browser: this.browser, page: this.activePage };
      }
      try {
        const pages = await this.browser.pages();
        const openPage = pages.find((p) => !p.isClosed());
        this.activePage = openPage || (await this.browser.newPage());
        return { browser: this.browser, page: this.activePage };
      } catch {
        this.browser = null;
        this.activePage = null;
      }
    }

    if (this.activePage && !this.activePage.isClosed()) {
      return { browser: this.browser as Browser, page: this.activePage };
    }

    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = (async () => {
      try {
        // 1. Check if remote debugging is available on port 9222 or custom URL
        const remoteUrl = options.remoteDebuggingUrl || process.env.KIN_REMOTE_DEBUG_URL || 'http://127.0.0.1:9222';
        try {
          const resp = await fetch(`${remoteUrl.replace(/\/$/, '')}/json/version`, {
            signal: AbortSignal.timeout(500),
          });
          if (resp.ok) {
            this.browser = await puppeteer.connect({
              browserURL: remoteUrl,
              defaultViewport: null,
            });
            this.browser.on('disconnected', () => {
              this.browser = null;
              this.activePage = null;
            });
            const pages = await this.browser.pages();
            this.activePage = pages.find((p) => !p.isClosed()) || (await this.browser.newPage());
            return { browser: this.browser, page: this.activePage };
          }
        } catch {
          // Remote debugging port not active, fallback to local launch
        }

        const executablePath = this.findBrowserExecutable();
        if (!executablePath) {
          throw new Error(
            'No compatible browser executable found (Google Chrome or Microsoft Edge required).'
          );
        }

        const headless = options.headless ?? (process.env.KIN_HEADLESS === 'true' ? true : false);

        const launchArgs = [
          '--disable-infobars',
          '--window-size=1280,800',
          '--remote-debugging-port=9222',
        ];
        if (process.env.KIN_BROWSER_NO_SANDBOX === 'true') {
          launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
        }

        this.browser = await puppeteer.launch({
          executablePath,
          headless,
          userDataDir: this.profileDir,
          defaultViewport: { width: 1280, height: 800 },
          args: launchArgs,
        });

        this.browser.on('disconnected', () => {
          this.browser = null;
          this.activePage = null;
        });

        const pages = await this.browser.pages();
        this.activePage = pages.length > 0 ? pages[0] : await this.browser.newPage();

        return { browser: this.browser, page: this.activePage };
      } finally {
        this.launchPromise = null;
      }
    })();

    return this.launchPromise;
  }

  private cookiesCount: number = 0;

  /**
   * Navigates to target URL with session cookies intact.
   */
  public async navigate(url: string, options: { recordStep?: boolean; allowLocalFileNavigation?: boolean } = {}): Promise<{ url: string; title: string; status: number; timeout?: boolean }> {
    const startTime = Date.now();
    const trimmedUrl = url.trim();
    const lower = trimmedUrl.toLowerCase();

    if ((lower.startsWith('file:') || lower.startsWith('data:')) && !options.allowLocalFileNavigation) {
      throw new Error(`ACCESS_DENIED: Scheme navigation to '${lower.split(':')[0]}:' is prohibited without explicit allowLocalFileNavigation capability.`);
    }

    const { page } = await this.ensureBrowser();
    const isLocalHost = lower.startsWith('localhost') || lower.startsWith('127.0.0.1') || lower.startsWith('::1') || lower.startsWith('[::1]');
    const formattedUrl = (
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.startsWith('about:') ||
      lower.startsWith('file:') ||
      lower.startsWith('data:')
    ) ? trimmedUrl : isLocalHost ? `http://${trimmedUrl}` : `https://${trimmedUrl}`;

    try {
      const response = await page.goto(formattedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const title = await page.title().catch(() => '');
      this.lastKnownTitle = title;
      const currentUrl = page.url();
      const status = response ? response.status() : 200;

      page.cookies().then((c) => { this.cookiesCount = c.length; }).catch(() => {});

      if (options.recordStep !== false) {
        this.recordStep(
          { action: 'navigate', url: formattedUrl },
          true,
          { status, title },
          undefined,
          Date.now() - startTime
        );
      }

      return { url: currentUrl, title, status };
    } catch (err: any) {
      const isTimeout = err.name === 'TimeoutError' || err.message?.toLowerCase().includes('timeout');
      const isTargetClosed =
        err.message?.toLowerCase().includes('target closed') ||
        err.message?.toLowerCase().includes('session closed');

      if (isTargetClosed) {
        this.activePage = null;
      }

      if (isTimeout && this.activePage && !this.activePage.isClosed()) {
        const currentUrl = this.activePage.url();
        const title = await this.activePage.title().catch(() => '');
        this.lastKnownTitle = title;
        if (currentUrl && currentUrl !== 'about:blank') {
          if (options.recordStep !== false) {
            this.recordStep(
              { action: 'navigate', url: formattedUrl },
              true,
              { status: 200, title, warning: 'Navigation timed out but page loaded' },
              undefined,
              Date.now() - startTime
            );
          }
          return { url: currentUrl, title, status: 200, timeout: true };
        }
      }

      if (options.recordStep !== false) {
        this.recordStep(
          { action: 'navigate', url: formattedUrl },
          false,
          undefined,
          err.message,
          Date.now() - startTime
        );
      }
      throw err;
    }
  }

  /**
   * Clicks an element by CSS selector or (x, y) viewport coordinates.
   */
  public async click(
    selectorOrCoords: string | { x: number; y: number },
    options: { recordStep?: boolean } = {}
  ): Promise<{ success: boolean; target: any }> {
    const startTime = Date.now();
    try {
      const { page } = await this.ensureBrowser();

      if (typeof selectorOrCoords === 'object') {
        await page.mouse.click(selectorOrCoords.x, selectorOrCoords.y);
        if (options.recordStep !== false) {
          this.recordStep(
            { action: 'click', coordinates: selectorOrCoords },
            true,
            undefined,
            undefined,
            Date.now() - startTime
          );
        }
        return { success: true, target: selectorOrCoords };
      } else {
        await page.waitForSelector(selectorOrCoords, { visible: true, timeout: 10000 });
        await page.click(selectorOrCoords);
        if (options.recordStep !== false) {
          this.recordStep(
            { action: 'click', selector: selectorOrCoords },
            true,
            undefined,
            undefined,
            Date.now() - startTime
          );
        }
        return { success: true, target: selectorOrCoords };
      }
    } catch (err: any) {
      if (err.message?.toLowerCase().includes('target closed')) {
        this.activePage = null;
      }
      if (options.recordStep !== false) {
        this.recordStep(
          typeof selectorOrCoords === 'object'
            ? { action: 'click', coordinates: selectorOrCoords }
            : { action: 'click', selector: selectorOrCoords },
          false,
          undefined,
          err.message,
          Date.now() - startTime
        );
      }
      throw err;
    }
  }

  /**
   * Types text into a form input element.
   */
  public async type(
    selector: string,
    text: string,
    options: { clear?: boolean; recordStep?: boolean } = {}
  ): Promise<{ success: boolean }> {
    const startTime = Date.now();
    try {
      const { page } = await this.ensureBrowser();
      await page.waitForSelector(selector, { visible: true, timeout: 10000 });

      if (options.clear) {
        await page.click(selector, { count: 3 });
        await page.keyboard.press('Backspace');
        await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLInputElement;
          if (el && 'value' in el) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, selector).catch(() => {});
      }

      await page.type(selector, text, { delay: 30 });
      if (options.recordStep !== false) {
        this.recordStep(
          { action: 'type', selector, text: '[REDACTED_OR_INPUT]' },
          true,
          undefined,
          undefined,
          Date.now() - startTime
        );
      }
      return { success: true };
    } catch (err: any) {
      if (err.message?.toLowerCase().includes('target closed')) {
        this.activePage = null;
      }
      if (options.recordStep !== false) {
        this.recordStep(
          { action: 'type', selector, text: '[REDACTED_OR_INPUT]' },
          false,
          undefined,
          err.message,
          Date.now() - startTime
        );
      }
      throw err;
    }
  }

  /**
   * Inspects the page and returns interactive elements for agent action synthesis.
   */
  public async inspect(selector?: string): Promise<PageInspectionResult> {
    const { page } = await this.ensureBrowser();
    const url = page.url();
    const title = await page.title();

    const inspection = await page.evaluate((targetSelector) => {
      const root = targetSelector ? document.querySelector(targetSelector) || document.body : document.body;
      const elements: any[] = [];
      const interactives = root.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [contenteditable="true"], [onclick]'
      );

      let count = 0;
      for (const el of Array.from(interactives)) {
        if (count >= 50) break; // Limit elements for model context efficiency
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(htmlEl).display !== 'none';

        if (isVisible) {
          count++;
          const tag = htmlEl.tagName.toLowerCase();
          const id = htmlEl.id || undefined;
          const name = htmlEl.getAttribute('name') || undefined;
          const type = htmlEl.getAttribute('type') || undefined;
          const text = (
            htmlEl.innerText ||
            htmlEl.getAttribute('value') ||
            htmlEl.getAttribute('aria-label') ||
            htmlEl.getAttribute('title') ||
            ''
          ).trim().slice(0, 80);
          const placeholder = htmlEl.getAttribute('placeholder') || undefined;
          const ariaLabel = htmlEl.getAttribute('aria-label') || undefined;

          let generatedSelector = tag;
          if (id) generatedSelector += `#${id}`;
          else if (name) generatedSelector += `[name="${name}"]`;
          else if (htmlEl.className && typeof htmlEl.className === 'string') {
            const firstClass = htmlEl.className.trim().split(/\s+/)[0];
            if (firstClass) generatedSelector += `.${firstClass}`;
          }

          elements.push({
            tag,
            id,
            name,
            type,
            text,
            placeholder,
            selector: generatedSelector,
            ariaLabel,
            isVisible,
          });
        }
      }

      const formsCount = document.querySelectorAll('form').length;
      const bodySnippet = document.body.innerText.slice(0, 1000).replace(/\s+/g, ' ');

      return {
        elements,
        formsCount,
        bodySnippet,
      };
    }, selector);

    return {
      url,
      title,
      interactiveElements: inspection.elements,
      formsCount: inspection.formsCount,
      bodySnippet: inspection.bodySnippet,
    };
  }

  /**
   * Captures a base64 screenshot of the active browser page.
   */
  public async screenshot(): Promise<{ base64: string; mimeType: string }> {
    const { page } = await this.ensureBrowser();
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    const base64 = Buffer.from(buffer).toString('base64');
    return { base64, mimeType: 'image/png' };
  }

  /**
   * Evaluates JavaScript directly in the active browser page context.
   */
  public async evaluate(script: string): Promise<any> {
    const { page } = await this.ensureBrowser();
    return page.evaluate((code) => {
      // eslint-disable-next-line no-eval
      return window.eval(code);
    }, script);
  }

  /**
   * Executes a structured web automation step with state and trajectory tracking.
   */
  public async executeStep(stepAction: WebStepAction, abortSignal?: AbortSignal): Promise<WebStepResult> {
    const startTime = Date.now();
    if (abortSignal?.aborted) {
      return this.recordStep(stepAction, false, null, 'Browser step cancelled by operator via AbortSignal.', 0);
    }
    try {
      const { page } = await this.ensureBrowser();
      let output: any = null;

      switch (stepAction.action) {
        case 'navigate': {
          if (!stepAction.url) throw new Error('Missing url parameter for navigate action');
          output = await this.navigate(stepAction.url, { recordStep: false });
          break;
        }
        case 'click': {
          if (stepAction.selector) {
            output = await this.click(stepAction.selector, { recordStep: false });
          } else if (stepAction.coordinates) {
            output = await this.click(stepAction.coordinates, { recordStep: false });
          } else {
            throw new Error('Missing selector or coordinates parameter for click action');
          }
          break;
        }
        case 'type': {
          if (!stepAction.selector || stepAction.text === undefined) {
            throw new Error('Missing selector or text parameter for type action');
          }
          output = await this.type(stepAction.selector, stepAction.text, { clear: false, recordStep: false });
          break;
        }
        case 'screenshot': {
          output = await this.screenshot();
          break;
        }
        case 'evaluate': {
          if (!stepAction.script) throw new Error('Missing script parameter for evaluate action');
          output = await this.evaluate(stepAction.script);
          break;
        }
        case 'scroll': {
          if (stepAction.selector) {
            output = await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return { scrolled: true, selector: sel };
              }
              return { scrolled: false, error: 'Element not found' };
            }, stepAction.selector);
          } else {
            const deltaY = stepAction.coordinates?.y ?? 500;
            const deltaX = stepAction.coordinates?.x ?? 0;
            output = await page.evaluate((dx, dy) => {
              window.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
              return { scrolled: true, x: window.scrollX, y: window.scrollY };
            }, deltaX, deltaY);
          }
          break;
        }
        case 'wait': {
          if (abortSignal?.aborted) throw new Error('Browser step cancelled by operator via AbortSignal.');
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              if (cleanup) cleanup();
              resolve();
            }, 1500);
            let cleanup: (() => void) | undefined;
            if (abortSignal) {
              const onAbort = () => {
                clearTimeout(timer);
                reject(new Error('Browser step cancelled by operator via AbortSignal.'));
              };
              abortSignal.addEventListener('abort', onAbort, { once: true });
              cleanup = () => abortSignal.removeEventListener('abort', onAbort);
            }
          });
          output = { waitedMs: 1500 };
          break;
        }
        default:
          throw new Error(`Unsupported browser step action '${stepAction.action}'`);
      }

      const durationMs = Date.now() - startTime;
      return this.recordStep(stepAction, true, output, undefined, durationMs);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      return this.recordStep(stepAction, false, undefined, err.message, durationMs);
    }
  }

  /**
   * Returns current status and telemetry of the browser session.
   */
  public getStatus(): BrowserSessionInfo {
    const isConnected = Boolean(this.browser && this.browser.connected);
    const currentUrl = isConnected && this.activePage && !this.activePage.isClosed() ? this.activePage.url() : undefined;

    return {
      active: isConnected,
      currentUrl,
      pageTitle: isConnected && this.activePage && !this.activePage.isClosed() ? this.lastKnownTitle : undefined,
      profilePath: this.profileDir,
      browserExecutable: this.findBrowserExecutable(),
      cookiesCount: this.cookiesCount,
    };
  }

  /**
   * Returns all executed web automation steps for trajectory auditing.
   */
  public getStepHistory(): WebStepResult[] {
    return [...this.stepHistory];
  }

  /**
   * Closes the active browser session.
   */
  public async close(): Promise<void> {
    this.launchPromise = null;
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
      this.activePage = null;
    }
  }

  private recordStep(
    action: WebStepAction,
    success: boolean,
    output?: any,
    error?: string,
    durationMs?: number
  ): WebStepResult {
    this.stepCount++;
    const url = this.activePage && !this.activePage.isClosed() ? this.activePage.url() : '';
    const title = output?.title || this.lastKnownTitle || '';
    const result: WebStepResult = {
      stepIndex: this.stepCount,
      action: action.action,
      selector: action.selector,
      durationMs,
      success,
      url,
      title,
      output,
      error,
      timestamp: Date.now(),
    };
    this.stepHistory.push(result);
    return result;
  }
}
