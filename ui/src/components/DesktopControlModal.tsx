import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  X,
  Monitor,
  Globe,
  Clock,
  Play,
  RotateCcw,
  Search,
  CheckCircle2,
  AlertCircle,
  Layers,
  Power,
  Plus,
} from 'lucide-react';

export const DesktopControlModal: React.FC = () => {
  const {
    isDesktopControlModalOpen,
    setDesktopControlModalOpen,
    discoveredApps,
    fetchDiscoveredApps,
    launchApp,
    activeWindows,
    fetchActiveWindows,
    focusWindow,
    closeWindow,
    browserStatus,
    fetchBrowserStatus,
    closeBrowser,
    navigateBrowser,
    draftSocialPosts,
    captureDesktopScreenshot,
    routines,
    fetchRoutines,
    createRoutine,
    cancelRoutine,
  } = useKinStore();

  const [activeTab, setActiveTab] = useState<'apps' | 'windows' | 'browser' | 'routines'>('apps');
  const [appSearch, setAppSearch] = useState('');
  const [windowSearch, setWindowSearch] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotMeta, setScreenshotMeta] = useState<{ isHeadless?: boolean; notice?: string; sessionId?: number } | null>(null);
  const [launchFeedback, setLaunchFeedback] = useState<{ name: string; success: boolean; msg?: string } | null>(null);

  // New Routine Form State
  const [routinePrompt, setRoutinePrompt] = useState('');
  const [routineType, setRoutineType] = useState<'cron' | 'one_shot'>('cron');
  const [cronExpr, setCronExpr] = useState('*/15 * * * *');
  const [oneShotSeconds, setOneShotSeconds] = useState(60);

  useEffect(() => {
    if (isDesktopControlModalOpen) {
      fetchDiscoveredApps();
      fetchActiveWindows();
      fetchBrowserStatus();
      fetchRoutines();
    }
  }, [isDesktopControlModalOpen, fetchDiscoveredApps, fetchActiveWindows, fetchBrowserStatus, fetchRoutines]);

  if (!isDesktopControlModalOpen) return null;

  const handleLaunch = async (appNameOrPath: string, displayName: string) => {
    const res = await launchApp(appNameOrPath);
    setLaunchFeedback({
      name: displayName,
      success: res.success,
      msg: res.success ? 'Launched successfully' : res.error || 'Failed to launch',
    });
    setTimeout(() => setLaunchFeedback(null), 3000);
    await fetchActiveWindows();
  };

  const handleFocusWindow = async (win: any) => {
    const res: any = await focusWindow(win.pid || win.handle || win.title);
    if (res && res.success) {
      if (res.focusLocked) {
        setLaunchFeedback({
          name: win.title || win.processName,
          success: true,
          msg: `Taskbar alert flashed. Windows OS background focus lock prevented direct foreground theft without user interaction.`,
        });
      } else {
        setLaunchFeedback({
          name: win.title || win.processName,
          success: true,
          msg: `Window activated and brought to foreground.`,
        });
      }
    } else {
      setLaunchFeedback({
        name: win.title || win.processName,
        success: false,
        msg: res?.error || 'Failed to focus window',
      });
    }
    setTimeout(() => setLaunchFeedback(null), 5000);
  };

  const handleCreateRoutineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routinePrompt.trim()) return;
    await createRoutine({
      prompt: routinePrompt.trim(),
      type: routineType,
      cronExpression: routineType === 'cron' ? cronExpr : undefined,
      durationSeconds: routineType === 'one_shot' ? Number(oneShotSeconds) : undefined,
    });
    setRoutinePrompt('');
  };

  const handleNavigateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl.trim()) return;
    setIsNavigating(true);
    const success = await navigateBrowser(targetUrl.trim());
    setIsNavigating(false);
    if (success) {
      setLaunchFeedback({
        name: 'Browser',
        success: true,
        msg: `Navigated to ${targetUrl.trim()}`,
      });
      setTimeout(() => setLaunchFeedback(null), 3000);
    }
  };

  const handleCaptureScreen = async () => {
    const result = await captureDesktopScreenshot();
    if (result) {
      if (typeof result === 'object' && result.dataUri) {
        setScreenshotPreview(result.dataUri);
        setScreenshotMeta({ isHeadless: result.isHeadless, notice: result.notice, sessionId: result.sessionId });
      } else if (typeof result === 'string') {
        setScreenshotPreview(result);
        setScreenshotMeta(null);
      }
    }
  };

  const filteredApps = discoveredApps.filter(
    (a) =>
      a.name.toLowerCase().includes(appSearch.toLowerCase()) ||
      a.executablePath.toLowerCase().includes(appSearch.toLowerCase())
  );

  const filteredWindows = activeWindows.filter(
    (w) =>
      w.title.toLowerCase().includes(windowSearch.toLowerCase()) ||
      w.processName.toLowerCase().includes(windowSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="bg-[#0b101e] border border-[#232f48] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl text-xs overflow-hidden">
        {/* Header */}
        <div className="h-14 px-6 border-b border-[#1e293b] flex items-center justify-between bg-[#0e1526]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                <span>Computer & Web Control Center</span>
              </h2>
              <p className="text-[11px] text-[#8b949e]">
                Application discovery, window management, persistent browser, and proactive routines
              </p>
            </div>
          </div>

          <button
            onClick={() => setDesktopControlModalOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[#1e293b] text-[#8b949e] hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 border-b border-[#1e293b] bg-[#070b16] gap-2">
          <button
            onClick={() => setActiveTab('apps')}
            className={`py-3 px-3 border-b-2 font-medium flex items-center space-x-2 transition ${
              activeTab === 'apps'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Installed Apps ({discoveredApps.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('windows')}
            className={`py-3 px-3 border-b-2 font-medium flex items-center space-x-2 transition ${
              activeTab === 'windows'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Active Windows ({activeWindows.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('browser')}
            className={`py-3 px-3 border-b-2 font-medium flex items-center space-x-2 transition ${
              activeTab === 'browser'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Browser Session {browserStatus?.active && '🟢'}</span>
          </button>

          <button
            onClick={() => setActiveTab('routines')}
            className={`py-3 px-3 border-b-2 font-medium flex items-center space-x-2 transition ${
              activeTab === 'routines'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Proactive Routines ({routines.length})</span>
          </button>
        </div>

        {/* Launch Feedback Banner */}
        {launchFeedback && (
          <div
            className={`px-6 py-2 flex items-center space-x-2 text-xs ${
              launchFeedback.success
                ? 'bg-emerald-950/60 border-b border-emerald-500/40 text-emerald-300'
                : 'bg-red-950/60 border-b border-red-500/40 text-red-300'
            }`}
          >
            {launchFeedback.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400" />
            )}
            <span>
              <strong>{launchFeedback.name}:</strong> {launchFeedback.msg}
            </span>
          </div>
        )}

        {/* Live Screen Capture Preview */}
        {screenshotPreview && (
          <div className="p-3 mx-6 my-2 rounded-xl bg-[#0b1220] border border-blue-500/30 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
                  <Monitor className="w-3.5 h-3.5 text-blue-400" />
                  Screen Capture Preview
                </span>
                {screenshotMeta?.isHeadless ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Headless Session ({screenshotMeta.sessionId !== undefined ? `Session ${screenshotMeta.sessionId}` : 'Virtual Display'})
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Live GDI+ Desktop Display
                  </span>
                )}
              </div>
              <button
                onClick={() => { setScreenshotPreview(null); setScreenshotMeta(null); }}
                className="text-[11px] text-gray-400 hover:text-white px-2 py-0.5 rounded bg-[#162035] hover:bg-[#202d48] transition"
              >
                Dismiss
              </button>
            </div>
            {screenshotMeta?.notice && (
              <p className="text-[11px] text-gray-400 font-mono italic px-1">{screenshotMeta.notice}</p>
            )}
            <img
              src={screenshotPreview}
              alt="Desktop Screenshot"
              className="max-h-56 object-contain rounded-lg border border-[#1e2a44] bg-black mx-auto"
            />
          </div>
        )}

        {/* TAB 1: INSTALLED APPS */}
        {activeTab === 'apps' && (
          <div className="flex-1 flex flex-col min-h-0 bg-[#080d1a]">
            <div className="p-4 border-b border-[#1e293b] flex items-center justify-between gap-3 bg-[#0a0f1e]">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                  placeholder="Search discovered desktop applications..."
                  className="w-full bg-[#101728] border border-[#212d45] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={handleCaptureScreen}
                  className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1f2d4a] border border-[#283858] text-white font-medium transition"
                  title="Capture live screenshot of primary display"
                >
                  <Monitor className="w-3.5 h-3.5 text-blue-400" />
                  <span>Capture Screen</span>
                </button>

                <button
                  onClick={fetchDiscoveredApps}
                  className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1f2d4a] border border-[#283858] text-white font-medium transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Re-scan System</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredApps.length === 0 ? (
                <div className="text-center py-12 text-gray-500 italic">No applications found.</div>
              ) : (
                filteredApps.map((app, idx) => (
                  <div
                    key={`${app.name}-${idx}`}
                    className="p-3 rounded-xl bg-[#0d1426] border border-[#1e2a44] flex items-center justify-between hover:border-[#2f4068] transition"
                  >
                    <div className="truncate mr-3">
                      <div className="font-bold text-white text-[13px]">{app.name}</div>
                      <div className="text-[10px] font-mono text-gray-400 truncate mt-0.5">
                        {app.executablePath}
                      </div>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#162035] text-gray-400 font-mono">
                        {app.category || app.source || 'application'}
                      </span>
                    </div>

                    <button
                      onClick={() => handleLaunch(app.executablePath || app.name, app.name)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition shrink-0"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Launch</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ACTIVE WINDOWS */}
        {activeTab === 'windows' && (
          <div className="flex-1 flex flex-col min-h-0 bg-[#080d1a]">
            <div className="p-4 border-b border-[#1e293b] flex items-center justify-between gap-3 bg-[#0a0f1e]">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={windowSearch}
                  onChange={(e) => setWindowSearch(e.target.value)}
                  placeholder="Filter active GUI windows by title or process..."
                  className="w-full bg-[#101728] border border-[#212d45] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                onClick={fetchActiveWindows}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1f2d4a] border border-[#283858] text-white font-medium transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Refresh Windows</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredWindows.length === 0 ? (
                <div className="text-center py-12 text-gray-500 italic">No top-level windows detected.</div>
              ) : (
                filteredWindows.map((win) => (
                  <div
                    key={win.handle}
                    className="p-3 rounded-xl bg-[#0d1426] border border-[#1e2a44] flex items-center justify-between hover:border-[#2f4068] transition"
                  >
                    <div className="truncate mr-3">
                      <div className="font-bold text-white text-[13px] truncate">{win.title}</div>
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5">
                        Process: {win.processName} | PID: {win.pid} | HWND: {win.handle}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={() => handleFocusWindow(win)}
                        className="px-3 py-1.5 rounded-lg bg-[#162035] hover:bg-[#202e4d] text-blue-300 border border-[#283858] font-medium transition"
                        title="Bring window to foreground"
                      >
                        Focus
                      </button>
                      <button
                        onClick={() => closeWindow(win.pid || win.handle || win.title)}
                        className="px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 font-medium transition"
                        title="Close GUI window"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: BROWSER SESSION */}
        {activeTab === 'browser' && (
          <div className="flex-1 p-6 space-y-4 bg-[#080d1a] overflow-y-auto">
            <div className="p-4 rounded-xl bg-[#0d1426] border border-[#1e2a44] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span
                    className={`w-3 h-3 rounded-full ${
                      browserStatus?.active ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-gray-600'
                    }`}
                  />
                  <span className="font-bold text-white text-sm">
                    {browserStatus?.active ? 'Persistent Browser Session Active' : 'No Active Browser Session'}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={fetchBrowserStatus}
                    className="p-1.5 rounded-lg bg-[#162035] hover:bg-[#1f2d4a] text-gray-300 hover:text-white transition"
                    title="Refresh telemetry"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  {browserStatus?.active && (
                    <button
                      onClick={closeBrowser}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>Terminate Browser</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Actions Bar */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1e2a44]">
                <button
                  type="button"
                  disabled={isDrafting}
                  onClick={async () => {
                    setIsDrafting(true);
                    setDraftResult('Drafting on visible screen...');
                    const res = await draftSocialPosts('both');
                    setIsDrafting(false);
                    if (res?.success) {
                      setDraftResult('Successfully drafted on LinkedIn & X on screen!');
                    } else {
                      setDraftResult(res?.error || 'Failed to draft');
                    }
                    setTimeout(() => setDraftResult(null), 6000);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center space-x-1.5 shadow-sm transition disabled:opacity-50"
                  title="Visibly launch browser and draft launch posts on LinkedIn and X"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{isDrafting ? 'Drafting on Screen...' : '🚀 Draft Social Posts (LinkedIn & X)'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigateBrowser('https://openrouter.ai/models?max_price=0')}
                  className="px-2.5 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1f2d4a] border border-[#283858] text-white text-xs flex items-center space-x-1 transition"
                  title="Open OpenRouter 100% Free Models Catalog"
                >
                  <Search className="w-3.5 h-3.5 text-amber-400" />
                  <span>Explore OpenRouter Free Models</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigateBrowser('https://github.com/abhayzangir1/KIN')}
                  className="px-2.5 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1f2d4a] border border-[#283858] text-white text-xs flex items-center space-x-1 transition"
                  title="Open KIN GitHub Repository"
                >
                  <Monitor className="w-3.5 h-3.5 text-emerald-400" />
                  <span>KIN GitHub Repo</span>
                </button>

                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                  Remote Port 9222 Active
                </span>
              </div>

              {draftResult && (
                <div className="p-2 rounded-lg bg-blue-950/40 border border-blue-500/30 text-blue-300 text-xs flex items-center justify-between">
                  <span>{draftResult}</span>
                  <button onClick={() => setDraftResult(null)} className="text-gray-400 hover:text-white text-xs ml-2">×</button>
                </div>
              )}

              {/* Direct URL Navigation Bar */}
              <form onSubmit={handleNavigateSubmit} className="flex items-center space-x-2 pt-2 border-t border-[#1e2a44]">
                <input
                  type="text"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="Navigate browser to URL (e.g., https://github.com)..."
                  className="flex-1 bg-[#101728] border border-[#212d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={isNavigating || !targetUrl.trim()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center space-x-1 shrink-0"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{isNavigating ? 'Loading...' : 'Navigate'}</span>
                </button>
              </form>

              {browserStatus?.active ? (
                <div className="space-y-2 pt-2 border-t border-[#1e2a44]">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Active URL</label>
                    <div className="font-mono text-emerald-300 text-xs truncate bg-[#070b14] p-2 rounded border border-[#1b263e]">
                      {browserStatus.currentUrl || 'about:blank'}
                    </div>
                  </div>
                  {browserStatus.pageTitle && (
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase font-semibold">Page Title</label>
                      <div className="text-white text-xs bg-[#070b14] p-2 rounded border border-[#1b263e]">
                        {browserStatus.pageTitle}
                      </div>
                    </div>
                  )}

                  {browserStatus.stepHistory && browserStatus.stepHistory.length > 0 && (
                    <div className="pt-2">
                      <label className="text-[10px] text-gray-400 uppercase font-semibold">
                        Step Trajectory Audit ({browserStatus.stepHistory.length} actions)
                      </label>
                      <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                        {browserStatus.stepHistory.map((s, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded bg-[#070b14] border border-[#1b263e] flex items-center justify-between font-mono text-[11px]"
                          >
                            <span className="text-blue-300">
                              #{idx + 1} {s.action}
                            </span>
                            <span className="text-gray-400 truncate max-w-xs">{s.selector || s.url || ''}</span>
                            <span className="text-[10px] text-emerald-400">
                              {s.durationMs !== undefined ? `${s.durationMs}ms` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500 italic">
                  Persistent browser starts automatically on any web automation directive. Session cookies and
                  logins persist under <code className="text-gray-400">.kin/browser_profile</code>.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: PROACTIVE ROUTINES */}
        {activeTab === 'routines' && (
          <div className="flex-1 flex flex-col min-h-0 bg-[#080d1a]">
            {/* Create Routine Bar */}
            <form onSubmit={handleCreateRoutineSubmit} className="p-4 border-b border-[#1e293b] bg-[#0a0f1e] space-y-3">
              <span className="font-bold text-white text-xs">Register Autonomous Proactive Routine</span>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={routinePrompt}
                  onChange={(e) => setRoutinePrompt(e.target.value)}
                  placeholder="Routine directive (e.g., 'Check unread PRs & notify team')..."
                  className="col-span-2 bg-[#101728] border border-[#212d45] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />

                <div className="flex items-center space-x-2">
                  <select
                    value={routineType}
                    onChange={(e) => setRoutineType(e.target.value as any)}
                    className="bg-[#101728] border border-[#212d45] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="cron">Cron (Recurring)</option>
                    <option value="one_shot">Timer (One-Shot)</option>
                  </select>

                  {routineType === 'cron' ? (
                    <input
                      type="text"
                      value={cronExpr}
                      onChange={(e) => setCronExpr(e.target.value)}
                      placeholder="*/15 * * * *"
                      className="w-28 bg-[#101728] border border-[#212d45] rounded-lg px-2 py-1.5 text-xs font-mono text-emerald-300"
                    />
                  ) : (
                    <input
                      type="number"
                      value={oneShotSeconds}
                      onChange={(e) => setOneShotSeconds(Number(e.target.value))}
                      placeholder="Seconds"
                      className="w-20 bg-[#101728] border border-[#212d45] rounded-lg px-2 py-1.5 text-xs font-mono text-emerald-300"
                    />
                  )}

                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center space-x-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              </div>
            </form>

            {/* Routines List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {routines.length === 0 ? (
                <div className="text-center py-12 text-gray-500 italic">No proactive routines registered.</div>
              ) : (
                routines.map((routine) => (
                  <div
                    key={routine.id}
                    className="p-3 rounded-xl bg-[#0d1426] border border-[#1e2a44] flex items-center justify-between hover:border-[#2f4068] transition"
                  >
                    <div>
                      <div className="font-bold text-white text-xs">{routine.prompt}</div>
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5 space-x-2">
                        <span className="text-blue-300">[{routine.type}]</span>
                        {routine.cronExpression && <span>Cron: {routine.cronExpression}</span>}
                        {routine.durationSeconds && <span>Delay: {routine.durationSeconds}s</span>}
                        <span className="text-emerald-400">Status: {routine.status}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => cancelRoutine(routine.id)}
                      className="px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 text-[11px] font-medium transition"
                    >
                      Cancel
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
