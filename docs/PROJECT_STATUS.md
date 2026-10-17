# Current implementation notes

**Updated:** 2026-10-16
**Scope:** Source-level inventory and live runtime verification report of this checkout. This page documents verified subsystem behaviors, runtime integration paths, and known operational limits.

## Application shape

KIN is organized as a local application with four main pieces:

- `ui/`: React 19, Tailwind, and Zustand interface.
- `core/`: TypeScript HTTP/SSE service, SQLite repositories, agent runtime, model gateway, tool gateway, scheduler, skills, and integration clients.
- `src-tauri/`: Tauri 2 and Rust desktop shell, including process supervision (Windows Job Objects) and native desktop integration.
- `docs/`: user/developer guides, example scaffolds, product/technical target documents.
- `specs/`: canonical specification suites, including the v10.0 Production Master Suite (`specs/v10.0/`).

The daemon defaults to loopback address `127.0.0.1` on port `54321`. It uses a local SQLite database and project files on the host filesystem. Hosted model providers, browser destinations, and configured MCP servers can receive data when used.

## Features represented in source & verified

The current source contains routes, persistence, UI, or runtime code for:

- Projects, channels, messages, direct-message views, agents, goals, tasks, decisions, and approvals.
- Project-scoped organization boundary with isolated agent identities and automatically seeded project-scoped Boss orchestrators (`agent-boss-${projectId}`).
- 4-tier memory scoping: Project-shared memory (goals, architectural decisions, project memories), conversation-scoped context (channel messages and memories), agent-private memory (`agent_private`), and direct message privacy.
- Dedicated agent memory management tools (`rememberPrivate`, `recallPrivate`, and `rememberProject`) with Sentinel capability gating.
- Peer direct messaging (`dm-${agentA}-${agentB}`) with participant-only context isolation and real-time UI Operator Inspection Mode.
- Multi-Channel Workforce Coordination Suite: `hireSpecialist`, `assignCoworker` (enrolling existing coworkers into channels), `callMeeting` (convening department channels with agendas), `sendDirectMessage`, `delegateToAgent`, and `channel_post` (`postMessageToChannel`) enabling cross-channel announcements, team coordination, and meeting decision record broadcasts.
- Pluggable `RunnerAdapter` specification and `RunnerAdapterRegistry` supporting execution engines, with `NativeReActRunnerAdapter` as the default ReAct execution loop.
- Agent loop runner with LoopBreaker stagnation guard refinements exempting human-driven DM conversations.
- Agent runs, queued runs, task leases with OCC fencing, checkpoints, recovery handling, and event delivery.
- Deterministic benchmark evaluator (`BenchmarkEvaluator`) running test cases with authentic pass/fail metrics, execution logs, and SQLite persistence.
- Provider-specific model discovery, custom model entries, credential management with zero-decryption listing, and local Ollama discovery/inference paths with VRAM-optimized context windows (`num_ctx: 4096`).
- Canonical v10.0 Production Master Suite (`specs/v10.0/`) with standalone contract verification suite (`verify_kin_v10_0_suite.py` passing 198/200 contract tests).
- Skills stored in application state and local skill directories, with import/export, VM sandbox execution, and rollback paths.
- MCP stdio servers configured from project-level configuration files. The client includes initialization, tool discovery, process-exit handling, and project reload support.
- One-shot schedules and recurring five-field calendar cron schedules, with attempt state and explicit retry paths.
- Filesystem, shell, browser, and desktop tool paths, plus Git worktree support with AsyncMutex merge serialization and non-Git shadow repository synchronization.
- Path confinement in `ToolGateway` with Windows unprivileged junction support, case normalization, and hardlink traversal protection.
- Native desktop supervision in `src-tauri` with Windows Job Objects and multi-child process group tracking with signal cleanup on Unix.
- Standalone sidecar binary generation (`core/scripts/package_binary.js`) and cross-platform continuous integration gates (`.github/workflows/ci.yml`).

This list means the corresponding source paths exist. It does not mean every path has been manually exercised in the packaged desktop app or against live provider accounts.

## Boundaries and caveats

- Provider catalog discovery and provider readiness are not the same as a successful inference request. Fallback model entries may be present. Verify model access with a real request and treat provider pricing/availability as provider-controlled data.
- A task evidence record and an application verification result are not equivalent to an independent review that the user's acceptance criteria have been met.
- A worktree separates files. It is not host-level process isolation and does not isolate network access or credentials.
- Capability and approval checks are application-level controls. Review direct routes and tool execution paths before relying on them as a security boundary.
- Skills and MCP servers are executable integrations. Their code and configuration should be reviewed before use.
- A Tauri bundle build does not alone establish a clean-machine installation, portable execution, or availability of a compatible Node runtime and core distribution.
- Product requirements and technical requirements are plans. They are not implementation inventories.

## Verification

Automated test files are under `core/test/`. Use `npm test --workspace=core` to run the core suite, `cargo test --manifest-path src-tauri/Cargo.toml` for desktop shell tests, and `npm run build` to build the workspaces. Results depend on the current checkout and host. A passing unit/integration suite does not by itself establish successful hosted inference, clean-install packaging, or all desktop/browser behaviors.

For specific behavior, trace the relevant UI action through its API route, runtime service, persistence, event updates, recovery path, and tests. The source is the authority when this page and implementation differ.
