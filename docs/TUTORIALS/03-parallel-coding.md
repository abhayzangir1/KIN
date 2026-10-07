# Parallel coding with Git worktrees: workflow sketch

This page is a review checklist, not a claim that parallel coding is isolated or merge-safe in every case. A Git worktree gives each task a separate working directory. It does not isolate processes, credentials, network access, or the host operating system.

## Before assigning coding work

- Confirm the project path is the intended Git repository.
- Confirm the configured default branch exists.
- Review the task description, agent capabilities, and requested tools.
- Keep a backup or clean working tree before testing an automated merge.

## Suggested sequence

1. Create a small test task that changes a disposable file.
2. Confirm that worktree provisioning either returns a separate path or blocks the coding task with a visible error.
3. Inspect the worktree path and branch before allowing file writes.
4. Review the full diff, run the relevant checks, and inspect the commit.
5. Merge only after the base branch and result are confirmed.
6. Verify the project branch contains the expected change and is clean afterward.

## Known limits

- Worktree provisioning failure is intended to fail closed for coding tasks, but this was not runtime-tested in the current audit.
- A merge error is currently logged while the broader run may continue toward success. Inspect the branch yourself and do not rely on task status alone.
- Worktree separation is not a security sandbox.
- Do not assume an automated AI review or zero-conflict merge has occurred unless the current application shows a real result you can inspect.

See the [current audit](../../KIN_AUDIT_2026-10-07.md) for the task-evidence and merge findings.
