import React, { useState, useEffect, useMemo } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { X, CheckSquare, Plus, Bot, Target, GitFork } from 'lucide-react';

export const CreateTaskModal: React.FC = () => {
  const { isNewTaskModalOpen, setNewTaskModalOpen, createTask, goals, agents, tasks } = useKinStore();
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [selectedDependsOn, setSelectedDependsOn] = useState<string[]>([]);
  const [showAllProjectTasks, setShowAllProjectTasks] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (goals.length > 0 && !selectedGoalId) {
      setSelectedGoalId(goals[0].id);
    }
  }, [goals, selectedGoalId]);

  useEffect(() => {
    if (!isNewTaskModalOpen) {
      setSelectedDependsOn([]);
      setShowAllProjectTasks(false);
      setError('');
    }
  }, [isNewTaskModalOpen]);

  const goalTasks = useMemo(() => {
    return tasks.filter((t) => t.goalId === selectedGoalId);
  }, [tasks, selectedGoalId]);

  const candidateTasks = useMemo(() => {
    if (!showAllProjectTasks && goalTasks.length > 0) {
      return goalTasks;
    }
    return tasks;
  }, [showAllProjectTasks, goalTasks, tasks]);

  const toggleDependency = (taskId: string) => {
    setSelectedDependsOn((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

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
      const res = await createTask(
        selectedGoalId,
        taskTitle.trim(),
        taskDescription.trim() || undefined,
        assignedAgentId || undefined,
        selectedDependsOn.length > 0 ? selectedDependsOn : undefined
      );
      if (res && !res.success) {
        setError(res.error || 'Failed to create task');
        return;
      }
      setTaskTitle('');
      setTaskDescription('');
      setSelectedDependsOn([]);
      setShowAllProjectTasks(false);
      setNewTaskModalOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl w-full max-w-md shadow-2xl p-5 space-y-4 font-sans text-xs max-h-[90vh] overflow-y-auto">
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[#94a3b8] font-medium flex items-center space-x-1">
                <GitFork className="w-3 h-3 text-cyan-400" />
                <span>Prerequisite Tasks / Dependencies (Optional)</span>
              </label>
              {selectedDependsOn.length > 0 && (
                <span className="text-[10px] text-cyan-400 font-mono">
                  {selectedDependsOn.length} selected
                </span>
              )}
            </div>

            {tasks.length === 0 ? (
              <div className="p-2 rounded bg-[#090d16] border border-[#2d3748] text-[#64748b] text-[11px] italic">
                No existing tasks in project (task will be ready immediately)
              </div>
            ) : (
              <div className="space-y-1">
                {goalTasks.length > 0 && tasks.length > goalTasks.length && (
                  <div className="flex items-center justify-between text-[10px] text-[#64748b] px-0.5">
                    <span>
                      {showAllProjectTasks
                        ? `Showing all ${tasks.length} project tasks`
                        : `Showing ${goalTasks.length} task(s) in selected goal`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAllProjectTasks(!showAllProjectTasks)}
                      className="text-blue-400 hover:text-blue-300 underline transition cursor-pointer"
                    >
                      {showAllProjectTasks ? 'This goal only' : 'Show all project tasks'}
                    </button>
                  </div>
                )}
                <div className="max-h-32 overflow-y-auto bg-[#090d16] border border-[#2d3748] rounded p-1 space-y-0.5">
                  {candidateTasks.map((t) => {
                    const isSelected = selectedDependsOn.includes(t.id);
                    const goal = goals.find((g) => g.id === t.goalId);
                    return (
                      <label
                        key={t.id}
                        className={`flex items-start space-x-2 p-1.5 rounded cursor-pointer transition select-none ${
                          isSelected
                            ? 'bg-blue-950/50 text-blue-200 border border-blue-800/50'
                            : 'hover:bg-[#1e293b]/50 text-kin-text border border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleDependency(t.id)}
                          className="mt-0.5 rounded border-[#2d3748] bg-[#0f172a] text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium truncate text-xs">{t.title}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase shrink-0 ${
                                t.status === 'completed'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : t.status === 'running'
                                  ? 'bg-blue-950 text-blue-400 border border-blue-800'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {t.status}
                            </span>
                          </div>
                          {goal && goal.id !== selectedGoalId && (
                            <div className="text-[10px] text-[#64748b] truncate">
                              Goal: {goal.title}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                {selectedDependsOn.length > 0 && (
                  <p className="text-[10px] text-[#64748b] italic">
                    Task will stay in backlog until all selected prerequisites complete.
                  </p>
                )}
              </div>
            )}
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
