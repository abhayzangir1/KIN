import React, { useState } from 'react';
import { useKinStore, getIpcToken } from '../store/kinStore.js';
import { FolderPlus, FolderOpen, X, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

export const NewProjectModal: React.FC = () => {
  const {
    isNewProjectModalOpen,
    setNewProjectModalOpen,
    createProject,
    isConnected,
    fetchState,
    initSSE,
    addToast,
  } = useKinStore();

  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  if (!isNewProjectModalOpen) return null;

  const handleBrowse = async () => {
    setIsBrowsing(true);
    setError('');
    try {
      // 1. Try Tauri invoke 'pick_folder' if running inside Tauri desktop shell
      if (typeof window !== 'undefined') {
        try {
          const tauri = (window as any).__TAURI__;
          const invoke =
            tauri?.core?.invoke ||
            tauri?.tauri?.invoke ||
            tauri?.invoke ||
            (window as any).__TAURI_INTERNALS__?.invoke;

          if (typeof invoke === 'function') {
            const selected = await invoke('pick_folder');
            if (selected && typeof selected === 'string') {
              setRepoPath(selected);
              const normalized = selected.replace(/\\/g, '/').replace(/\/+$/, '');
              const parts = normalized.split('/').filter(Boolean);
              const folderName = parts[parts.length - 1];
              if (folderName && !name) {
                setName(folderName);
              }
              return;
            }
          }
        } catch (tauriErr) {
          console.warn('[Browse] Tauri pick_folder fallback:', tauriErr);
        }
      }

      // 2. Try backend API dialog endpoint with authentication headers
      try {
        const token = await getIpcToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) {
          headers['x-ipc-token'] = token;
          headers['x-kin-auth'] = token;
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/system/dialog/browse-folder', {
          method: 'POST',
          headers,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.path && !data.canceled) {
            setRepoPath(data.path);
            const normalized = data.path.replace(/\\/g, '/').replace(/\/+$/, '');
            const parts = normalized.split('/').filter(Boolean);
            const folderName = parts[parts.length - 1];
            if (folderName && !name) {
              setName(folderName);
            }
            return;
          }
          if (data.canceled) {
            return;
          }
        }
      } catch (backendErr) {
        console.warn('[Browse] Backend browse-folder fallback:', backendErr);
      }

      // 3. Fallback to HTML5 showDirectoryPicker if available
      if ('showDirectoryPicker' in window) {
        try {
          const dirHandle = await (window as any).showDirectoryPicker();
          if (dirHandle?.name) {
            if (!name) setName(dirHandle.name);
            // Default to Windows drive path if on Windows environment
            const defaultBase = navigator.platform.includes('Win') ? 'C:\\' : '/';
            setRepoPath(`${defaultBase}${dirHandle.name}`);
          }
        } catch {
          // User cancelled picker
        }
      }
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }

    if (!isConnected) {
      setError('Cannot create workspace: KIN Core Daemon is currently disconnected. Click Reconnect below.');
      return;
    }

    let finalRepoPath = repoPath.trim();
    // If user provided a bare folder name (e.g. "kinntesttt") without path separators, normalize to drive root
    if (finalRepoPath && !finalRepoPath.includes('\\') && !finalRepoPath.includes('/')) {
      const defaultDrive = navigator.platform.includes('Win') ? 'D:\\' : '/';
      finalRepoPath = `${defaultDrive}${finalRepoPath}`;
      setRepoPath(finalRepoPath);
    }

    try {
      setIsSubmitting(true);
      setError('');
      // If not yet connected, attempt a rapid reconnect check
      if (!isConnected) {
        await fetchState().catch(() => {});
      }
      await createProject(name.trim(), finalRepoPath || undefined);
      addToast({
        title: 'Workspace Created',
        message: `Project "${name.trim()}" initialized and active.`,
        type: 'success',
      });
      setName('');
      setRepoPath('');
    } catch (err: any) {
      const msg = err?.message || 'Failed to create project';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError('Core daemon is initializing. Reconnecting automatically... please retry in a second.');
        fetchState().catch(() => {});
        initSSE();
      } else {
        setError(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0f172a] border border-[#1e293b] rounded-xl shadow-2xl p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
          <div className="flex items-center space-x-2 text-kin-text font-bold text-sm">
            <FolderPlus className="w-4 h-4 text-emerald-400" />
            <span>Create New Workspace / Project</span>
          </div>
          <button
            onClick={() => setNewProjectModalOpen(false)}
            className="text-kin-muted hover:text-kin-text transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Daemon Connection Warning */}
        {!isConnected && (
          <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>KIN Core Daemon is offline or reconnecting...</span>
            </div>
            <button
              type="button"
              onClick={() => {
                fetchState();
                initSSE();
              }}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium text-[11px] border border-amber-500/30 flex items-center space-x-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reconnect</span>
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {error && (
            <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-[#94a3b8] font-medium mb-1">Project Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. kinntesttt, fintech-api"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-2 text-kin-text focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[#94a3b8] font-medium">Root Repository Path</label>
              <button
                type="button"
                onClick={handleBrowse}
                disabled={isBrowsing}
                className="flex items-center space-x-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium transition disabled:opacity-50 cursor-pointer"
              >
                {isBrowsing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <FolderOpen className="w-3 h-3" />
                )}
                <span>{isBrowsing ? 'Selecting...' : 'Browse Folder'}</span>
              </button>
            </div>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="e.g. D:\kinntesttt or C:\Projects\my-app"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-2 text-kin-text font-mono focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[10px] text-[#64748b] mt-1">
              Absolute path to your local project folder (e.g. <code className="text-emerald-300">D:\kinntesttt</code>).
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={() => setNewProjectModalOpen(false)}
              className="px-3.5 py-1.5 rounded bg-[#1e293b] text-[#94a3b8] hover:text-kin-text transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !isConnected}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium transition cursor-pointer flex items-center space-x-1.5"
            >
              {isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>{isSubmitting ? 'Creating...' : !isConnected ? 'Daemon Disconnected' : 'Create Project'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
