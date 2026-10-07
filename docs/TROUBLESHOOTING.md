# KIN Troubleshooting Guide

This guide covers common local development and runtime issues. KIN is under active development, so check the current logs and API response before relying on a recovery or provider status shown by the UI.

## SQLite reports `SQLITE_BUSY` or a database lock

Close the KIN desktop app and stop the core daemon before attempting a backup or maintenance operation. Check Task Manager or the terminal that started the daemon for another KIN/Node process. Avoid stopping every `node` process on the machine, deleting SQLite WAL files, or copying the database while KIN is running; those actions can interrupt unrelated programs or leave a backup incomplete.

After confirming that no KIN process is using the database, restart KIN. If the lock persists, preserve a copy of the database files and logs before attempting recovery. See [Operations](OPERATIONS.md) for backup guidance.

## A run appears stuck

Check the run state, latest channel message, daemon log, and task status. A run can be waiting for a model response, tool approval, a provider retry, or another agent. The UI status alone does not identify which condition applies.

Use the app’s pause or abort action if it is available for that run. The core also exposes `POST /api/runs/abort`; send the run ID as JSON:

```bash
curl -X POST http://127.0.0.1:54321/api/runs/abort \
  -H "Content-Type: application/json" \
  -d '{"runId":"<RUN_ID>"}'
```

Restart recovery and checkpoint behavior depend on the run state and the work already completed. Review the run and project files after a restart; do not assume every interrupted action was resumed or rolled back.

## Ollama or a model is unavailable

First check whether Ollama is running and whether the model is installed:

```bash
curl http://127.0.0.1:11434/api/tags
ollama list
```

If needed, install a model supported by your machine, for example:

```bash
ollama pull llama3.2
```

KIN exposes `GET /api/system/models` and `GET /api/system/models/readiness`. Treat those responses as application-reported discovery/readiness, not proof that a model call will succeed; provider readiness currently has known accuracy gaps. Select a configured model and retry. KIN does not provide automatic fallback from a hosted provider to Ollama.

For hosted providers, check that the relevant credential is configured and accepted by that provider. A saved key or a model appearing in a dropdown does not by itself prove that the account can use the model.

## A provider returns HTTP 429 or a quota error

The run may enter a quota-paused state and the app may show a reset time or resume controls. Retry timing and resume behavior depend on the provider response and the run path. Inspect the run state and provider response before retrying; do not assume a countdown, automatic failover, or lossless continuation. To continue locally, choose an installed Ollama model explicitly and start or resume the run if the UI permits it.

## The daemon port is already in use

The core daemon defaults to `127.0.0.1:54321`. Find the process using that port before stopping anything:

```powershell
netstat -ano | findstr :54321
```

The daemon reads `KIN_PORT`. From the repository root, after building the core, start it on a different port:

```powershell
npm run build --workspace=core
$env:KIN_PORT = "54322"
npm run daemon --workspace=core
```

On macOS or Linux:

```bash
npm run build --workspace=core
KIN_PORT=54322 npm run daemon --workspace=core
```

The server binds to loopback (`127.0.0.1`); changing the port does not expose it to the local network.

## A filesystem tool rejects a path

Use a path relative to the active project root where the tool expects one, and check for typos or `..` segments. These application-level checks are not an operating-system sandbox and do not prove that every route, integration, or process is confined to the project directory. Avoid placing credentials or unrelated private files in a project that agents can access.

## The UI or desktop shell does not start

Use the repository setup instructions in the [README](../README.md), then inspect the terminal output from the command that failed. Core, UI, and Tauri packaging have separate setup and runtime requirements. A successful development launch does not establish that a packaged desktop build works on a clean machine.
