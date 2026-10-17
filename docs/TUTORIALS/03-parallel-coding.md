# Tutorial 3: Parallel Coding with Git Worktree Isolation

One of KIN's most powerful capabilities is parallelizing software engineering tasks across multiple specialist agents without contaminating your active git working branch. This tutorial demonstrates how KIN automatically provisions isolated Git worktrees, serializes filesystem modifications, runs automated tests, and presents clean pull-request ready diffs.

---

## Why Git Worktrees?

When multiple agents write code concurrently in a shared repository, standard file edits cause race conditions, dirty working tree conflicts, and broken builds.

KIN solves this via **Ephemeral Git Worktrees** (`.kin/worktrees/<task-id>/`):
- Each coding task receives its own isolated directory linked to the parent repository.
- Agents operate on dedicated temporary branches (e.g. `kin/task-8910-feat`).
- Worktrees are serialized with an `AsyncMutex` lock during critical creation and deletion phases.
- The operator's main working tree remains untouched while tests compile and pass in isolation.

```
Main Git Working Tree (d:/KIN [branch: main])
              │
              ├──► Worktree 1 (.kin/worktrees/task-1-auth [branch: kin/task-1])
              │         │
              │         └──► [@Coder-A] writes auth middleware & runs tests
              │
              └──► Worktree 2 (.kin/worktrees/task-2-ui [branch: kin/task-2])
                        │
                        └──► [@Coder-B] updates React components & runs tests
```

---

## Step-by-Step Walkthrough

### Step 1: Assigning a Task to `@Coder`
In your project channel or via direct message, assign a concrete implementation task:
```text
/assign @Coder Implement exponential backoff retry strategy in core/src/utils/http.ts | Must include unit test suite and handle 429 and 503 status codes
```

### Step 2: Automatic Worktree Provisioning
When the task begins execution, KIN's `ToolGateway` detects the coding capability requirement and:
1. Acquires the repository mutex.
2. Runs `git worktree add .kin/worktrees/task-<id> -b kin/task-<id>`.
3. Sets the agent's filesystem root (`Cwd`) strictly inside the isolated worktree directory.
4. Broadcasts a `task:updated` SSE event displaying the active worktree path.

### Step 3: Agent Code Generation & Inspection
Inside the worktree, `@Coder`:
- Reads existing utilities using `readFile`.
- Authors the replacement or new file using `replace_file_content` or `write_to_file`.
- Verifies syntax and executes local tests using `executeShell`:
  ```bash
  npm test -- core/test/http_retry.test.ts
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
2. To merge into `main`:
   ```text
   Merge branch kin/task-<id> into main and remove worktree
   ```
3. KIN merges the branch, runs a pre-merge sanity check, and cleans up the temporary worktree directory:
   ```bash
   git worktree remove --force .kin/worktrees/task-<id>
   ```

---

## Safety Guidelines & Guardrails
- **Path Confinement**: KIN validates all file operation paths against the active project boundary and task worktree. Path traversal attempts (`../../`) outside the allowed boundary are strictly rejected.
- **Never Commit Secrets**: Worktree branches inherit your project's `.gitignore`. Always ensure `.env` and credential files are ignored before launching parallel agents.
- **Locking & Concurrency**: While worktrees allow parallel compilation and editing, database migrations or operations altering shared system state should be sequenced via task dependencies in your `/plan`.
