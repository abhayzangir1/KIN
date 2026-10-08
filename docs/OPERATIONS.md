# Local development and operations

This guide covers running KIN from the repository and basic local data handling. It is not a production deployment or backup certification.

## Requirements

- Node.js 20 or later
- npm
- Rust and platform build tools for the Tauri desktop shell
- Ollama only when using local Ollama inference

## Start the development application

From the repository root:

```sh
npm install
npm run build
```

Start the core and UI in separate terminals:

```sh
npm run daemon --workspace=core
```

```sh
npm run dev --workspace=ui
```

The core defaults to `127.0.0.1:54321`; `KIN_PORT` selects a different port. The server binds to loopback in the default configuration. The UI development server uses port 5173.

## Application data and backups

KIN stores structured state in SQLite and project data in local directories. The database may contain provider credentials and should be handled as sensitive data. Stop KIN before making a simple file-copy backup of the database, its SQLite sidecar files, relevant `.kin` data, and project files. Keep them from the same stopped snapshot.

Do not delete SQLite WAL or shared-memory files while a process has the database open. Restore data only after stopping the daemon. This guide does not define or validate an online backup procedure.

## Operational boundaries

- Hosted model requests, browser destinations, and configured MCP tools may receive data from KIN.
- Provider quotas and billing are managed by providers; local token accounting is not a billing limit.
- Git worktrees isolate working directories only.
- A Tauri build result does not establish a clean-machine install or portable execution.
- A model marked configured or listed in a catalog still needs a successful inference request to demonstrate availability.

For implementation boundaries, see [Current implementation notes](PROJECT_STATUS.md).
