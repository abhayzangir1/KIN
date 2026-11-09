import React, { useState } from 'react';
import { useKinStore } from '../../store/kinStore.js';
import { X, Target, Plus, CheckCircle2, Clock, Calendar } from 'lucide-react';

export const CreateGoalModal: React.FC = () => {
  const { isNewGoalModalOpen, setNewGoalModalOpen, createGoal, activeProject } = useKinStore();
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [goalCriteria, setGoalCriteria] = useState('');
  const [checkInPolicy, setCheckInPolicy] = useState('per_milestone');
  const [deadline, setDeadline] = useState('');
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

      const deadlineTimestamp = deadline ? new Date(deadline).getTime() : undefined;

      const res = await createGoal(
        goalTitle.trim(),
        goalDescription.trim() || undefined,
        parsedCriteria,
        checkInPolicy,
        deadlineTimestamp
      );

      if (res && !res.success) {
        setError(res.error || 'Failed to create goal');
        return;
      }
      setGoalTitle('');
      setGoalDescription('');
      setGoalCriteria('');
      setCheckInPolicy('per_milestone');
      setDeadline('');
      setNewGoalModalOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to create goal');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-goal-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn"
    >
      <div className="bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-[#1e293b] rounded-xl w-full max-w-md shadow-2xl p-5 space-y-4 font-sans text-xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#1e293b]">
          <div className="flex items-center space-x-2">
            <Target className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
            <h2 id="create-goal-heading" className="text-sm font-bold text-slate-900 dark:text-white">
              Create Project Goal
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setNewGoalModalOpen(false)}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
            title="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2 rounded bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-300 text-xs">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-slate-700 dark:text-[#94a3b8] font-medium">Goal Title *</label>
            <input
              type="text"
              autoFocus
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              placeholder="e.g. Real-Time Concurrency Architecture"
              className="w-full bg-slate-50 dark:bg-[#090d16] border border-slate-300 dark:border-[#2d3748] rounded px-3 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-slate-700 dark:text-[#94a3b8] font-medium">Description & Scope (Optional)</label>
            <textarea
              rows={3}
              value={goalDescription}
              onChange={(e) => setGoalDescription(e.target.value)}
              placeholder="e.g. Coordinate API and UI work using the configured model"
              className="w-full bg-slate-50 dark:bg-[#090d16] border border-slate-300 dark:border-[#2d3748] rounded px-3 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-slate-700 dark:text-[#94a3b8] font-medium">Acceptance Criteria (Optional)</label>
            <input
              type="text"
              value={goalCriteria}
              onChange={(e) => setGoalCriteria(e.target.value)}
              placeholder="e.g. API contract documented, relevant tests pass (comma separated)"
              className="w-full bg-slate-50 dark:bg-[#090d16] border border-slate-300 dark:border-[#2d3748] rounded px-3 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-slate-700 dark:text-[#94a3b8] font-medium flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span>Check-In Policy</span>
              </label>
              <select
                value={checkInPolicy}
                onChange={(e) => setCheckInPolicy(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#090d16] border border-slate-300 dark:border-[#2d3748] rounded px-2.5 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="per_milestone">Per Milestone</option>
                <option value="daily">Daily Cadence</option>
                <option value="turn_based">Turn-Based (Every 5 Turns)</option>
                <option value="autonomous">Autonomous (On Completion Only)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-700 dark:text-[#94a3b8] font-medium flex items-center space-x-1">
                <Calendar className="w-3.5 h-3.5 text-purple-500" />
                <span>Deadline (Optional)</span>
              </label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#090d16] border border-slate-300 dark:border-[#2d3748] rounded px-2.5 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="p-2.5 rounded bg-slate-100 dark:bg-[#070b12] border border-slate-200 dark:border-[#1e293b] text-slate-600 dark:text-[#94a3b8] space-y-1 text-[11px]">
            <div className="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Project Grounding</span>
            </div>
            <p>
              Target Project: <span className="font-mono text-slate-900 dark:text-white font-bold">{activeProject?.name || 'KIN'}</span>.
              Creating a goal populates the task DAG and activates autonomous execution tracking.
            </p>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setNewGoalModalOpen(false)}
              className="px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 dark:bg-[#1e293b] dark:hover:bg-[#334155] text-slate-800 dark:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !goalTitle.trim()}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition disabled:opacity-40 cursor-pointer shadow-xs"
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
