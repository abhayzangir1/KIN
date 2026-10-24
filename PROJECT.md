# Project: KIN Autonomous Multi-Agent AI Harness & Local Workspace Orchestrator

## Architecture
KIN is a local-first, multi-agent AI engineering harness and workspace orchestrator organized into 7 architectural layers:
- **Layer 0 (Storage)**: Embedded SQLite database with schema migrations (`core/src/storage`), domain repositories (`WorkspaceRepository`, `TaskRepository`, `GoalRepository`, `AgentRepository`, `MemoryRepository`).
- **Layer 1 (Governance)**: Kernel policy engine, action sandboxing, approval tokens, cryptographic HMAC signoffs (`core/src/kernel`).
- **Layer 2 (Execution)**: Process supervision, tool gateways, isolated git worktrees, MCP connectors, browser & desktop automation (`core/src/tools`, `core/src/connectors`).
- **Layer 3 (Intelligence)**: Context compilation & compaction, model gateways, multi-provider routing, YAML prompt parsing, self-improvement pipelines (`core/src/model`, `core/src/context`).
- **Layer 4 (Orchestration)**: Dynamic workforce coordination, DAG task progression, scheduler & cron lifecycles, run queues, steer convergence (`core/src/scheduler`, `core/src/orchestration`).
- **Layer 5 (Networking)**: Core HTTP/SSE server, loopback IPC token authentication, EventBus, channel communications (`core/src/server`, `core/src/communication`).
- **Layer 6 (Frontend UI/UX)**: React + Tailwind desktop and browser SPA (`ui/src`), Zustand state stores (`kinStore.ts`), Tauri Rust desktop shell (`src-tauri`).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Defensive JSON Parsing Helpers | Zero-dependency safe JSON deserialization utilities (`safeJsonParseObject`, `safeJsonParseArray`, `safeJsonParse`) in `core/src/storage/db.ts` | M1 | Survey (Explorer 1) |
| 2 | WorkspaceRepository Fail-Open | Safe fallback parsing for `projects.settings_json` in `getProject` and `listProjects` | M1 | Survey (Explorer 1) |
| 3 | TaskRepository Fail-Open | Safe fallback parsing for `tasks.verification_spec_json` and `decisions.alternatives_considered_json` across single-row and list methods | M1 | Survey (Explorer 1) |
| 4 | GoalRepository Fail-Open | Safe fallback parsing for `goals.acceptance_criteria_json` and `goals.proposed_replanning_json` across single-row and list methods | M1 | Survey (Explorer 1) |
| 5 | ChannelService Fail-Open | Safe fallback parsing for `messages.mentions_json` across `getMessages` and `getMessage` to protect chat history | M1 | Survey (Explorer 1) |
| 6 | AgentRepository Resilient Typing | Strict array validation for `domainAuthority` and `capabilities` to prevent runtime `TypeError` on non-array JSON | M1 | Survey (Explorer 1) |
| 7 | Storage Resilience Unit Tests | Dedicated unit tests in `core/test/` asserting corrupt JSON rows fail open gracefully without crashing queries | M1 | Survey (Explorer 1) |
| 8 | Remove Deprecated `/api/auth/token` | Strip obsolete `/api/auth/token` polling from `getIpcToken()` in `ui/src/store/kinStore.ts` | M2 | Survey (Explorer 2) |
| 9 | Simplify Fetch Interceptor Auth Guard | Remove `!url.includes('/api/auth/token')` guard in `kinStore.ts` global fetch interceptor | M2 | Survey (Explorer 2) |
| 10 | Vite Proxy & Tauri IPC Parity | Verify dual-channel token discovery: server-side token injection in `vite.config.ts` and Rust IPC `get_ipc_token` in Tauri | M2 | Survey (Explorer 2) |
| 11 | Full Test Suite Verification (567+ Tests) | Execute all 38 test suites in `core/test/` sequentially, asserting 100% pass rate (567+ tests passing) | M3 | Survey (Explorer 3) |
| 12 | Core Clean Build Verification | Compile `@kin/core` with `tsc` and copy `schema.sql` to `dist/storage/schema.sql` with exit code 0 | M4 | Survey (Explorer 3) |
| 13 | UI Clean Build Verification | Typecheck and build `@kin/ui` with `tsc && vite build` with 0 TypeScript/Vite errors | M4 | Survey (Explorer 3) |
| 14 | Monorepo Root Build Verification | Verify root `npm run build` cleanly builds both workspaces with exit code 0 | M4 | Survey (Explorer 3) |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Layer 0 Defensive Fallback JSON Parsing | Implement safe JSON helpers in `core/src/storage/db.ts`, update `WorkspaceRepository`, `TaskRepository`, `GoalRepository`, `ChannelService`, `AgentRepository`, and add resilience unit test | None | IN_PROGRESS (worker_m1: e5d03078) |
| 2 | Layer 5 & 6 Auth Cleanup in kinStore.ts | Remove deprecated `/api/auth/token` calls and simplify fetch interceptor in `ui/src/store/kinStore.ts`, ensure `vite.config.ts` token parity | None | PLANNED |
| 3 | Full Test Suite Verification (567+ Tests) | Run all 38 test suites across `core/test/`, verify 100% pass rate (567+ tests passing) with 0 regressions | M1, M2 | PLANNED |
| 4 | Clean Build Verification (@kin/core and @kin/ui) | Run build scripts for `@kin/core`, `@kin/ui`, and monorepo root, verifying 0 TS/Vite errors | M1, M2 | PLANNED |

---

## Interface Contracts

### `core/src/storage/db.ts` ↔ Domain Repositories
- `safeJsonParseObject<T extends Record<string, unknown> = Record<string, unknown>>(raw: unknown, fallback?: T): T`
  - Input: raw column value (`unknown`)
  - Output: parsed object or `fallback` (default `{}`)
  - Guarantee: Never throws `SyntaxError`. Guarantees return value is non-null, non-array object.
- `safeJsonParseArray<T = unknown>(raw: unknown, fallback?: T[]): T[]`
  - Input: raw column value (`unknown`)
  - Output: parsed array or `fallback` (default `[]`)
  - Guarantee: Never throws `SyntaxError`. Guarantees return value satisfies `Array.isArray()`.
- `safeJsonParse<T>(raw: unknown, fallback: T): T`
  - Input: raw column value (`unknown`), fallback value (`T`)
  - Output: parsed value of matching category or fallback

### `ui/src/store/kinStore.ts` ↔ Server & Shell
- `getIpcToken(): Promise<string | null>`
  - Tauri Environment: Invokes Tauri IPC command `invoke('get_ipc_token')` -> returns string token or null.
  - Web Dev Environment: Returns token if provided via URL param `?token=...` or `sessionStorage`; otherwise returns `null` because Vite proxy transparently injects `Authorization: Bearer <token>`.
  - Removed: No network request to `/api/auth/token`.
- Fetch Interceptor:
  - When `isLocalApi && !headers.has('Authorization')`, awaits `getIpcToken()`; if token exists, sets `Authorization: Bearer ${token}` and `x-kin-auth: ${token}`.

---

## Code Layout
- `core/src/storage/db.ts`: SQLite database connection, transaction wrapper, and defensive JSON helpers.
- `core/src/domain/workspace_repository.ts`: Workspace & Project CRUD.
- `core/src/domain/task_repository.ts`: Task & Decision CRUD.
- `core/src/domain/goal_repository.ts`: Goal CRUD.
- `core/src/domain/agent_repository.ts`: Agent Definition & Identity CRUD.
- `core/src/communication/channel_service.ts`: Channels & Message persistence.
- `core/test/`: 38 test suites covering Layers 0 through 5.
- `ui/src/store/kinStore.ts`: Frontend Zustand store, IPC token discovery, global fetch interceptor.
- `ui/vite.config.ts`: Vite dev proxy with server-side token injection from `.kin/ipc_auth.token`.
- `src-tauri/src/ipc.rs`: Native Tauri command `get_ipc_token`.
