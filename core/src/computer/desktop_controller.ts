// ============================================================================
// KIN DESKTOP & LOCAL COMPUTER USE CONTROLLER
// Coherent display inspection, screen capture, mouse/keyboard interaction,
// application discovery, launch, and window lifecycle management.
// ============================================================================

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DisplayInfo {
  id: string;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor: number;
}

export interface DiscoveredApp {
  id: string;
  name: string;
  executablePath: string;
  category: 'development' | 'browser' | 'communication' | 'productivity' | 'system' | 'other';
  source?: string;
  icon?: string;
  version?: string;
}

export interface WindowInfo {
  handle: string;
  title: string;
  processName: string;
  pid: number;
  isForeground: boolean;
}

export interface CaptureResult {
  base64: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  timestamp: number;
  isHeadless?: boolean;
  sessionId?: number;
  interactive?: boolean;
  notice?: string;
}

export interface InteractionResult {
  success: boolean;
  action: string;
  details?: Record<string, any>;
  error?: string;
  activated?: boolean;
  focusLocked?: boolean;
  notice?: string;
}

export class DesktopController {
  private isWindows: boolean = process.platform === 'win32';
  private cachedWindows: { data: WindowInfo[]; timestamp: number } | null = null;
  private pendingListPromise: Promise<WindowInfo[]> | null = null;

  /**
   * Discovers installed desktop applications across common directories,
   * registry keys, and known developer tools.
   */
  public async discoverInstalledApps(): Promise<DiscoveredApp[]> {
    const apps: DiscoveredApp[] = [];
    const seenPaths = new Set<string>();

    const addApp = (name: string, exePath: string, category: DiscoveredApp['category'], version?: string) => {
      const normalized = path.normalize(exePath).toLowerCase();
      if (seenPaths.has(normalized)) return;
      if (fs.existsSync(exePath)) {
        seenPaths.add(normalized);
        const id = `app-${name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;
        apps.push({ id, name, executablePath: exePath, category, source: category, version });
      }
    };

    if (this.isWindows) {
      const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env['LOCALAPPDATA'] || 'C:\\Users\\Default\\AppData\\Local';
      const appData = process.env['APPDATA'] || 'C:\\Users\\Default\\AppData\\Roaming';
      const windir = process.env['WINDIR'] || 'C:\\Windows';

      // 1. Browsers
      addApp('Google Chrome', path.join(progFiles, 'Google\\Chrome\\Application\\chrome.exe'), 'browser');
      addApp('Google Chrome', path.join(progFilesX86, 'Google\\Chrome\\Application\\chrome.exe'), 'browser');
      addApp('Google Chrome', path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'), 'browser');
      addApp('Microsoft Edge', path.join(progFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'), 'browser');
      addApp('Microsoft Edge', path.join(progFiles, 'Microsoft\\Edge\\Application\\msedge.exe'), 'browser');
      addApp('Brave Browser', path.join(progFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'), 'browser');
      addApp('Mozilla Firefox', path.join(progFiles, 'Mozilla Firefox\\firefox.exe'), 'browser');

      // 2. Development Tools
      addApp('Visual Studio Code', path.join(localAppData, 'Programs\\Microsoft VS Code\\Code.exe'), 'development');
      addApp('Visual Studio Code', path.join(progFiles, 'Microsoft VS Code\\Code.exe'), 'development');
      addApp('Android Studio', path.join(progFiles, 'Android\\Android Studio\\bin\\studio64.exe'), 'development');
      addApp('Git Bash', path.join(progFiles, 'Git\\git-bash.exe'), 'development');
      addApp('Windows Terminal', path.join(localAppData, 'Microsoft\\WindowsApps\\wt.exe'), 'development');
      addApp('Postman', path.join(localAppData, 'Postman\\app\\Postman.exe'), 'development');

      // 3. Communication
      addApp('WhatsApp', path.join(localAppData, 'WhatsApp\\WhatsApp.exe'), 'communication');
      addApp('Slack', path.join(localAppData, 'slack\\slack.exe'), 'communication');
      addApp('Discord', path.join(localAppData, 'Discord\\Update.exe'), 'communication');
      addApp('Telegram', path.join(appData, 'Telegram Desktop\\Telegram.exe'), 'communication');

      // 4. Productivity & System
      addApp('Notepad', path.join(windir, 'notepad.exe'), 'productivity');
      addApp('Calculator', path.join(windir, 'system32\\calc.exe'), 'productivity');
      addApp('PowerShell', path.join(windir, 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'), 'system');
      addApp('Command Prompt', path.join(windir, 'System32\\cmd.exe'), 'system');
      addApp('Explorer', path.join(windir, 'explorer.exe'), 'system');

      // 5. Query Registry App Paths via PowerShell
      try {
        const psCmd = `Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\*' | Select-Object -Property '(default)' | ConvertTo-Json`;
        const res = await this.runPowerShell(psCmd);
        if (res.stdout) {
          const parsed = JSON.parse(res.stdout);
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of entries) {
            const rawPath = item['(default)'];
            if (rawPath && typeof rawPath === 'string' && rawPath.endsWith('.exe')) {
              const cleaned = rawPath.replace(/^"|"$/g, '');
              const base = path.basename(cleaned, '.exe');
              addApp(base, cleaned, 'other');
            }
          }
        }
      } catch {
        // Registry enumeration fallback
      }
    } else {
      // macOS / Linux fallbacks
      addApp('Terminal', '/System/Applications/Utilities/Terminal.app', 'system');
      addApp('VS Code', '/Applications/Visual Studio Code.app', 'development');
      addApp('Google Chrome', '/Applications/Google Chrome.app', 'browser');
    }

    return apps.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Launches a specified application by recognized name or absolute executable path.
   */
  public async launchApp(appNameOrPath: string, args: string[] = []): Promise<InteractionResult> {
    try {
      let targetPath = appNameOrPath;

      if (!fs.existsSync(appNameOrPath)) {
        // Attempt to find by registered app name
        const discovered = await this.discoverInstalledApps();
        const found = discovered.find(
          (a) =>
            a.name.toLowerCase() === appNameOrPath.toLowerCase() ||
            path.basename(a.executablePath, '.exe').toLowerCase() === appNameOrPath.toLowerCase()
        );
        if (found) {
          targetPath = found.executablePath;
        } else {
          return {
            success: false,
            action: 'launchApp',
            error: `Application '${appNameOrPath}' not found in discovered installed apps or filesystem path.`,
          };
        }
      }

      if (this.isWindows) {
        const child = childProcess.spawn(targetPath, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.unref();

        return {
          success: true,
          action: 'launchApp',
          details: {
            appName: path.basename(targetPath, path.extname(targetPath)),
            executablePath: targetPath,
            pid: child.pid,
          },
        };
      } else {
        const child = childProcess.spawn('open', ['-a', targetPath, ...args], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        return {
          success: true,
          action: 'launchApp',
          details: { executablePath: targetPath, pid: child.pid },
        };
      }
    } catch (err: any) {
      return {
        success: false,
        action: 'launchApp',
        error: err.message,
      };
    }
  }

  /**
   * Returns active top-level GUI windows.
   */
  public async listWindows(forceRefresh = false): Promise<WindowInfo[]> {
    if (!this.isWindows) {
      return [];
    }

    if (!forceRefresh && this.cachedWindows && Date.now() - this.cachedWindows.timestamp < 10000) {
      return this.cachedWindows.data;
    }

    if (this.pendingListPromise) {
      return this.pendingListPromise;
    }

    try {
      this.pendingListPromise = new Promise<WindowInfo[]>((resolve) => {
        childProcess.exec('tasklist /v /fo csv', { maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
          this.pendingListPromise = null;
          if (err || !stdout) {
            return resolve(this.cachedWindows?.data || []);
          }
          const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
          const ignoredTitles = new Set([
            'n/a',
            'olemainthreadwndname',
            'olechannelwnd',
            'dwm notification window',
            'default ime',
            'msctls_statusbar32',
            'task host window',
            'crossdeviceresumewindow',
            'nvsvc',
            'realtekaudioadminbackgroundprocessclass',
            'my favorites setting',
          ]);

          const windows: WindowInfo[] = [];
          const seen = new Set<string>();

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","(.*)"$/);
            if (!match) continue;

            const processName = match[1].replace(/\.exe$/i, '');
            const pid = parseInt(match[2], 10);
            if (Number.isNaN(pid)) continue;
            const title = match[9].replace(/""/g, '"').replace(/"$/, '').trim();

            const lowerTitle = title.toLowerCase();
            if (
              !title ||
              ignoredTitles.has(lowerTitle) ||
              lowerTitle.startsWith('olemainthread') ||
              lowerTitle.startsWith('.net-broadcast')
            ) {
              continue;
            }

            const key = `${pid}-${title}`;
            if (seen.has(key)) continue;
            seen.add(key);

            windows.push({
              handle: String(pid),
              title,
              processName,
              pid,
              isForeground: false,
            });
          }

          this.cachedWindows = { data: windows, timestamp: Date.now() };
          resolve(windows);
        });
      });
      return await this.pendingListPromise;
    } catch (err: any) {
      console.warn('[DesktopController] listWindows error:', err.message);
      this.pendingListPromise = null;
      return this.cachedWindows?.data || [];
    }
  }

  /**
   * Focuses / brings a specific window to the foreground.
   */
  public async focusWindow(titleOrPid: string | number): Promise<InteractionResult> {
    if (!this.isWindows) {
      return { success: false, action: 'focusWindow', error: 'Focus window only supported on Windows' };
    }

    try {
      const isNum = typeof titleOrPid === 'number' || (/^\d+$/.test(String(titleOrPid).trim()) && !Number.isNaN(Number(titleOrPid)));
      const escaped = String(titleOrPid).replace(/'/g, "''");
      const num = Number(titleOrPid);
      const filter = isNum
        ? `$p = Get-Process -Id ${num} -ErrorAction SilentlyContinue; if (-not $p) { $p = Get-Process | Where-Object { $_.MainWindowHandle -eq ${num} } | Select-Object -First 1 }; if (-not $p) { $p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${escaped}*' } | Select-Object -First 1 }`
        : `$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${escaped}*' } | Select-Object -First 1`;

      const psScript = `
        ${filter}
        if (-not $p) { Write-Output "NOT_FOUND"; exit 0 }
        $sig = @'
[DllImport("user32.dll")]
public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("kernel32.dll")]
public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")]
public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")]
public static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool FlashWindow(IntPtr hWnd, bool bInvert);
'@
        Add-Type -MemberDefinition $sig -Name "Win32Focus" -Namespace "Win32" -ErrorAction SilentlyContinue

        $fgHWnd = [Win32.Win32Focus]::GetForegroundWindow()
        $fgThread = 0
        if ($fgHWnd -ne [IntPtr]::Zero) {
          $nullPid = 0
          $fgThread = [Win32.Win32Focus]::GetWindowThreadProcessId($fgHWnd, [ref]$nullPid)
        }
        $curThread = [Win32.Win32Focus]::GetCurrentThreadId()

        $attached = $false
        if ($fgThread -ne 0 -and $curThread -ne $fgThread) {
          try {
            $attached = [Win32.Win32Focus]::AttachThreadInput($curThread, $fgThread, $true)
          } catch {}
        }

        try {
          $ws = New-Object -ComObject WScript.Shell
          $ws.SendKeys('%')
        } catch {}

        [Win32.Win32Focus]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
        [Win32.Win32Focus]::BringWindowToTop($p.MainWindowHandle) | Out-Null
        $res = [Win32.Win32Focus]::SetForegroundWindow($p.MainWindowHandle)

        if ($attached) {
          try {
            [Win32.Win32Focus]::AttachThreadInput($curThread, $fgThread, $false) | Out-Null
          } catch {}
        }

        if (-not $res) {
          [Win32.Win32Focus]::FlashWindow($p.MainWindowHandle, $true) | Out-Null
          Write-Output ("FOCUS_LOCKED:" + $p.MainWindowTitle + "|" + $p.MainWindowHandle)
        } else {
          Write-Output ("ACTIVATED:" + $p.MainWindowTitle + "|" + $p.MainWindowHandle)
        }
      `;

      const res = await this.runPowerShell(psScript);
      if (res.exitCode !== 0 || res.stdout.includes('NOT_FOUND')) {
        return { success: false, action: 'focusWindow', error: `Window '${titleOrPid}' not found` };
      }

      const out = res.stdout.trim();
      const isLocked = out.includes('FOCUS_LOCKED:');
      const isActivated = out.includes('ACTIVATED:') || out.includes('SUCCESS:');

      return {
        success: true,
        action: 'focusWindow',
        activated: isActivated,
        focusLocked: isLocked,
        notice: isLocked
          ? 'Window restored and taskbar alert flashed. Windows OS background focus lock (LockSetForegroundWindow) prevented background focus stealing without operator interaction.'
          : 'Window activated and brought to foreground.',
        details: { target: titleOrPid, output: out, focusLocked: isLocked, activated: isActivated },
      };
    } catch (err: any) {
      return { success: false, action: 'focusWindow', error: err.message };
    }
  }

  /**
   * Closes a window gracefully by title or PID.
   */
  public async closeWindow(titleOrPid: string | number): Promise<InteractionResult> {
    if (!this.isWindows) {
      return { success: false, action: 'closeWindow', error: 'Close window only supported on Windows' };
    }

    try {
      const isNum = typeof titleOrPid === 'number' || (/^\d+$/.test(String(titleOrPid).trim()) && !Number.isNaN(Number(titleOrPid)));
      const escaped = String(titleOrPid).replace(/'/g, "''");
      const num = Number(titleOrPid);
      const filter = isNum
        ? `$p = Get-Process -Id ${num} -ErrorAction SilentlyContinue; if (-not $p) { $p = Get-Process | Where-Object { $_.MainWindowHandle -eq ${num} } | Select-Object -First 1 }; if (-not $p) { $p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${escaped}*' } | Select-Object -First 1 }`
        : `$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${escaped}*' } | Select-Object -First 1`;

      const psScript = `
        ${filter}
        if (-not $p) { Write-Output "NOT_FOUND"; exit 0 }
        $closed = $p.CloseMainWindow()
        if (-not $closed) { Stop-Process -Id $p.Id -Force }
        Write-Output "CLOSED"
      `;

      const res = await this.runPowerShell(psScript);
      if (res.exitCode !== 0 || res.stdout.includes('NOT_FOUND')) {
        return { success: false, action: 'closeWindow', error: `Window '${titleOrPid}' not found` };
      }

      return { success: true, action: 'closeWindow', details: { target: titleOrPid } };
    } catch (err: any) {
      return { success: false, action: 'closeWindow', error: err.message };
    }
  }

  /**
   * Retrieves display geometry & resolution.
   */
  public async getDisplays(): Promise<DisplayInfo[]> {
    if (!this.isWindows) {
      return [{ id: 'disp-0', width: 1920, height: 1080, isPrimary: true, scaleFactor: 1.0 }];
    }

    try {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $screens = [System.Windows.Forms.Screen]::AllScreens
        if ($screens -and $screens.Count -gt 0) {
          $screens | ForEach-Object {
            [PSCustomObject]@{
              DeviceName = $_.DeviceName
              Width = $_.Bounds.Width
              Height = $_.Bounds.Height
              Primary = $_.Primary
            }
          } | ConvertTo-Json
        } else {
          Write-Output '[{"DeviceName":"\\\\\\\\.\\\\HEADLESS_DISPLAY0","Width":1920,"Height":1080,"Primary":true}]'
        }
      `;
      const res = await this.runPowerShell(psScript);
      if (!res.stdout || !res.stdout.trim()) {
        return [{ id: 'disp-0', width: 1920, height: 1080, isPrimary: true, scaleFactor: 1.0 }];
      }

      const parsed = JSON.parse(res.stdout);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      return items.map((screen: any, idx: number) => ({
        id: `disp-${idx}`,
        width: Number(screen.Width || 1920),
        height: Number(screen.Height || 1080),
        isPrimary: Boolean(screen.Primary),
        scaleFactor: 1.0,
      }));
    } catch {
      return [{ id: 'disp-0', width: 1920, height: 1080, isPrimary: true, scaleFactor: 1.0 }];
    }
  }

  /**
   * Captures screen contents using Windows Forms / GDI+ Graphics.
   * Gracefully detects headless vs interactive desktop sessions.
   */
  public async captureScreen(options: { fullScreen?: boolean; format?: 'png' | 'jpeg' } = {}): Promise<CaptureResult> {
    const format = options.format || 'png';
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const now = Date.now();

    if (!this.isWindows) {
      // Return 1x1 transparent placeholder when in non-Windows test environment
      return {
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
        timestamp: now,
        isHeadless: true,
        interactive: false,
        notice: 'Non-Windows test environment placeholder.',
      };
    }

    try {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms,System.Drawing
        $sessionId = (Get-Process -Id $PID).SessionId
        $isInteractive = [System.Environment]::UserInteractive
        $primaryScreen = [System.Windows.Forms.Screen]::PrimaryScreen

        $canGdiCapture = $isInteractive -and ($primaryScreen -ne $null) -and ($primaryScreen.Bounds.Width -gt 0)

        if ($canGdiCapture) {
          try {
            $bounds = ${options.fullScreen ? '[System.Windows.Forms.SystemInformation]::VirtualScreen' : '$primaryScreen.Bounds'}
            $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            $ms = New-Object System.IO.MemoryStream
            $fmt = [System.Drawing.Imaging.ImageFormat]::${format === 'jpeg' ? 'Jpeg' : 'Png'}
            $bmp.Save($ms, $fmt)
            $b64 = [Convert]::ToBase64String($ms.ToArray())
            $bmp.Dispose()
            $g.Dispose()
            $ms.Dispose()
            Write-Output ("META_INTERACTIVE:" + $bounds.Width + "x" + $bounds.Height + "|" + $sessionId + "|")
            Write-Output $b64
            exit 0
          } catch {
            # GDI CopyFromScreen failed in non-desktop context; fall through to headless virtual canvas
          }
        }

        # Headless / Virtual Display Fallback Canvas
        $w = 1920
        $h = 1080
        $bmp = New-Object System.Drawing.Bitmap $w, $h
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $brushBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(11, 16, 30))
        $g.FillRectangle($brushBg, 0, 0, $w, $h)

        $penGrid = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(25, 35, 60)), 1
        for ($x = 0; $x -lt $w; $x += 80) { $g.DrawLine($penGrid, $x, 0, $x, $h) }
        for ($y = 0; $y -lt $h; $y += 80) { $g.DrawLine($penGrid, 0, $y, $w, $y) }

        $fontTitle = New-Object System.Drawing.Font ("Consolas", 22, [System.Drawing.FontStyle]::Bold)
        $fontSub = New-Object System.Drawing.Font ("Consolas", 13, [System.Drawing.FontStyle]::Regular)
        $brushText = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(147, 197, 253))
        $brushSub = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(148, 163, 184))

        $timeStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss UTC")
        $g.DrawString("KIN OS - HEADLESS VIRTUAL DISPLAY SESSION", $fontTitle, $brushText, 80, 80)
        $g.DrawString("Session ID: $sessionId | Interactive: $isInteractive | Virtual Resolution: 1920x1080", $fontSub, $brushSub, 80, 130)
        $g.DrawString("Timestamp: $timeStr", $fontSub, $brushSub, 80, 160)
        $g.DrawString("Physical Display: Unattached / Background Session (GDI+ Direct Surface Unavailable)", $fontSub, $brushSub, 80, 190)

        $ms = New-Object System.IO.MemoryStream
        $fmt = [System.Drawing.Imaging.ImageFormat]::${format === 'jpeg' ? 'Jpeg' : 'Png'}
        $bmp.Save($ms, $fmt)
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        $bmp.Dispose()
        $g.Dispose()
        $ms.Dispose()
        Write-Output ("META_HEADLESS:" + $w + "x" + $h + "|" + $sessionId + "|")
        Write-Output $b64
      `;

      const res = await this.runPowerShell(psScript);
      const out = res.stdout;
      const metaMatch = out.match(/META_(INTERACTIVE|HEADLESS):(\d+)x(\d+)\|(\d*)\|([\s\S]*)/) || out.match(/META:(\d+)x(\d+)\|([\s\S]*)/);

      if (metaMatch) {
        const isHeadless = metaMatch[1] === 'HEADLESS';
        const width = parseInt(metaMatch[2] || metaMatch[1], 10);
        const height = parseInt(metaMatch[3] || metaMatch[2], 10);
        const sessionId = metaMatch[4] ? parseInt(metaMatch[4], 10) : undefined;
        const b64 = (metaMatch[5] || metaMatch[3] || '').trim().replace(/\r?\n/g, '');

        return {
          base64: b64,
          mimeType,
          width,
          height,
          timestamp: now,
          isHeadless,
          sessionId,
          interactive: !isHeadless,
          notice: isHeadless
            ? `Headless or non-interactive session detected (Session ID: ${sessionId ?? 'N/A'}). Virtual display frame generated.`
            : 'Interactive desktop surface captured via GDI+ Graphics.',
        };
      }

      throw new Error('Screen capture output parsing failed: ' + out.slice(0, 100));
    } catch (err: any) {
      console.warn('[DesktopController] captureScreen failed, returning fallback:', err.message);
      return {
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
        timestamp: now,
        isHeadless: true,
        interactive: false,
        notice: `Screen capture fallback: ${err.message}`,
      };
    }
  }

  /**
   * Moves the cursor to (x, y) coordinates.
   */
  public async mouseMove(x: number, y: number): Promise<InteractionResult> {
    if (!this.isWindows) {
      return { success: true, action: 'mouseMove', details: { x, y } };
    }

    try {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
      `;
      const res = await this.runPowerShell(psScript);
      if (res.exitCode !== 0) {
        return { success: false, action: 'mouseMove', error: res.stderr || 'PowerShell mouseMove failed' };
      }
      return { success: true, action: 'mouseMove', details: { x, y } };
    } catch (err: any) {
      return { success: false, action: 'mouseMove', error: err.message };
    }
  }

  /**
   * Clicks at (x, y) with left, right, or middle mouse button.
   */
  public async mouseClick(
    x: number,
    y: number,
    options: { button?: 'left' | 'right' | 'middle'; doubleClick?: boolean } = {}
  ): Promise<InteractionResult> {
    const button = options.button || 'left';
    const double = Boolean(options.doubleClick);

    if (!this.isWindows) {
      return { success: true, action: 'mouseClick', details: { x, y, button, double } };
    }

    try {
      let downFlag = 0x02; // MOUSEEVENTF_LEFTDOWN
      let upFlag = 0x04;   // MOUSEEVENTF_LEFTUP

      if (button === 'right') {
        downFlag = 0x08;
        upFlag = 0x10;
      } else if (button === 'middle') {
        downFlag = 0x20;
        upFlag = 0x40;
      }

      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
        $sig = @'
[DllImport("user32.dll")]
public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
'@
        Add-Type -MemberDefinition $sig -Name "Win32Mouse" -Namespace "Win32" -ErrorAction SilentlyContinue
        [Win32.Win32Mouse]::mouse_event(${downFlag}, 0, 0, 0, 0)
        [Win32.Win32Mouse]::mouse_event(${upFlag}, 0, 0, 0, 0)
        ${
          double
            ? `Start-Sleep -Milliseconds 50
               [Win32.Win32Mouse]::mouse_event(${downFlag}, 0, 0, 0, 0)
               [Win32.Win32Mouse]::mouse_event(${upFlag}, 0, 0, 0, 0)`
            : ''
        }
      `;

      const res = await this.runPowerShell(psScript);
      if (res.exitCode !== 0) {
        return { success: false, action: 'mouseClick', error: res.stderr || 'PowerShell mouseClick failed' };
      }
      return { success: true, action: 'mouseClick', details: { x, y, button, double } };
    } catch (err: any) {
      return { success: false, action: 'mouseClick', error: err.message };
    }
  }

  /**
   * Types text using keyboard input synthesis.
   */
  public async typeText(text: string): Promise<InteractionResult> {
    if (!this.isWindows) {
      return { success: true, action: 'typeText', details: { charactersCount: text.length } };
    }

    try {
      // Escape special characters for SendKeys: { } [ ] + ^ % ~ ( ) in a single atomic pass
      const escaped = text
        .replace(/[{}]/g, (m) => `{${m}}`)
        .replace(/[+^%~()]/g, (m) => `{${m}}`)
        .replace(/'/g, "''");

      const psScript = `
        try {
          $ws = New-Object -ComObject WScript.Shell
          $ws.SendKeys('${escaped}')
        } catch {
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.SendKeys]::SendWait('${escaped}')
        }
      `;

      const res = await this.runPowerShell(psScript);
      if (res.exitCode !== 0) {
        return { success: false, action: 'typeText', error: res.stderr || 'PowerShell typeText failed' };
      }
      return { success: true, action: 'typeText', details: { charactersCount: text.length } };
    } catch (err: any) {
      return { success: false, action: 'typeText', error: err.message };
    }
  }

  /**
   * Sends hotkey combination (e.g. key: 's', modifiers: ['ctrl']).
   */
  public async sendKey(key: string, modifiers: string[] = []): Promise<InteractionResult> {
    if (!this.isWindows) {
      return { success: true, action: 'sendKey', details: { key, modifiers } };
    }

    try {
      let prefix = '';
      for (const mod of modifiers) {
        const m = mod.toLowerCase();
        if (m === 'ctrl' || m === 'control') prefix += '^';
        else if (m === 'alt') prefix += '%';
        else if (m === 'shift') prefix += '+';
      }

      let keyToken = key;
      const upper = key.toUpperCase();
      if (upper === 'ESCAPE' || upper === 'ESC') {
        keyToken = '{ESC}';
      } else if (upper === 'SPACE') {
        keyToken = ' ';
      } else if (upper === 'PAGEUP' || upper === 'PGUP') {
        keyToken = '{PGUP}';
      } else if (upper === 'PAGEDOWN' || upper === 'PGDN') {
        keyToken = '{PGDN}';
      } else if (upper === 'HOME') {
        keyToken = '{HOME}';
      } else if (upper === 'END') {
        keyToken = '{END}';
      } else if (['ENTER', 'TAB', 'BACKSPACE', 'DELETE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(upper)) {
        keyToken = `{${upper}}`;
      }

      const stroke = `${prefix}${keyToken}`.replace(/'/g, "''");
      const psScript = `
        try {
          $ws = New-Object -ComObject WScript.Shell
          $ws.SendKeys('${stroke}')
        } catch {
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.SendKeys]::SendWait('${stroke}')
        }
      `;

      const res = await this.runPowerShell(psScript);
      if (res.exitCode !== 0) {
        return { success: false, action: 'sendKey', error: res.stderr || 'PowerShell sendKey failed' };
      }
      return { success: true, action: 'sendKey', details: { stroke, key, modifiers } };
    } catch (err: any) {
      return { success: false, action: 'sendKey', error: err.message };
    }
  }

  /**
   * Helper to execute PowerShell scripts via stdin streaming,
   * bypassing the 8191-character Windows command-line limit and preventing command injection hazards.
   */
  private runPowerShell(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = childProcess.spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
        {
          windowsHide: true,
        }
      );

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill();
        resolve({ stdout: '', stderr: 'PowerShell execution timed out', exitCode: 1 });
      }, 20000);

      child.stdout.on('data', (d) => {
        stdout += d.toString('utf-8');
      });

      child.stderr.on('data', (d) => {
        stderr += d.toString('utf-8');
      });

      child.on('close', (code) => {
        if (killed) return;
        clearTimeout(timer);
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: code ?? 0,
        });
      });

      child.on('error', (err) => {
        if (killed) return;
        clearTimeout(timer);
        resolve({
          stdout: '',
          stderr: err.message,
          exitCode: 1,
        });
      });

      try {
        child.stdin.write(script, 'utf-8');
        child.stdin.end();
      } catch (writeErr: any) {
        clearTimeout(timer);
        resolve({
          stdout: '',
          stderr: writeErr.message,
          exitCode: 1,
        });
      }
    });
  }
}
