# Troubleshooting

## The UI cannot reach the core

Confirm that the daemon is running and listening at the configured `KIN_PORT` (54321 by default). Check the daemon terminal for startup errors. If IPC authentication is enabled, confirm the UI is using the token created for that runtime.

## A run appears stuck

Inspect the run and task state, the latest channel message, pending approvals, and the daemon log. A run can be waiting on a provider, a tool, a queue slot, or operator review. Do not stop unrelated Node processes to recover KIN.

## A model is missing or fails

Check the selected provider/model ID, saved credential, provider access, and (for Ollama) that the daemon and model are available. Catalog presence or a configured-key indicator does not prove an inference request will work. Provider quotas and billing are controlled by the provider.

## A schedule did not run

Inspect its status, next-run time, attempt/error information, target channel, and target agent. Confirm that KIN was running when it became due and that the target model/tools were available. A successful dispatch is not proof that the agent completed the requested work.

## A filesystem action is rejected

Check the active project path, task worktree, and requested file location. KIN's application path checks and Git worktrees are not host-level isolation. Do not bypass a rejected path by copying secrets or files into an unintended project.

## SQLite reports a lock or busy error

Check for another KIN daemon using the same database. Stop KIN before copying or restoring the database. Do not delete WAL or shared-memory files while the database is open.

## Tauri fails to build or launch

Check Rust/Cargo and platform build tools, run `npm install`, and build the UI/core from the repository. A successful compile does not establish that the release bundle includes every runtime dependency needed by a clean machine.
