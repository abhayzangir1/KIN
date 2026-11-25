// ============================================================================
// KIN PERSISTENT CONTROLLABLE BROWSER CONTROLLER
// Persistent browser contexts with session reuse, page inspection,
// controllable navigation, DOM extraction, and step-by-step state tracking.
// ============================================================================

import * as fs from 'node:fs';
import * as dns from 'node:dns';
import * as path from 'node:path';
import * as os from 'node:os';
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
  somId?: number;
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  text?: string;
  placeholder?: string;
  selector: string;
  ariaLabel?: string;
  isVisible: boolean;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface AxNodeSummary {
  role: string;
  name?: string;
  value?: string;
}

export interface PageInspectionResult {
  url: string;
  title: string;
  interactiveElements: InteractiveElement[];
  formsCount: number;
  bodySnippet: string;
  axNodes?: AxNodeSummary[];
  consoleLogs?: string[];
  networkErrors?: string[];
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
  private static readonly activeControllers = new Set<BrowserController>();
  private static exitHookInstalled = false;

  private static ensureExitHook(): void {
    if (this.exitHookInstalled) return;
    this.exitHookInstalled = true;
    process.once('exit', () => {
      for (const ctrl of BrowserController.activeControllers) {
        try {
          if (ctrl.browser) {
            const proc = typeof (ctrl.browser as any).process === 'function' ? (ctrl.browser as any).process() : null;
            if (proc && !proc.killed) {
              proc.kill('SIGKILL');
            }
          }
        } catch {
          // Suppressed during process termination
        }
      }
      BrowserController.activeControllers.clear();
    });
  }

  private browser: Browser | null = null;
  private activePage: Page | null = null;
  private profileDir: string;
  private stepHistory: WebStepResult[] = [];
  private stepCount: number = 0;
  private launchPromise: Promise<{ browser: Browser; page: Page }> | null = null;
  private lastKnownTitle: string = '';

  private agentId?: string;
  private pageProvider?: () => Promise<{ page: Page; browser?: Browser }>;
  private onClose?: () => Promise<void> | void;

  constructor(
    customProfileDirOrOptions?:
      | string
      | {
          profileDir?: string;
          agentId?: string;
          page?: Page;
          browser?: Browser;
          pageProvider?: () => Promise<{ page: Page; browser?: Browser }>;
          onClose?: () => Promise<void> | void;
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
      if (customProfileDirOrOptions.onClose) {
        this.onClose = customProfileDirOrOptions.onClose;
      }

      const dataDir = getDataDirectory();
      const isTestEnv = !!(process.env.VITEST || process.env.NODE_ENV === 'test');
      const defaultProfile = isTestEnv
        ? path.resolve(os.tmpdir(), '.kin_test_browser_profile_' + Math.random().toString(36).slice(2))
        : path.resolve(dataDir, '.kin', 'browser_profile');

      if (customProfileDirOrOptions.profileDir) {
        this.profileDir = customProfileDirOrOptions.profileDir;
      } else if (customProfileDirOrOptions.agentId) {
        this.profileDir = path.resolve(dataDir, '.kin', 'browser_profiles', customProfileDirOrOptions.agentId);
      } else {
        this.profileDir = defaultProfile;
      }
    } else {
      const dataDir = getDataDirectory();
      const isTestEnv = !!(process.env.VITEST || process.env.NODE_ENV === 'test');
      const defaultProfile = isTestEnv
        ? path.resolve(os.tmpdir(), '.kin_test_browser_profile_' + Math.random().toString(36).slice(2))
        : path.resolve(dataDir, '.kin', 'browser_profile');
      this.profileDir = customProfileDirOrOptions || defaultProfile;
    }

    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }
  }

  /**
   * Finds the best installed Chromium-based browser executable on the host.
   */
  public static findBrowserExecutable(): string | undefined {
    // 0. Explicit environment variable overrides
    const envOverrides = [
      process.env.KIN_BROWSER_PATH,
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_BIN,
    ];
    for (const p of envOverrides) {
      if (!p) continue;
      if (fs.existsSync(p)) return p;
      if (!p.includes('/') && !p.includes('\\') && process.platform !== 'win32') return p;
    }

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
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
      ];
      for (const p of macLinuxCandidates) {
        if (fs.existsSync(p)) return p;
      }
    }

    return undefined;
  }

  public findBrowserExecutable(): string | undefined {
    return BrowserController.findBrowserExecutable();
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
        if (openPage) {
          this.activePage = openPage;
        } else {
          this.activePage = await this.browser.newPage();
          this.attachRingBuffers(this.activePage);
        }
        return { browser: this.browser, page: this.activePage };
      } catch {
        this.browser = null;
        this.activePage = null;
      }
    }

    if (this.activePage && !this.activePage.isClosed() && this.browser?.connected) {
      return { browser: this.browser, page: this.activePage };
    }

    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = (async () => {
      try {
        // 1. Check if remote debugging is explicitly configured via options or env var
        const remoteUrl = options.remoteDebuggingUrl || process.env.KIN_REMOTE_DEBUG_URL;
        if (remoteUrl) {
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
                BrowserController.activeControllers.delete(this);
                this.browser = null;
                this.activePage = null;
              });
              BrowserController.ensureExitHook();
              BrowserController.activeControllers.add(this);
              const pages = await this.browser.pages();
              this.activePage = pages.find((p) => !p.isClosed()) || (await this.browser.newPage());
              this.attachRingBuffers(this.activePage);
              return { browser: this.browser, page: this.activePage };
            }
          } catch (err) { console.debug("[browser_controller] Suppressed exception in catch block:", err); }
        }

        const executablePath = this.findBrowserExecutable();
        if (!executablePath) {
          throw new Error(
            'No compatible browser executable found (Google Chrome or Microsoft Edge required).'
          );
        }

        const headless = options.headless ?? (process.env.KIN_HEADLESS === 'true' || process.env.CI === 'true' || (!process.env.DISPLAY && process.platform === 'linux'));

        const launchArgs = [
          '--disable-infobars',
          '--window-size=1280,800',
        ];
        const isContainerizedLinux = process.platform === 'linux' && (
          process.env.CI === 'true' ||
          process.env.CONTAINER === 'true' ||
          fs.existsSync('/.dockerenv') ||
          fs.existsSync('/run/.containerenv') ||
          (typeof process.getuid === 'function' && process.getuid() === 0)
        );

        if (process.env.KIN_BROWSER_NO_SANDBOX === 'true' || isContainerizedLinux) {
          launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
        }

        if (process.platform === 'linux' || process.env.CI === 'true') {
          launchArgs.push('--disable-dev-shm-usage', '--disable-gpu');
        }

        this.browser = await puppeteer.launch({
          executablePath,
          headless,
          userDataDir: this.profileDir,
          defaultViewport: { width: 1280, height: 800 },
          args: launchArgs,
        });

        this.browser.on('disconnected', () => {
          BrowserController.activeControllers.delete(this);
          this.browser = null;
          this.activePage = null;
        });

        BrowserController.ensureExitHook();
        BrowserController.activeControllers.add(this);

        const pages = await this.browser.pages();
        this.activePage = pages.length > 0 ? pages[0] : await this.browser.newPage();
        this.attachRingBuffers(this.activePage);

        return { browser: this.browser, page: this.activePage };
      } finally {
        this.launchPromise = null;
      }
    })();

    return this.launchPromise;
  }

  private cookiesCount: number = 0;
  private consoleRingBuffer: string[] = [];
  private networkErrorBuffer: string[] = [];
  private ringBufferAttachedPages = new WeakSet<object>();

  private attachRingBuffers(page: Page): void {
    if (!page || this.ringBufferAttachedPages.has(page as any)) return;
    this.ringBufferAttachedPages.add(page as any);
    if (typeof (page as any).on !== 'function') return;
    try {
      page.on('console', (msg: any) => {
        const line = `[${msg?.type?.() || 'log'}] ${msg?.text?.() || ''}`.slice(0, 300);
        this.consoleRingBuffer.push(line);
        if (this.consoleRingBuffer.length > 50) this.consoleRingBuffer.shift();
      });
      page.on('requestfailed', (req: any) => {
        const line = `FAILED ${req?.method?.() || 'GET'} ${req?.url?.() || ''} (${req?.failure?.()?.errorText || 'unknown'})`.slice(0, 300);
        this.networkErrorBuffer.push(line);
        if (this.networkErrorBuffer.length > 30) this.networkErrorBuffer.shift();
      });
      page.on('response', (res: any) => {
        const status = typeof res?.status === 'function' ? res.status() : 0;
        if (status >= 400) {
          const line = `HTTP_${status} ${res?.url?.() || ''}`.slice(0, 300);
          this.networkErrorBuffer.push(line);
          if (this.networkErrorBuffer.length > 30) this.networkErrorBuffer.shift();
        }
      });
      if (typeof (page as any).setRequestInterception === 'function') {
        page.on('request', (req: any) => {
          try {
            const reqUrl = String(req?.url?.() || '');
            const parsed = new URL(reqUrl);
            const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
            if (
              host === '169.254.169.254' ||
              host === '100.100.100.200' ||
              host === 'fd00:ec2::254' ||
              host === 'metadata.google.internal' ||
              host === 'instance-data' ||
              host.endsWith('.metadata.google.internal') ||
              host.startsWith('169.254.')
            ) {
              void req.abort('accessdenied');
              return;
            }
          } catch {
            // Non-URL schemes (data:, about:, blob:)
          }
          void req.continue();
        });
        void (page as any).setRequestInterception(true).catch(() => {});
      }
    } catch {
      // Ignore if mock page in unit test
    }
  }

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

    const isLocalHost = /^(https?:\/\/)?(localhost|127\.0\.0\.1|::1|\[::1\])(:\d+)?(\/|$)/.test(lower);
    const formattedUrl = (
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.startsWith('about:') ||
      lower.startsWith('file:') ||
      lower.startsWith('data:')
    ) ? trimmedUrl : isLocalHost ? `http://${trimmedUrl}` : `https://${trimmedUrl}`;

    try {
      const parsed = new URL(formattedUrl);
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const isIntegerIp = /^[0-9]+$/.test(host);
      const isHexOrOctalIp = /^0x[0-9a-f]+$/i.test(host) || (/^0[0-7.]+$/.test(host) && host !== '0');
      let decodedHost = host;
      if (isIntegerIp) {
        const num = parseInt(host, 10);
        if (num >= 0 && num <= 0xffffffff) {
          decodedHost = `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
        }
      } else if (host.startsWith('::ffff:')) {
        decodedHost = host.slice('::ffff:'.length);
      }
      const isBlockedIpv4 = (ip: string): boolean => {
        const parts = ip.split('.').map((p) => Number(p));
        if (parts.length !== 4 || !parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return false;
        if (parts[0] === 0 || parts[0] === 10 || parts[0] >= 224) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 192 && parts[1] === 168) return true;
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
        if (!isLocalHost && parts[0] === 127) return true;
        return false;
      };
      const isBlockedResolvedIp = (ip: string): boolean => {
        const clean = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
        if (clean === '::' || clean === '0:0:0:0:0:0:0:0') return true;
        if (!isLocalHost && (clean === '::1' || clean === '0:0:0:0:0:0:0:1')) return true;
        if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:') || clean.startsWith('ff')) return true;
        const ipv4Part = clean.startsWith('::ffff:') ? clean.slice('::ffff:'.length) : clean;
        return isBlockedIpv4(ipv4Part) || ipv4Part === '100.100.100.200';
      };
      if (
        isHexOrOctalIp ||
        host === '0.0.0.0' ||
        host === '169.254.169.254' ||
        decodedHost === '169.254.169.254' ||
        host === '100.100.100.200' ||
        decodedHost === '100.100.100.200' ||
        host === 'fd00:ec2::254' ||
        host === 'metadata.google.internal' ||
        host === 'instance-data' ||
        host.endsWith('.metadata.google.internal') ||
        isBlockedResolvedIp(host) ||
        isBlockedResolvedIp(decodedHost)
      ) {
        throw new Error(`ACCESS_DENIED: Navigation to cloud metadata service or restricted IP '${host}' is blocked for security.`);
      }
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && host && !isLocalHost) {
        try {
          const addrs = await dns.promises.lookup(host, { all: true });
          for (const a of addrs) {
            if (isBlockedResolvedIp(a.address)) {
              throw new Error(`ACCESS_DENIED: Hostname '${host}' resolves to blocked internal/metadata IP '${a.address}'.`);
            }
          }
        } catch (dnsErr: any) {
          if (dnsErr?.message?.startsWith('ACCESS_DENIED')) throw dnsErr;
        }
      }
    } catch (err: any) {
      if (err.message?.startsWith('ACCESS_DENIED')) throw err;
    }

    const { page } = await this.ensureBrowser();
    this.consoleRingBuffer = [];
    this.networkErrorBuffer = [];

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
   * Inspects the page with deep Shadow DOM / same-origin iframe traversal,
   * Set-of-Mark bounding boxes, CDP Accessibility Tree, and console/network ring buffers.
   */
  public async inspect(selector?: string): Promise<PageInspectionResult> {
    const { page } = await this.ensureBrowser();
    this.attachRingBuffers(page);
    const url = page.url();
    const title = await page.title();

    const inspection = await page.evaluate((targetSelector) => {
      const root = targetSelector ? document.querySelector(targetSelector) || document.body : document.body;
      const elements: any[] = [];
      const selectorQuery =
        'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [contenteditable="true"], [onclick]';

      const collectFromRoot = (nodeRoot: Document | ShadowRoot | Element, offsetX = 0, offsetY = 0) => {
        if (elements.length >= 60) return;
        const interactives = nodeRoot.querySelectorAll(selectorQuery);
        for (const el of Array.from(interactives)) {
          if (elements.length >= 60) break;
          const htmlEl = el as HTMLElement;
          const rect = htmlEl.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(htmlEl).display !== 'none';
          if (isVisible) {
            const somId = elements.length + 1;
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
              somId,
              tag,
              id,
              name,
              type,
              text,
              placeholder,
              selector: generatedSelector,
              ariaLabel,
              isVisible,
              rect: {
                x: Math.round(rect.left + offsetX),
                y: Math.round(rect.top + offsetY),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            });
          }
        }

        // Traverse open Shadow DOM roots and same-origin iframes
        const allNodes = nodeRoot.querySelectorAll('*');
        for (const el of Array.from(allNodes)) {
          if (elements.length >= 60) break;
          if ((el as any).shadowRoot) {
            collectFromRoot((el as any).shadowRoot, offsetX, offsetY);
          }
          if (el.tagName === 'IFRAME') {
            try {
              const doc = (el as HTMLIFrameElement).contentDocument;
              if (doc) {
                const frameRect = el.getBoundingClientRect();
                collectFromRoot(doc, offsetX + frameRect.left, offsetY + frameRect.top);
              }
            } catch {
              // Cross-origin iframe
            }
          }
        }
      };

      if (root) collectFromRoot(root);
      const formsCount = document.querySelectorAll('form').length;
      const bodySnippet = document.body.innerText.slice(0, 1000).replace(/\s+/g, ' ');

      return {
        elements,
        formsCount,
        bodySnippet,
      };
    }, selector);

    let axNodes: AxNodeSummary[] | undefined;
    try {
      const target = typeof (page as any).target === 'function' ? (page as any).target() : null;
      if (target && typeof target.createCDPSession === 'function') {
        const cdp = await target.createCDPSession();
        const axRes = await cdp.send('Accessibility.getFullAXTree');
        await cdp.detach?.();
        if (Array.isArray(axRes?.nodes)) {
          axNodes = axRes.nodes
            .filter((n: any) => !n.ignored && n.role?.value && n.role.value !== 'none' && (n.name?.value || n.value?.value))
            .slice(0, 60)
            .map((n: any) => ({
              role: String(n.role.value),
              name: n.name?.value ? String(n.name.value).slice(0, 100) : undefined,
              value: n.value?.value ? String(n.value.value).slice(0, 100) : undefined,
            }));
        }
      }
    } catch {
      // CDP AXTree optional if running against minimal mock page
    }

    return {
      url,
      title,
      interactiveElements: inspection.elements,
      formsCount: inspection.formsCount,
      bodySnippet: inspection.bodySnippet,
      ...(axNodes && axNodes.length > 0 ? { axNodes } : {}),
      ...(this.consoleRingBuffer.length > 0 ? { consoleLogs: [...this.consoleRingBuffer] } : {}),
      ...(this.networkErrorBuffer.length > 0 ? { networkErrors: [...this.networkErrorBuffer] } : {}),
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
   * Evaluates JavaScript directly in the active browser page context via Chrome DevTools Protocol.
   * Avoids DOM window.eval to maintain strict compatibility with sites enforcing CSP 'unsafe-eval' restrictions.
   */
  public async evaluate(script: string, timeoutMs: number = 20000): Promise<any> {
    const { page } = await this.ensureBrowser();
    const runEval = () => {
      return page.evaluate(script);
    };
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        runEval(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Browser evaluate() timed out after ${timeoutMs}ms`)), timeoutMs);
          if (typeof (timer as any).unref === 'function') (timer as any).unref();
        }),
      ]);
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('target closed') || msg.includes('session closed') || msg.includes('detached')) {
        this.activePage = null;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
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
    BrowserController.activeControllers.delete(this);
    if (this.onClose) {
      try {
        await this.onClose();
      } catch (err) {
        console.debug('[browser_controller] Suppressed exception in onClose:', err);
      }
      this.browser = null;
      this.activePage = null;
      return;
    }
    if (this.browser) {
      const proc = typeof (this.browser as any).process === 'function' ? (this.browser as any).process() : null;
      try {
        await this.browser.close();
      } catch (err) { console.debug("[browser_controller] Suppressed exception in catch block:", err); }
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch (err) { console.debug("[browser_controller] Suppressed exception in catch block:", err); }
      }
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
    let url = '';
    try {
      url = this.activePage && !this.activePage.isClosed() ? this.activePage.url() : '';
    } catch {
      url = '';
    }
    const title = output?.title || this.lastKnownTitle || '';
    const sanitizedOutput = output && typeof output === 'object' && typeof output.base64 === 'string'
      ? { ...output, base64: `[screenshot omitted: ${output.base64.length} chars]` }
      : output;
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
    const historyEntry: WebStepResult = {
      ...result,
      output: sanitizedOutput,
    };

    // Rolling memory limit: prevent unbounded growth in long-running sessions
    const MAX_STEP_HISTORY = 100;
    if (this.stepHistory.length >= MAX_STEP_HISTORY) {
      this.stepHistory.splice(0, this.stepHistory.length - MAX_STEP_HISTORY + 1);
    }
    this.stepHistory.push(historyEntry);
    return result;
  }
}
