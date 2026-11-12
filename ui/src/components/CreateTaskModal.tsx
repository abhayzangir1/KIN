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
      <div className="bg-kin-surface border border-kin-border rounded-xl w-full max-w-md shadow-2xl p-5 space-y-4 font-sans text-xs max-h-[90vh] overflow-y-auto backdrop-blur-xl text-kin-text">
        <div className="flex items-center justify-between pb-3 border-b border-kin-border">
          <div className="flex items-center space-x-2">
            <CheckSquare className="w-5 h-5 text-blue-400" />
            <h2 className="text-sm font-bold text-kin-text">Create Task in DAG</h2>
          </div>
          <button
            onClick={() => setNewTaskModalOpen(false)}
            className="text-kin-muted hover:text-kin-text transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-kin-muted font-medium flex items-center space-x-1">
              <Target className="w-3 h-3 text-emerald-400" />
              <span>Target Goal *</span>
            </label>
            <select
              value={selectedGoalId}
              onChange={(e) => setSelectedGoalId(e.target.value)}
              className="w-full bg-kin-surface border border-kin-border rounded-lg px-3 py-1.5 text-kin-text focus:outline-none focus:border-kin-accent focus:ring-1 focus:ring-kin-accent font-mono text-xs"
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
            <label className="text-kin-muted font-medium">Task Title *</label>
            <input
              type="text"
              autoFocus
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Implement SQLite WAL stress test runner"
              className="w-full bg-kin-surface border border-kin-border rounded-lg px-3 py-1.5 text-kin-text focus:outline-none focus:border-kin-accent focus:ring-1 focus:ring-kin-accent"
            />
          </div>

          <div className="space-y-1">
            <label className="text-kin-muted font-medium">Description & Objective (Optional)</label>
            <textarea
              rows={3}
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="e.g. Verify concurrent write throughput under multi-agent load with zero lock contention"
              className="w-full bg-kin-surface border border-kin-border rounded-lg px-3 py-1.5 text-kin-text focus:outline-none focus:border-kin-accent focus:ring-1 focus:ring-kin-accent resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-kin-muted font-medium flex items-center space-x-1">
              <Bot className="w-3 h-3 text-purple-400" />
              <span>Assigned Specialist (Optional)</span>
            </label>
            <select
              value={assignedAgentId}
              onChange={(e) => setAssignedAgentId(e.target.value)}
              className="w-full bg-kin-surface border border-kin-border rounded-lg px-3 py-1.5 text-kin-text focus:outline-none focus:border-kin-accent focus:ring-1 focus:ring-kin-accent font-mono text-xs"
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
              <label className="text-kin-muted font-medium flex items-center space-x-1">
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
              <div className="p-2 rounded-lg bg-kin-card border border-kin-border text-kin-subtle text-[11px] italic">
                No existing tasks in project (task will be ready immediately)
              </div>
            ) : (
              <div className="space-y-1">
                {goalTasks.length > 0 && tasks.length > goalTasks.length && (
                  <div className="flex items-center justify-between text-[10px] text-kin-subtle px-0.5">
                    <span>
                      {showAllProjectTasks
                        ? `Showing all ${tasks.length} project tasks`
                        : `Showing ${goalTasks.length} task(s) in selected goal`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAllProjectTasks(!showAllProjectTasks)}
                      className="text-kin-accent hover:underline transition cursor-pointer"
                    >
                      {showAllProjectTasks ? 'This goal only' : 'Show all project tasks'}
                    </button>
                  </div>
                )}
                <div className="max-h-32 overflow-y-auto bg-kin-card border border-kin-border rounded-lg p-1 space-y-0.5">
                  {candidateTasks.map((t) => {
                    const isSelected = selectedDependsOn.includes(t.id);
                    const goal = goals.find((g) => g.id === t.goalId);
                    return (
                      <label
                        key={t.id}
                        className={`flex items-start space-x-2 p-1.5 rounded-lg cursor-pointer transition select-none ${
                          isSelected
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                            : 'hover:bg-kin-surfaceHover text-kin-text border border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleDependency(t.id)}
                          className="mt-0.5 rounded border-kin-border bg-kin-surface text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium truncate text-xs">{t.title}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase shrink-0 ${
                                t.status === 'completed'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : t.status === 'running'
                                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                  : 'bg-kin-surface text-kin-muted border border-kin-border'
                              }`}
                            >
                              {t.status}
                            </span>
                          </div>
                          {goal && goal.id !== selectedGoalId && (
                            <div className="text-[10px] text-kin-subtle truncate">
                              Goal: {goal.title}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                {selectedDependsOn.length > 0 && (
                  <p className="text-[10px] text-kin-subtle italic">
                    Task will stay in backlog until all selected prerequisites complete.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-kin-border">
            <button
              type="button"
              onClick={() => setNewTaskModalOpen(false)}
              className="px-3.5 py-1.5 rounded-lg bg-kin-card hover:bg-kin-cardHover border border-kin-border text-kin-muted hover:text-kin-text transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !taskTitle.trim() || !selectedGoalId}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-40 shadow-sm cursor-pointer"
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
