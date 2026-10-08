import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { FolderPlus, FolderOpen, X } from 'lucide-react';

export const NewProjectModal: React.FC = () => {
  const { isNewProjectModalOpen, setNewProjectModalOpen, createProject } = useKinStore();
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isNewProjectModalOpen) return null;

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
                if (!repoPath) {
                  setRepoPath(`D:\\${e.target.value}`);
                }
              }}
              placeholder="e.g. test01, fintech-api"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-2 text-kin-text focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[#94a3b8] font-medium">Root Repository Path</label>
              {'showDirectoryPicker' in window && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const dirHandle = await (window as any).showDirectoryPicker();
                      if (dirHandle?.name) {
                        if (!name) setName(dirHandle.name);
                        setRepoPath(`D:\\${dirHandle.name}`);
                      }
                    } catch {}
                  }}
                  className="flex items-center space-x-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium transition"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>Browse Folder</span>
                </button>
              )}
            </div>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="e.g. D:\testtt or D:\KIN"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-2 text-kin-text font-mono focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[10px] text-[#64748b] mt-1">
              Specify your local project folder (e.g. <span className="text-emerald-400 font-mono">D:\testtt</span>). You do <strong className="text-amber-300">not</strong> need a JSON file.
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
