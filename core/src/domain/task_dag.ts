// ============================================================================
// KIN DOMAIN: TASK DAG CYCLE PREVENTION & TOPOLOGICAL VALIDATION
// Checks candidate prerequisites for dependency loops and validates DAG integrity.
// Matches ui/src/components/tasks/PrerequisiteSelectorModal.tsx and task_repository.ts.
// ============================================================================

export interface DagTaskNode {
  id: string;
  title?: string;
  status?: string;
  dependsOnTaskIds?: string[];
}

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
export function wouldCreateCycleInMemory(
  taskId: string,
  candidateDepId: string,
  allTasks: DagTaskNode[]
): boolean {
  if (!taskId || !candidateDepId) return false;
  if (taskId === candidateDepId) return true; // Direct self-dependency

  const taskMap = new Map<string, string[]>();
  for (const t of allTasks) {
    taskMap.set(t.id, t.dependsOnTaskIds || []);
  }

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
