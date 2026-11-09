import React, { useState } from 'react';
import { X, GitCommit, Check, AlertTriangle } from 'lucide-react';
import { TaskItem } from '../../store/kinStore.js';

/**
 * Checks whether adding candidateDepId as a prerequisite to taskId would introduce a circular dependency cycle.
 * Traverses candidateDepId's existing dependency chain via BFS. If taskId is reachable from candidateDepId,
 * adding taskId -> candidateDepId would close the loop.
 *
 * @param taskId The task to which a prerequisite is being added
 * @param candidateDepId The candidate prerequisite task
 * @param allTasks Array of all tasks in the project/system
 * @returns true if adding candidateDepId would create a cycle, false otherwise
 */
export function wouldCreateCycle(
  taskId: string,
  candidateDepId: string,
  allTasks: Array<{ id: string; dependsOnTaskIds?: string[] }>
): boolean {
  if (!taskId || !candidateDepId) return false;
  // Direct self-dependency
  if (taskId === candidateDepId) return true;

  const taskMap = new Map<string, string[]>();
  for (const t of allTasks) {
    taskMap.set(t.id, t.dependsOnTaskIds || []);
  }

  // BFS starting from candidateDepId
  const queue: string[] = [candidateDepId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) {
      return true; // Cycle detected
    }
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = taskMap.get(current) || [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return false;
}

export interface PrerequisiteSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: TaskItem;
  allTasks: TaskItem[];
  onSave: (taskId: string, newPrerequisiteIds: string[]) => Promise<void> | void;
}

export const PrerequisiteSelectorModal: React.FC<PrerequisiteSelectorModalProps> = ({
  isOpen,
  onClose,
  task,
  allTasks,
  onSave,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>(task.dependsOnTaskIds || []);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const candidateTasks = allTasks.filter((t) => t.id !== task.id);

  const toggleDep = (candidateId: string) => {
    if (selectedIds.includes(candidateId)) {
      setSelectedIds(selectedIds.filter((id) => id !== candidateId));
    } else {
      if (!wouldCreateCycle(task.id, candidateId, allTasks)) {
        setSelectedIds([...selectedIds, candidateId]);
      }
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(task.id, selectedIds);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prereq-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
    >
      <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden font-sans text-xs">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-100 dark:bg-[#070b14] border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2">
            <GitCommit className="w-4 h-4 text-blue-500" />
            <h2 id="prereq-modal-title" className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">
              Manage Prerequisites: {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 space-y-3">
          <p className="text-slate-600 dark:text-slate-400 text-xs">
            Select prerequisite tasks that must complete before this task can become <strong>Ready</strong>. Cycles are automatically detected and blocked.
          </p>

          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {candidateTasks.length === 0 ? (
              <div className="p-4 text-center text-slate-400 italic font-mono text-xs">
                No other tasks in this project.
              </div>
            ) : (
              candidateTasks.map((candidate) => {
                const isSelected = selectedIds.includes(candidate.id);
                const causesCycle = !isSelected && wouldCreateCycle(task.id, candidate.id, allTasks);

                return (
                  <div
                    key={candidate.id}
                    onClick={() => !causesCycle && toggleDep(candidate.id)}
                    className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                      causesCycle
                        ? 'opacity-40 bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                        : isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-700 cursor-pointer'
                        : 'bg-white dark:bg-[#090e1a] border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {candidate.title}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          Status: <span className="uppercase">{candidate.status}</span>
                        </div>
                      </div>
                    </div>

                    {causesCycle ? (
                      <span className="flex items-center space-x-1 text-[10px] text-amber-600 dark:text-amber-400 font-mono shrink-0">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Cycle Detected</span>
                      </span>
                    ) : isSelected ? (
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold shrink-0">
                        Prerequisite
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 shrink-0">Click to add</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-[#070b14] border-t border-slate-200 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 font-mono">
            Selected prerequisites: <strong>{selectedIds.length}</strong>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold transition cursor-pointer shadow-xs"
            >
              {isSaving ? 'Saving...' : 'Save Prerequisites'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
