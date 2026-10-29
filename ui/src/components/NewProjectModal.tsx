import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { FolderPlus, FolderOpen, X, Loader2 } from 'lucide-react';

export const NewProjectModal: React.FC = () => {
  const { isNewProjectModalOpen, setNewProjectModalOpen, createProject } = useKinStore();
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  if (!isNewProjectModalOpen) return null;

  const handleBrowse = async () => {
    setIsBrowsing(true);
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

      // 2. Try backend API dialog endpoint
      try {
        const res = await fetch('/api/system/dialog/browse-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
            setRepoPath(`D:\\${dirHandle.name}`);
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
    try {
      setIsSubmitting(true);
      setError('');
      await createProject(name.trim(), repoPath.trim() || undefined);
      setName('');
      setRepoPath('');
    } catch (err: any) {
      setError(err?.message || 'Failed to create project');
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
            className="text-kin-muted hover:text-kin-text transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {error && (
            <div className="p-2 rounded bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[#94a3b8] font-medium mb-1">Project Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="e.g. test01, fintech-api"
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
                className="flex items-center space-x-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium transition disabled:opacity-50"
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
              placeholder="e.g. D:\kinntesttt or /workspace/my-project"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-2 text-kin-text font-mono focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[10px] text-[#64748b] mt-1">
              Specify your local project folder. You do <strong className="text-amber-300">not</strong> need a JSON file.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={() => setNewProjectModalOpen(false)}
              className="px-3 py-1.5 rounded bg-[#1e293b] text-[#94a3b8] hover:text-kin-text transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium transition"
            >
              {isSubmitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
