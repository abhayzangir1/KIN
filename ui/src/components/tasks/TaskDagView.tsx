import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  GitCommit,
  Plus,
  Play,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  Filter,
  Settings2,
} from 'lucide-react';
import { useKinStore, TaskItem } from '../../store/kinStore.js';
import { PrerequisiteSelectorModal } from './PrerequisiteSelectorModal.js';

interface StageColumn {
  id: string;
  label: string;
  statuses: string[];
  color: string;
  bgColor: string;
  borderColor: string;
}

const STAGES: StageColumn[] = [
  {
    id: 'backlog',
    label: 'Backlog',
    statuses: ['backlog'],
    color: 'text-slate-600 dark:text-slate-400',
    bgColor: 'bg-slate-50 dark:bg-slate-900/30',
    borderColor: 'border-slate-300 dark:border-slate-800',
  },
  {
    id: 'ready',
    label: 'Ready to Run',
    statuses: ['ready'],
    color: 'text-cyan-700 dark:text-cyan-300',
    bgColor: 'bg-cyan-50/60 dark:bg-cyan-950/20',
    borderColor: 'border-cyan-300 dark:border-cyan-800/50',
  },
  {
    id: 'running',
    label: 'Running / In-Flight',
    statuses: ['running', 'assigned'],
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-50/60 dark:bg-blue-950/20',
    borderColor: 'border-blue-300 dark:border-blue-800/50',
  },
  {
    id: 'review',
    label: 'Needs Review',
    statuses: ['review'],
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-50/60 dark:bg-purple-950/20',
    borderColor: 'border-purple-300 dark:border-purple-800/50',
  },
  {
    id: 'completed',
    label: 'Completed',
    statuses: ['completed'],
    color: 'text-emerald-700 dark:text-emerald-300',
    bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20',
    borderColor: 'border-emerald-300 dark:border-emerald-800/50',
  },
];

export const TaskDagView: React.FC = () => {
  const {
    tasks,
    goals,
    updateTaskStatus,
    deleteTask,
    setNewTaskModalOpen,
    addToast,
  } = useKinStore();

  const [selectedGoalId, setSelectedGoalId] = useState<string>('all');
  const [editingPrereqTask, setEditingPrereqTask] = useState<TaskItem | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});

  // Filter tasks by active project and selected goal
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (selectedGoalId === 'all') return true;
      return t.goalId === selectedGoalId;
    });
  }, [tasks, selectedGoalId]);

  // Tasks map for fast lookup
  const taskMap = useMemo(() => {
    const map = new Map<string, TaskItem>();
    for (const t of tasks) {
      map.set(t.id, t);
    }
    return map;
  }, [tasks]);

  // Measure card coordinates for directional SVG arrows
  useEffect(() => {
    if (!containerRef.current) return;
    const updatePositions = () => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const positions: Record<string, { x: number; y: number }> = {};
      const cardElements = containerRef.current?.querySelectorAll('[data-task-id]');
      cardElements?.forEach((el) => {
        const taskId = el.getAttribute('data-task-id');
        if (taskId) {
          const rect = el.getBoundingClientRect();
          positions[taskId] = {
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top + rect.height / 2,
          };
        }
      });
      setNodePositions(positions);
    };

    updatePositions();
    const handleResize = () => updatePositions();
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(updatePositions, 300);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [filteredTasks]);

  // Calculate dependency arrows
  const dependencyEdges = useMemo(() => {
    const edges: Array<{ fromId: string; toId: string; from: { x: number; y: number }; to: { x: number; y: number } }> = [];
    for (const task of filteredTasks) {
      if (!task.dependsOnTaskIds || task.dependsOnTaskIds.length === 0) continue;
      const toPos = nodePositions[task.id];
      if (!toPos) continue;

      for (const prereqId of task.dependsOnTaskIds) {
        const fromPos = nodePositions[prereqId];
        if (fromPos) {
          edges.push({
            fromId: prereqId,
            toId: task.id,
            from: fromPos,
            to: toPos,
          });
        }
      }
    }
    return edges;
  }, [filteredTasks, nodePositions]);

  // Prerequisite update handler
  const handleSavePrerequisites = async (taskId: string, newPrereqIds: string[]) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOnTaskIds: newPrereqIds }),
      });
      if (res.ok) {
        useKinStore.setState((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, dependsOnTaskIds: newPrereqIds } : t
          ),
        }));
        addToast('Task prerequisites updated successfully', 'success');
      } else {
        const data = await res.json().catch(() => ({}));
        addToast(data.error || 'Failed to update prerequisites', 'error');
      }
    } catch (err: any) {
      addToast(err?.message || 'Network error updating prerequisites', 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-[#070b14] overflow-hidden text-xs font-sans">
      {/* Top DAG Navigation & Control Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-white dark:bg-[#0c1222] border-b border-slate-200 dark:border-slate-800 shadow-xs gap-2">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 text-blue-600 dark:text-blue-400 font-bold">
            <GitCommit className="w-4 h-4" />
            <span className="text-sm">Task Topological DAG</span>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            {filteredTasks.length} task{filteredTasks.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Goal Filter */}
          <div className="flex items-center space-x-1.5 bg-slate-100 dark:bg-[#060911] border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedGoalId}
              onChange={(e) => setSelectedGoalId(e.target.value)}
              className="bg-transparent text-slate-700 dark:text-slate-200 text-xs focus:outline-none cursor-pointer"
            >
              <option value="all">All Goals & Unassigned</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  Goal: {g.title}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setNewTaskModalOpen(true)}
            className="flex items-center space-x-1 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {/* DAG Stage Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-x-auto overflow-y-auto p-4 select-none min-h-0"
      >
        {/* SVG Directional Arrows Overlay */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
          <defs>
            <marker
              id="dag-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#3b82f6" />
            </marker>
          </defs>
          {dependencyEdges.map((edge, idx) => {
            const dx = edge.to.x - edge.from.x;
            const controlOffset = Math.max(30, Math.abs(dx) * 0.4);
            const pathData = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x + controlOffset} ${edge.from.y}, ${edge.to.x - controlOffset} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`;

            return (
              <path
                key={idx}
                d={pathData}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2"
                strokeDasharray="4 2"
                markerEnd="url(#dag-arrow)"
                className="opacity-70 dark:opacity-80 transition-all duration-300"
              />
            );
          })}
        </svg>

        {/* 5-Column Stages Grid */}
        <div className="grid grid-cols-5 gap-3.5 min-w-[1100px] h-full relative z-10">
          {STAGES.map((stage) => {
            const stageTasks = filteredTasks.filter((t) => stage.statuses.includes(t.status));

            return (
              <div
                key={stage.id}
                className={`flex flex-col rounded-xl border ${stage.borderColor} ${stage.bgColor} p-2.5 shadow-xs`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-800">
                  <span className={`font-bold uppercase tracking-wider text-[11px] ${stage.color}`}>
                    {stage.label}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white dark:bg-black/40 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                    {stageTasks.length}
                  </span>
                </div>

                {/* Task Cards Column */}
                <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
                  {stageTasks.length === 0 ? (
                    <div className="p-4 text-center text-slate-400 dark:text-slate-600 italic text-[11px]">
                      No tasks in this stage.
                    </div>
                  ) : (
                    stageTasks.map((task) => {
                      // Check for incomplete prerequisites
                      const incompletePrereqs = (task.dependsOnTaskIds || [])
                        .map((id) => taskMap.get(id))
                        .filter((t): t is TaskItem => Boolean(t && t.status !== 'completed'));

                      const isBlocked = incompletePrereqs.length > 0;

                      return (
                        <div
                          key={task.id}
                          data-task-id={task.id}
                          className="p-3 bg-white dark:bg-[#0c1220] border border-slate-200 dark:border-slate-800/80 hover:border-blue-400 dark:hover:border-blue-600 rounded-lg shadow-xs space-y-2 transition cursor-default"
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="font-semibold text-slate-800 dark:text-slate-100 text-xs leading-snug line-clamp-2">
                              {task.title}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteTask(task.id)}
                              className="text-slate-400 hover:text-red-500 p-0.5 transition cursor-pointer shrink-0"
                              title="Delete task"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          {task.description && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                              {task.description}
                            </p>
                          )}

                          {/* Blocked by Incomplete Prerequisites Badge */}
                          {isBlocked && (
                            <div className="flex items-center space-x-1 p-1.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/50 text-[10px] text-amber-800 dark:text-amber-300 font-medium">
                              <AlertTriangle className="w-3 h-3 shrink-0 text-amber-500" />
                              <span className="truncate" title={`Blocked by: ${incompletePrereqs.map((p) => p.title).join(', ')}`}>
                                Blocked by: {incompletePrereqs.map((p) => p.title).join(', ')}
                              </span>
                            </div>
                          )}

                          {/* Task Action Bar */}
                          <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800/60 text-[10px] font-mono">
                            <button
                              type="button"
                              onClick={() => setEditingPrereqTask(task)}
                              className="flex items-center space-x-1 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition cursor-pointer"
                              title="Manage prerequisites and dependency links"
                            >
                              <Settings2 className="w-3 h-3" />
                              <span>Prereqs ({(task.dependsOnTaskIds || []).length})</span>
                            </button>

                            {/* Promotion / Execution Controls */}
                            {task.status === 'backlog' && (
                              <button
                                type="button"
                                disabled={isBlocked}
                                onClick={() => updateTaskStatus(task.id, 'ready')}
                                className="px-2 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold transition flex items-center space-x-1 cursor-pointer"
                                title={isBlocked ? 'Resolve prerequisites first' : 'Promote task to Ready stage'}
                              >
                                <span>Promote</span>
                                <ArrowRight className="w-2.5 h-2.5" />
                              </button>
                            )}

                            {task.status === 'ready' && (
                              <button
                                type="button"
                                disabled={isBlocked}
                                onClick={() => updateTaskStatus(task.id, 'running')}
                                className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold transition flex items-center space-x-1 cursor-pointer"
                                title={isBlocked ? 'Prerequisites incomplete' : 'Claim & Run task immediately'}
                              >
                                <Play className="w-2.5 h-2.5" />
                                <span>Claim & Run</span>
                              </button>
                            )}

                            {task.status === 'running' && (
                              <button
                                type="button"
                                onClick={() => updateTaskStatus(task.id, 'review')}
                                className="px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold transition flex items-center space-x-1 cursor-pointer"
                                title="Submit task for architectural and QA review"
                              >
                                <ShieldAlert className="w-2.5 h-2.5" />
                                <span>Submit Review</span>
                              </button>
                            )}

                            {task.status === 'review' && (
                              <button
                                type="button"
                                onClick={() => updateTaskStatus(task.id, 'completed')}
                                className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition flex items-center space-x-1 cursor-pointer"
                                title="Approve and mark task completed"
                              >
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                <span>Approve</span>
                              </button>
                            )}

                            {task.status === 'completed' && (
                              <span className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-bold">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Done</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prerequisite Selector Modal */}
      {editingPrereqTask && (
        <PrerequisiteSelectorModal
          isOpen={true}
          onClose={() => setEditingPrereqTask(null)}
          task={editingPrereqTask}
          allTasks={tasks}
          onSave={handleSavePrerequisites}
        />
      )}
    </div>
  );
};
