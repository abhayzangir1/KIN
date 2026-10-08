# KIN

KIN is a local-first, desktop-oriented workspace for AI chats, projects, and agent workflows. The repository contains a TypeScript core service, a React interface, a Tauri/Rust desktop shell, and SQLite-backed application state.

KIN is under active development. Features described here are present in source unless stated otherwise; this is not a claim that every workflow has been validated end to end.

## What is in the repository

- Projects, channels, direct-message views, agent identities and definitions, goals, tasks, and task dependencies.
- A default orchestrator named `@Boss`, specialist agents, and agent runs coordinated through the local core.
- A model gateway with provider integrations, credential settings, model discovery, custom model records, and an Ollama path. Provider availability depends on configuration and actual provider responses.
- A tool gateway, approval and capability checks, skills, MCP stdio clients, schedules, browser control, and desktop-control paths.
- A Tauri desktop shell and a browser-based development UI.

The codebase does not include a general marketplace/plugin registry. Git worktrees separate working directories; they do not isolate processes, credentials, or network access. Browser, desktop, skill, model, recovery, and packaged-app behavior depends on the host and configuration.

## Run from source

### Requirements

- Node.js 20 or later
- npm
- Rust and platform build tools to build the Tauri desktop shell
- Ollama only if you want to use local Ollama inference

### Install and build

```sh
git clone https://github.com/abhayzangir1/KIN.git
cd KIN
npm install
npm run build
```

Run the core and UI in separate terminals:

```sh
npm run daemon --workspace=core
```

```sh
npm run dev --workspace=ui
```

The development UI uses `http://localhost:5173`. The core defaults to `127.0.0.1:54321` and does not bind to a LAN interface by default. The repository's `start.bat` and `start.sh` scripts are development launchers, not self-contained installers.

Run the core tests with:

```sh
npm test --workspace=core
```

This command reports results for the checkout and environment where it is run; this README does not assert a current test count or pass status.

## Models and data handling

Provider credentials can be managed in Settings. The model gateway contains discovery paths for supported providers and Ollama. A model appearing in a catalog or being marked configured does not prove that inference will succeed. Provider lists, model capabilities, pricing metadata, account access, quotas, and availability can change; verify by making a real request before relying on a model.

Application state is stored locally in SQLite and project files use the local filesystem. Hosted model requests send prompts and selected context to that provider. Browser navigation contacts the requested websites. MCP tools receive the arguments passed to them. Local storage does not imply that all application activity is offline.

## Boundaries to understand

- Capability checks and approval flows are application controls; they are not a host-level security sandbox.
- A Git worktree is a separate working directory, not process, network, or credential isolation.
- Skills and MCP servers may execute code or external tools. Review their source and configuration before enabling them.
- The Tauri build configuration exists, but a clean-machine installation with all required core/runtime dependencies has not been established by this README.
- Product requirements in [PRD](docs/PRD.md) and [TRD](docs/TRD.md) describe desired behavior. See [current implementation notes](docs/PROJECT_STATUS.md) for the source-level scope and known boundaries.

## Documentation

- [Current implementation notes](docs/PROJECT_STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Core API overview](docs/API.md)
- [Skills guide](docs/SKILLS_GUIDE.md)
- [Slash commands](docs/SLASH_COMMANDS.md)
- [Operations](docs/OPERATIONS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Product requirements](docs/PRD.md)
- [Technical requirements](docs/TRD.md)
- [Tutorial and example index](docs/TUTORIALS.md)
- [Contributing](docs/CONTRIBUTING.md)

Screenshots in `docs/assets/screenshots/` are interface snapshots. They do not verify the corresponding workflow or current runtime state.

## License

KIN is distributed under the [MIT License](LICENSE).
