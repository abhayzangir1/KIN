# Parallel coding with Git worktrees

KIN's coding paths can provision Git worktrees for supported tasks. A worktree gives a task a separate working directory; it does not isolate processes, credentials, network access, or the host.

## Review checklist

1. Confirm the project path is the intended Git repository and the target branch exists.
2. Review the task instructions, agent capabilities, and requested tools.
3. Check that the coding task received its own worktree before permitting writes.
4. Inspect the complete diff and commit, then run the appropriate build and tests.
5. Review the merge result and verify the destination branch yourself.

If worktree creation, tests, or merge fail, inspect the task and run state before retrying. An application status or generated summary is not a substitute for reviewing the files and build output.
