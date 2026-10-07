# KIN Development Operations

This guide covers local development and basic data handling. KIN's packaged deployment, crash recovery, and live backup procedures have not been validated as production operations. The core binds to 127.0.0.1 by default.

## Local development

### Requirements

- Node.js 20 or later
- npm
- Rust and platform build tools only when working on the Tauri shell
- Ollama only when using a local model

### Start the core and UI

Install and build from the repository root:

~~~sh
npm install
npm run build
~~~

Run the core and UI in separate terminals:

~~~sh
npm run daemon --workspace=core
~~~

~~~sh
npm run dev --workspace=ui
~~~

The core defaults to 127.0.0.1:54321 and can use KIN_PORT to select a different port. The current daemon does not bind to a configurable network interface through the documented HOST variable. Do not assume remote LAN access is available.

## Backups and restore

For a simple consistent backup, stop KIN cleanly before copying its SQLite database, the relevant .kin data, and project files. Keep those items from the same stopped snapshot. If provider credentials are stored in the database, protect the backup as sensitive data.

Do not copy only the main SQLite file while KIN is running and call the result authoritative. SQLite WAL data and active writes may make an uncoordinated file copy incomplete. KIN does not currently document a tested live-backup command.

To restore, stop the daemon first, restore the database and matching local data/project files, then start KIN. Do not remove WAL or shared-memory files while a daemon is running. If a restore includes stale sidecar files, handle them only with the database closed and according to SQLite recovery guidance.

## Runtime limits

- The kernel defaults to eight active runs. Queue recovery across restart has a known dispatch gap.
- Provider token budgets are not a substitute for provider billing limits; automatic cross-provider fallback is not expected in all situations.
- Readiness indicators may not reflect whether a model provider or Ollama is reachable.
- A Tauri build does not by itself prove that the Node core and runtime are bundled for a clean machine.

## Security boundary notes

- Core HTTP binds to loopback by default and uses local IPC authentication where enabled.
- Git worktrees separate file trees but are not host-level process, network, or credential sandboxes.
- Chromium is currently launched with sandboxing disabled.
- Direct desktop/browser/terminal routes have Sentinel checks, but they do not yet share one canonical action authorization path.
- Hosted models, browser destinations, and MCP servers can receive data from KIN when those integrations are used.

For source-level details and current issues, see the [fresh audit](../KIN_AUDIT_2026-10-07.md) and [previous audit](../KIN_COMPREHENSIVE_AUDIT_AND_FIX_PLAN.md).
