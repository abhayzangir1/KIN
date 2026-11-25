# Tutorial 3: Parallel Coding with Git Worktree Isolation

One of KIN's most powerful capabilities is parallelizing software engineering tasks across multiple specialist agents without contaminating your active git working branch. This tutorial demonstrates how KIN automatically provisions isolated Git worktrees, serializes filesystem modifications, runs automated tests, and presents clean pull-request ready diffs.

---

## Why Git Worktrees?

When multiple agents write code concurrently in a shared repository, standard file edits cause race conditions, dirty working tree conflicts, and broken builds.

KIN solves this via **Ephemeral Git Worktrees** (`.kin/worktrees/<run-id>-<slug>/`):
- Each coding task run receives its own isolated directory linked to the parent repository.
- Agents operate on dedicated temporary branches (e.g. `feat/kin-<run-id>-<slug>`).
- Worktrees are serialized with an internal lock during creation and deletion phases.
- The operator's main working tree remains untouched while tests compile and pass in isolation.

```
Main Git Working Tree (/workspace/project [branch: main])
              │
              ├──► Worktree 1 (.kin/worktrees/run-1-auth [branch: feat/kin-run-1-auth])
              │         │
              │         └──► [@Coder-A] writes auth middleware & runs tests
              │
              └──► Worktree 2 (.kin/worktrees/run-2-ui [branch: feat/kin-run-2-ui])
                        │
                        └──► [@Coder-B] updates React components & runs tests
```

---

## Step-by-Step Walkthrough

### Step 1: Assigning a Task to `@Coder`
First ensure `@Coder` is hired in the channel (`/hire @Coder Backend specialist`), then assign a task:
```text
/assign @Coder Implement exponential backoff retry logic and unit tests for 429 and 503 status codes
```

### Step 2: Automatic Worktree Provisioning
When `CoreServer.executeAgentResponse` begins a coding run, KIN's `WorktreeManager`:
1. Acquires the repository lock.
2. Runs `git worktree add -b feat/kin-<run-id>-<slug> .kin/worktrees/<run-id>-<slug> HEAD`.
3. Sets the agent's filesystem root (`Cwd`) strictly inside the isolated worktree directory.
4. Broadcasts worktree and execution telemetry via SSE.

### Step 3: Agent Code Generation & Inspection
Inside the worktree, `@Coder`:
- Reads existing utilities using `readFile`.
- Authors edits using `editFile` or `writeFile`.
- Verifies syntax and executes local tests using `executeShell`:
  ```bash
  npm test --workspace=core -- test/foundation.test.ts
  ```

### Step 4: Verification and Diff Review
Once tests pass, `@Coder`:
- Commits the changes to the dedicated branch:
  ```bash
  git commit -m "feat(http): implement exponential backoff retry with jitter"
  ```
- Posts a structured review card in the channel with:
  - Branch name and commit SHA.
  - Formatted git diff summary.
  - Test output confirmation (e.g. `6 tests passed, 0 failures`).

### Step 5: Merge Approval & Worktree Pruning
1. The operator reviews the diff in the channel card or using KIN's built-in Diff Viewer.
2. Use `/undo`, `/redo`, or `/fork` (or the Review tab worktree buttons) to revert, re-apply, or branch turn commits cleanly.
3. Merge or clean up the temporary worktree directory:
   ```bash
   git worktree remove --force .kin/worktrees/<run-id>-<slug>
   ```

---

## Safety Guidelines & Guardrails
- **Path Confinement**: KIN validates all file operation paths against the active project boundary and task worktree. Path traversal attempts (`../../`) outside the allowed boundary are strictly rejected.
- **Never Commit Secrets**: Worktree branches inherit your project's `.gitignore`. Always ensure `.env` and credential files are ignored before launching parallel agents.
- **Locking & Concurrency**: While worktrees allow parallel compilation and editing, database migrations or operations altering shared system state should be sequenced via task dependencies in your `/plan`.
