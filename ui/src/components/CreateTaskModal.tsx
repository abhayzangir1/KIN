import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { X, CheckSquare, Plus, Bot, Target } from 'lucide-react';

export const CreateTaskModal: React.FC = () => {
  const { isNewTaskModalOpen, setNewTaskModalOpen, createTask, goals, agents } = useKinStore();
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (goals.length > 0 && !selectedGoalId) {
      setSelectedGoalId(goals[0].id);
    }
  }, [goals, selectedGoalId]);

  if (!isNewTaskModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) {
      setError('Task title is required');
      return;
    }
    if (!selectedGoalId) {
      setError('A target goal must be selected');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await createTask(
        selectedGoalId,
        taskTitle.trim(),
        taskDescription.trim() || undefined,
        assignedAgentId || undefined
      );
      setTaskTitle('');
      setTaskDescription('');
      setNewTaskModalOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl w-full max-w-md shadow-2xl p-5 space-y-4 font-sans text-xs">
        <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
          <div className="flex items-center space-x-2">
            <CheckSquare className="w-5 h-5 text-blue-400" />
            <h2 className="text-sm font-bold text-kin-text">Create Task in DAG</h2>
          </div>
          <button
            onClick={() => setNewTaskModalOpen(false)}
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
            <label className="text-[#94a3b8] font-medium flex items-center space-x-1">
              <Target className="w-3 h-3 text-emerald-400" />
              <span>Target Goal *</span>
            </label>
            <select
              value={selectedGoalId}
              onChange={(e) => setSelectedGoalId(e.target.value)}
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 font-mono text-xs"
            >
              {goals.length === 0 ? (
                <option value="">No active goals (Create goal first)</option>
              ) : (
                goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title} ({g.status})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[#94a3b8] font-medium">Task Title *</label>
            <input
              type="text"
              autoFocus
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Implement SQLite WAL stress test runner"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-1.5 text-kin-text focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[#94a3b8] font-medium">Description & Objective (Optional)</label>
            <textarea
              rows={3}
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="e.g. Verify concurrent write throughput under multi-agent load with zero lock contention"
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[#94a3b8] font-medium flex items-center space-x-1">
              <Bot className="w-3 h-3 text-purple-400" />
              <span>Assigned Specialist (Optional)</span>
            </label>
            <select
              value={assignedAgentId}
              onChange={(e) => setAssignedAgentId(e.target.value)}
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 font-mono text-xs"
            >
              <option value="">Unassigned (Open for Workforce Claim)</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.displayName} ({ag.role || 'Specialist'})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#1e293b]">
            <button
              type="button"
              onClick={() => setNewTaskModalOpen(false)}
              className="px-3 py-1.5 rounded bg-transparent hover:bg-[#1e293b] text-[#94a3b8] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !taskTitle.trim() || !selectedGoalId}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-40 shadow-lg shadow-blue-900/30"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Creating...' : 'Create Task'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
