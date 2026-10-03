import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { X, Target, Plus, CheckCircle2 } from 'lucide-react';

export const CreateGoalModal: React.FC = () => {
  const { isNewGoalModalOpen, setNewGoalModalOpen, createGoal, activeProject } = useKinStore();
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [goalCriteria, setGoalCriteria] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isNewGoalModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalTitle.trim()) {
      setError('Goal title is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const parsedCriteria = goalCriteria
        ? goalCriteria.split(/[,\n]/).map((c) => c.trim()).filter(Boolean)
        : undefined;
      await createGoal(goalTitle.trim(), goalDescription.trim() || undefined, parsedCriteria);
      setGoalTitle('');
      setGoalDescription('');
      setGoalCriteria('');
      setNewGoalModalOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to create goal');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl w-full max-w-md shadow-2xl p-5 space-y-4 font-sans text-xs">
        <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
          <div className="flex items-center space-x-2">
            <Target className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-kin-text">Create Project Goal</h2>
          </div>
          <button
            onClick={() => setNewGoalModalOpen(false)}
            className="text-[#64748b] hover:text-kin-text transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2 rounded bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[#94a3b8] font-medium">Goal Title *</label>
            <input
              type="text"
              autoFocus
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              placeholder="e.g. Real-Time Concurrency Architecture"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-1.5 text-kin-text focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[#94a3b8] font-medium">Description & Scope (Optional)</label>
            <textarea
              rows={3}
              value={goalDescription}
              onChange={(e) => setGoalDescription(e.target.value)}
              placeholder="e.g. Multi-agent coordination with local Ollama inference and zero-downtime recovery"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-1.5 text-kin-text focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[#94a3b8] font-medium">Acceptance Criteria (Optional)</label>
            <input
              type="text"
              value={goalCriteria}
              onChange={(e) => setGoalCriteria(e.target.value)}
              placeholder="e.g. Spec approved, 100% tests pass, zero regressions (comma separated)"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-1.5 text-kin-text focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="p-2.5 rounded bg-[#070b12] border border-[#1e293b] text-[#94a3b8] space-y-1 text-[11px]">
            <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Project Grounding</span>
            </div>
            <p>
              Target Project: <span className="font-mono text-white">{activeProject?.name || 'KIN'}</span>.
              Creating a goal populates the task DAG and activates autonomous execution tracking.
            </p>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setNewGoalModalOpen(false)}
              className="px-3 py-1.5 rounded bg-[#1e293b] hover:bg-[#334155] text-kin-text transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !goalTitle.trim()}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Creating...' : 'Create Goal'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
