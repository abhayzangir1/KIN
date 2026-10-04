# Tutorial 3: Parallel Feature Development with Git Worktree Isolation & AI Code Review

When multiple specialist agents develop features simultaneously, editing files in a shared working tree leads to branch collisions, git index locks, and clobbered code.

KIN resolves this with isolated git worktrees managed through `WorktreeManager`. Each agent works in an independent directory backed by dedicated branches, with automated AI code reviews conducted before merging.

---

## Architecture of Worktree Isolation

1. **Jailed Confinement**: Every provisioned worktree resides in `.kin/worktrees/<taskId>-<slug>/`. Tool execution validates paths to prevent directory traversal outside the project jail.
2. **Branch Isolation**: Each worktree checks out an isolated branch: `feat/kin-<taskId>-<slug>`.
3. **Optimistic Concurrency Control (OCC)**: Cryptographic content hashes prevent stale writes and alert operators when files are modified concurrently.
4. **AI Code Review**: Automated diff inspection (`POST /api/projects/:id/git/review`) checks architectural boundaries, test coverage, and code correctness before changes are integrated.

---

## Step-by-Step Implementation

### Step 1: Provisioning an Isolated Worktree

When a specialist task begins, the coordinator provisions an isolated git worktree:

```typescript
import { WorktreeManager } from '@kin/core';

const worktreeManager = new WorktreeManager(projectRoot);

// Provision worktree for backend development task
const { worktreePath, branch } = await worktreeManager.provisionWorktree('task-101', 'backend');

console.log(`Worktree created at: ${worktreePath}`);
// Output: .kin/worktrees/task-101-backend
console.log(`Working on branch: ${branch}`);
// Output: feat/kin-task-101-backend
```

If the project root is not yet a git repository, KIN automatically initializes an internal shadow git repository so worktree isolation functions seamlessly without requiring external git hosting.

---

### Step 2: Autonomous Specialist Development

The assigned agent (`@Backend`) executes file operations confined strictly to its isolated worktree:

```typescript
// Agent creates an authentication controller inside the isolated worktree
const controllerCode = `
import { Router } from 'express';
export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  return res.json({ token: 'jwt-session-token' });
});
`;

fs.writeFileSync(path.join(worktreePath, 'src/auth.ts'), controllerCode, 'utf-8');
```

At the same time, `@Frontend` can be developing UI components in its own separate worktree (`task-102-frontend`) with zero file locking conflicts or git contention.

---

### Step 3: Committing Worktree Changes

Once the specialist completes its implementation and tests pass, it records a commit within its worktree:

```typescript
const commitSha = await worktreeManager.commitWorktreeChanges(
  worktreePath,
  'feat(auth): implement basic login route controller'
);

console.log(`Committed changes: ${commitSha}`);
```

The main repository branch remains completely clean and unaffected while feature development takes place.

---

### Step 4: Generating Unified Diffs

To inspect the modifications against the baseline branch:

```typescript
const diff = await worktreeManager.generateDiff(worktreePath, 'main');
console.log(diff);
```

Output:
```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,9 @@
+import { Router } from 'express';
+export const authRouter = Router();
...
```

---

### Step 5: Automated AI Code Review

Before merging, request an AI code review across the modified files via the REST API:

```bash
curl -X POST http://127.0.0.1:54321/api/projects/proj-kin/git/review \
  -H "Content-Type: application/json" \
  -d '{"path": "src/auth.ts"}'
```

#### Response Payload
```json
{
  "path": "src/auth.ts",
  "review": "### Architecture & Security Analysis\n- Validated: Request input validation correctly rejects empty credentials.\n- Recommendation: Replace hardcoded placeholder tokens with cryptographic JWT signing.\n- Boundary Verification: No path traversal or unsafe file access detected."
}
```

The review evaluates:
- **Security Boundaries**: Path safety and parameter sanitization.
- **Architectural Fit**: Adherence to project patterns and conventions.
- **Regression Risks**: Edge cases and missing unit test coverage.

---

### Step 6: Review, Stage, and Clean Up

Once approved by the operator or `@Boss`:
1. Inspect the full staged diff:
   ```bash
   curl -X GET "http://127.0.0.1:54321/api/projects/proj-kin/git/diff"
   ```
2. Stage approved files:
   ```bash
   curl -X POST http://127.0.0.1:54321/api/projects/proj-kin/git/stage \
     -H "Content-Type: application/json" \
     -d '{"path": "src/auth.ts"}'
   ```
3. Remove the temporary worktree cleanly:
   ```typescript
   await worktreeManager.removeWorktree(worktreePath);
   ```

Parallel development completes with full traceability, verified isolation, and zero repository corruption.
