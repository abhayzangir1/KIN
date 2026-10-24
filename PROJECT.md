# Project: KIN Autonomous Multi-Agent AI Harness & Local Workspace Orchestrator

## Architecture
KIN is a local-first, multi-agent AI engineering harness and workspace orchestrator organized into 18 architectural layers across `@kin/core` and `@kin/ui`:
- **L0 (Storage & Persistence)**: Embedded SQLite WAL connection (`core/src/storage/db.ts`), migration runner, safe JSON fallback helpers, schema DDL.
- **L1 (Domain Repositories)**: Workspace, Agent, Task, Goal, and Memory repositories (`core/src/domain/`).
- **L2 (Governance & Policy)**: Policy engine, autonomy modes, capability attenuation, financial safety gates (`core/src/policy/`).
- **L3 (Security & Perimeter)**: Sentinel fail-closed barrier, single-use approval tokens, AES-256-GCM vault, secret broker redaction, HMAC event ledger (`core/src/security/`).
- **L4 (Execution & Tool Gateway)**: Built-in tools, parameters validation, filesystem jail confinement, process execution (`core/src/execution/tool_gateway.ts`).
- **L5 (Worktree & Git Isolation)**: Isolated worktree manager, branch lifecycle, diff calculation, merge mutex (`core/src/execution/worktree_manager.ts`).
- **L6 (Model Gateway & Routing)**: Multi-provider LLM gateway, token quota budgeting, key rotation (`core/src/execution/model_gateway.ts`).
- **L7 (Context Compilation)**: Context compiler, output spiller, compaction engine (`core/src/context/`).
- **L8 (MCP Integration)**: Model Context Protocol client, stdio/SSE transports, environment sanitization (`core/src/execution/mcp_client.ts`).
- **L9 (Skills Engine & Sandbox)**: Procedural skills registry, isolated VM sandbox execution, lesson harvesting (`core/src/skills/skill_engine.ts`).
- **L10 (Kernel & Autonomous Loop)**: ReAct agent loop, lease renewal watchdogs, state transitions, wakeup queue (`core/src/kernel/`).
- **L11 (Orchestration & DAG Scheduling)**: Task dependency DAG, cycle detection, task promotion, workforce coordination (`core/src/domain/task_repository.ts`, `core/src/kernel/`).
- **L12 (Automation & Cron)**: 5-field cron parsing, one-shot timer schedules, routine execution (`core/src/automation/scheduler.ts`).
- **L13 (Communication & Channels)**: Multi-agent channels, direct messages, loop breaker, activation engine (`core/src/communication/`).
- **L14 (Recovery & Self-Healing)**: Observation verification, pre/post-action state checks, crash/timeout self-healing (`core/src/recovery/`).
- **L15 (Desktop Automation)**: Desktop window controller, OS input automation, lock management (`core/src/computer/`).
- **L16 (Browser Automation)**: Persistent browser context, Playwright/Puppeteer driver, DOM inspection (`core/src/browser/`).
- **L17 (Networking & IPC Server)**: Core HTTP/SSE server, loopback IPC token authentication, CORS origin filtering, jail checks (`core/src/server/core_server.ts`).
- **L18 (Frontend UI/UX)**: React 18 SPA (`ui/src/`), Zustand reactive store (`kinStore.ts`), Tailwind CSS, Tauri Rust desktop shell (`src-tauri/`).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Adversarial Concurrency Test Suite | Comprehensive stress tests in `core/test/adversarial_r1_concurrency_stress.test.ts` targeting lease contention, rapid message bursts, concurrent approval resolution, and parallel EventLedger hashing | M1 | Survey (Explorer 1 & 3) |
| 2 | TEST_INFRA.md & TEST_READY.md Publication | Requirement-driven test infrastructure catalog and formal test readiness handoff | M1 | Survey (Explorer 3) |
| 3 | Skill Engine Sandbox VM Isolation Hardening | Replace host `Timeout` object leak in `safeSetTimeout` with numeric IDs and fail closed on prototype freezing failures (`core/src/skills/skill_engine.ts`) | M2 | Survey (Explorer 2 F3.1, F2.1) |
| 4 | Artifact & Project Boundary Canonical Symlink Jail | Check `blockedSensitivePatterns` and `validateProjectBoundary` against `fs.realpathSync` canonical paths to block symlink escapes (`core/src/server/core_server.ts`) | M2 | Survey (Explorer 2 F3.2, F3.3) |
| 5 | Terminal Execution Environment Sanitization | Pass sanitized environment (`McpClientManager.sanitizeMcpEnv()`) in server terminal execution to prevent secret leakage (`core/src/server/core_server.ts`) | M2 | Survey (Explorer 2 F3.4) |
| 6 | Constant-Time Task Sign-off Token Comparison | Use `crypto.timingSafeEqual` in manual task sign-off token check (`core/src/server/core_server.ts`) | M2 | Survey (Explorer 2 F3.5) |
| 7 | Strict Loopback CORS Origin Filtering | Ensure origin prefix matching requires colon/port boundary to prevent `localhost.attacker.com` bypass (`core/src/server/core_server.ts`) | M2 | Survey (Explorer 2 F3.6) |
| 8 | Model Gateway Error Message Redaction | Redact upstream LLM provider error strings via `SecretBroker` before throwing (`core/src/execution/model_gateway.ts`) | M2 | Survey (Explorer 2 F3.7) |
| 9 | Git Revert & Stage Protected Directory Confinement | Guard against reverting or staging `.git`, `.kin`, or `.env` in `core/src/server/core_server.ts` | M2 | Survey (Explorer 2 F3.8) |
| 10 | Atomic Compare-and-Swap Approval Resolution | Conditional `UPDATE approvals SET status = ? WHERE id = ? AND status = 'pending'` with changes check to prevent double execution (`core/src/server/core_server.ts`) | M3 | Survey (Explorer 1 & 2 F3.10) |
| 11 | Transactional EventLedger Cryptographic Append | Wrap hash calculation and event insertion inside `this.db.transactionSync()` to eliminate chain forking under parallel load (`core/src/security/event_ledger.ts`) | M3 | Survey (Explorer 1 & 2 F3.11) |
| 12 | DM Auto-Provisioning Concurrency Resilience | Use `INSERT OR IGNORE` in `createChannel` to prevent SQLite UNIQUE constraint collision under concurrent DM creation (`core/src/domain/workspace_repository.ts`) | M3 | Survey (Explorer 3) |
| 13 | Task Lease Expiry Reclamation TOCTOU Fix | Include `AND (lease_expires_at IS NULL OR lease_expires_at < ?)` in `reclaimExpiredTaskLeases` batch update (`core/src/domain/task_repository.ts`) | M3 | Survey (Explorer 1) |
| 14 | Deterministic Message Chronological Ordering | Include secondary tie-breaker (`ORDER BY created_at DESC, id DESC`) in `getMessages` to eliminate non-deterministic ordering under same-millisecond bursts (`core/src/communication/channel_service.ts`) | M3 | Survey (Explorer 1) |
| 15 | ReAct Loop Lease Renewal Loss Enforcement | Abort turn immediately if `options.onRenewLease` returns `false` at turn start (`core/src/kernel/agent_loop.ts`) | M3 | Survey (Explorer 2 F2.2) |
| 16 | Task Dependency Existence Validation | Validate that all `dependsOnTaskIds` exist before creating dependency edges to prevent task backlog deadlocks (`core/src/domain/task_repository.ts`) | M3 | Survey (Explorer 2 F3.9) |
| 17 | Consolidate Shadowed Schedules Routes | Remove redundant Route 29 in `core_server.ts` and consolidate uniform response schema in Route 59 | M3 | Survey (Explorer 2 F2.3) |
| 18 | Goal Status Enum Contract Alignment | Align `GoalItem.status` in `ui/src/store/kinStore.ts` with SQLite `CHECK` constraint (`draft`, `active`, `completed`, `failed`, `cancelled`), and validate enums in `core_server.ts` | M4 | Survey (Explorer 2 F2.4) |
| 19 | Wire DAG Dependency Selection in UI | Expose and pass `dependsOnTaskIds` in `kinStore.ts` `createTask` and `CreateTaskModal.tsx` | M4 | Survey (Explorer 2 F2.5) |
| 20 | Strip Dead Auth Guard in Fetch Interceptor | Remove obsolete `!url.includes('/api/auth/token')` check in `kinStore.ts` and clean unused `createSandboxContext` in `skill_engine.ts` | M4 | Survey (Explorer 2 F2.6) |
| 21 | Documentation Alignment Across 18 Layers | Update `README.md` and `docs/` (`ARCHITECTURE.md`, `PRD.md`, `TRD.md`, `API.md`) reflecting all 18 layers, security posture, and latest operational commands | M5 | Survey (Explorer 2 & 3) |
| 22 | Monorepo Test & Build Verification | Verify 100% test pass rate (600+ tests) and 0 errors on `npm run build` | M6 | Survey (Explorer 3) |
| 23 | Forensic Integrity Verification & Release Commit | Binary audit verification by `teamwork_preview_auditor` followed by clean release git commit | M6 | Survey |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Adversarial Concurrency Test Track (R1) | Author `core/test/adversarial_r1_concurrency_stress.test.ts`, create `TEST_INFRA.md`, publish `TEST_READY.md` | None | DONE (test_writer_m1: 12 tests, 5.5s) |
| 2 | Security, Sandbox & Boundary Hardening (R3) | Skill VM sandbox timer isolation, symlink canonicalization in artifact & boundary checks, env sanitization, timing-safe signoff, CORS boundary, LLM error redaction, protected git paths | None | DONE (worker_m2: 52/52 security tests pass) |
| 3 | Core Concurrency & Facade Remediation (R1, R2, R4) | Atomic CAS approval resolution, transactional EventLedger append, DM INSERT OR IGNORE, lease reclamation TOCTOU fix, deterministic message order, ReAct lease check, dependency validation, schedules route consolidation | M1, M2 | DONE (worker_m3: 634 tests, 43 suites pass) |
| 4 | Frontend UI/UX State & Contract Alignment (R2, R4) | Goal status enum alignment, DAG dependency parameter wiring in store & modal, dead auth guard removal | M3 | DONE (worker_m4: UI build clean code 0) |
| 5 | Documentation & Architecture Alignment (R5) | Full documentation sync across `README.md` and `docs/` for all 18 harness layers, security posture, and operational guidelines | M2, M3, M4 | IN_PROGRESS |
| 6 | Full Verification, Forensic Audit & Release Git Commit (R6) | 100% pass on `npm test` (600+ tests), clean `npm run build` (0 errors), forensic integrity audit (CLEAN), and atomic release git commit | M1, M2, M3, M4, M5 | PLANNED |

---

## Interface Contracts

### Skill Engine VM Sandbox Timer Interface
- `safeSetTimeout(fn: Function, ms: number, ...args: any[]): number`
  - Returns: Pure primitive number ID (never host `Timeout` object).
  - Internal mapping: `activeTimers: Map<number, NodeJS.Timeout>`.
- `safeClearTimeout(id: number): void`
  - Clears host timeout by lookup from `activeTimers` and deletes ID.

### EventLedger Cryptographic Append Interface
- `EventLedger.record(params: LedgerEventParams): number`
  - Enclosed within `this.db.transactionSync(() => { ... })`.
  - Guarantees sequential reads of `prevHash` and atomic insertion of `recordHash`, preserving linear chain integrity under multi-worker/process concurrency.

### Approval Resolution Atomic CAS Interface
- `POST /api/approvals/:approvalId/resolve`
  - Update predicate: `UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`.
  - Condition: If `result.changes === 0`, return HTTP 409 Conflict. Exactly one winner executes tool and resizes agent run.

### Task Dependency Validation Interface
- `TaskRepository.createTask(task: TaskItem, dependsOnTaskIds?: string[]): TaskItem`
  - Checks `wouldCreateCycle(task.id, depId)`.
  - Verifies `this.getTask(depId)` exists. Throws if any dependency does not exist.

### Goal Status Enum Alignment
- `GoalStatus` values: `'draft' | 'active' | 'completed' | 'failed' | 'cancelled'`.
- Enforced identically in `schema.sql`, `core/src/domain/types.ts`, `core/src/server/core_server.ts`, and `ui/src/store/kinStore.ts`.

---

## Code Layout
- `core/src/storage/db.ts`: SQLite database connection, WAL configuration, transactionSync.
- `core/src/skills/skill_engine.ts`: VM sandboxing, prototype freezing, safe timer isolation.
- `core/src/security/event_ledger.ts`: Cryptographic HMAC/SHA-256 event journal and integrity verification.
- `core/src/security/sentinel.ts`: Single-use token management, security barrier.
- `core/src/domain/task_repository.ts`: Lease claiming, renewal, reclamation, dependency validation.
- `core/src/domain/workspace_repository.ts`: Channel creation, project isolation.
- `core/src/communication/channel_service.ts`: Message persistence and deterministic ordering.
- `core/src/kernel/agent_loop.ts`: ReAct autonomous loop and active lease renewal check.
- `core/src/execution/model_gateway.ts`: LLM provider routing and error message secret redaction.
- `core/src/server/core_server.ts`: REST endpoints, approval resolution CAS, symlink jail checks, terminal env sanitization, CORS.
- `ui/src/store/kinStore.ts`: Frontend Zustand state store, goal status enums, task creation DAG params.
- `ui/src/components/CreateTaskModal.tsx`: Task creation modal with dependency selection.
- `core/test/adversarial_r1_concurrency_stress.test.ts`: Adversarial stress and concurrency test suite.
- `docs/`: Technical references, PRD, TRD, ARCHITECTURE alignment.
- `README.md`: Root project overview and operational guide.
