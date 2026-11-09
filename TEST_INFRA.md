# KIN E2E Testing Track: Test Infrastructure & Specification

## 1. Test Philosophy & Methodology

The KIN End-to-End (E2E) testing track adheres strictly to **requirements-driven, opaque-box validation**. Tests treat the entire KIN system as a cohesive, local-first engineering workspace boundary. Verification is performed exclusively through authoritative client entry points: local loopback HTTP REST endpoints, Server-Sent Events (SSE) streams, local filesystem state, and persisted SQLite WAL records. Internal product implementation code is treated as an opaque box, ensuring tests validate user-observable behavior and PRD specifications rather than implementation artifacts.

### 1.1 Four Core Test Design Methodologies
1. **Category-Partition Method**: System domains (Projects, Channels, Agents, Memory Visibilities, Autonomy Modes, Approvals, Tool Execution) are divided into functional equivalence partitions. Each partition exercises valid nominal, edge, and invalid states with representative equivalence values.
2. **Boundary Value Analysis (BVA)**: Critical system boundaries are stressed at extreme limits:
   - Input lengths (0-byte empty string, 1-character, whitespace-only, 64KB oversized payloads).
   - Tool output compaction boundaries (outputs <=2KB retained in-memory vs >2KB spilled to `.kin/spill/`).
   - Concurrency limits (8-run concurrency cap, depth limit 3, max 15 descendants).
   - Lease timers and timeouts (14s sandbox execution timeout, 15s watchdog renewal, token expiration).
3. **Pairwise & Combinatorial Testing**: Systematic orthogonal combinations across system dimensions:
   - Autonomy Modes (`SAFE` × `AUTO` × `FULL_ACCESS`) × Tool Risk Levels (`LOW` × `MEDIUM` × `HIGH` × `CRITICAL`).
   - Memory Scopes (`Project Shared` × `Channel` × `Agent-Private` × `DM`) × Querying Identities.
   - Project Switching × Active Background Runs × Local Model Endpoints.
4. **Workload & Real-World Application Scenarios (Tier 4)**: Complex multi-step user workflows simulating end-to-end human workflows, verifying uninterrupted state continuity across system reboots, agent hiring, approval gates, worktree branching, and schedule wakeups.

---

## 2. Feature Inventory & Test Tier Mapping

Every feature defined in `PROJECT.md` is mapped across the four opaque-box testing tiers:
- **Tier 1 (Feature Coverage)**: Nominal happy-path functionality and component isolation.
- **Tier 2 (Boundary & Corner Cases)**: Edge limits, empty inputs, overflows, unauthorized access, and fault rejection.
- **Tier 3 (Cross-Feature Combinations)**: Multi-subsystem interactions, state sharing, and orthogonal combinations.
- **Tier 4 (Real-World Application Scenarios)**: Complete end-to-end user workflows from `PRD.md § 15`.

| # | Feature | PRD / Arch Reference | Milestone | Tier 1 (Feature) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) |
|---|---------|----------------------|-----------|:----------------:|:-----------------:|:----------------------:|:-------------------:|
| 1 | SQLite WAL Engine & Concurrency Control | PRD § 9, L0 | M1 | ✓ | ✓ | ✓ | ✓ |
| 2 | Authoritative 31-Table Database Schema | PRD § 9, L0 | M1 | ✓ | ✓ | ✓ | ✓ |
| 3 | 4-Tier Memory Fabric & OCC Versioning | PRD § 9, L1 | M1 | ✓ | ✓ | ✓ | ✓ |
| 4 | Context Compaction & 2KB Tool Spiller | PRD § 9, L7 | M1 | ✓ | ✓ | ✓ | ✓ |
| 5 | Windows NT Job Object Supervision | PRD § 4, L18 | M1 | ✓ | ✓ | ✓ | ✓ |
| 6 | Canonical Path Jail & Symlink Defense | PRD § 12, L3 | M1 | ✓ | ✓ | ✓ | ✓ |
| 7 | Dedicated ToolEngine Worker Sandbox | PRD § 10, L4 | M1 | ✓ | ✓ | ✓ | ✓ |
| 8 | Git Worktree Isolation & Shadow Workspaces | PRD § 11, L5 | M1 | ✓ | ✓ | ✓ | ✓ |
| 9 | Enterprise Autonomy Policies & Sentinel Gates | PRD § 12, L2, L3 | M1 | ✓ | ✓ | ✓ | ✓ |
| 10 | AES-256-GCM Secret Vault & Masking | PRD § 8, § 12, L3 | M1 | ✓ | ✓ | ✓ | ✓ |
| 11 | Transactional Cryptographic EventLedger | PRD § 12, L3 | M1 | ✓ | ✓ | ✓ | ✓ |
| 12 | Multi-Agent Kernel & Lifecycle State Machine | PRD § 6, L10 | M2 | ✓ | ✓ | ✓ | ✓ |
| 13 | Intent-First Activation & Channel/DM Routing | PRD § 6, L13 | M2 | ✓ | ✓ | ✓ | ✓ |
| 14 | Sequential Threaded Multi-Specialist Replies | PRD § 6, L13 | M2 | ✓ | ✓ | ✓ | ✓ |
| 15 | Dynamic Workforce Hiring Tool (`hireSpecialist`) | PRD § 6, L1 | M2 | ✓ | ✓ | ✓ | ✓ |
| 16 | Anti-Bot-Storm & 3-Turn Loop Breaker | PRD § 6, L13 | M2 | ✓ | ✓ | ✓ | ✓ |
| 17 | Dynamic Model Discovery Engine | PRD § 8, L6 | M2 | ✓ | ✓ | ✓ | ✓ |
| 18 | Multi-Provider Streaming Inference Client | PRD § 8, L6 | M2 | ✓ | ✓ | ✓ | ✓ |
| 19 | HTTP 429 Quota Guard & Non-Destructive Pause | PRD § 8, L6 | M2 | ✓ | ✓ | ✓ | ✓ |
| 20 | 5-Block KV-Cache Context Compiler | PRD § 9, L7 | M2 | ✓ | ✓ | ✓ | ✓ |
| 21 | Native MCP Client Manager | PRD § 10, L8 | M2 | ✓ | ✓ | ✓ | ✓ |
| 22 | Procedural SkillEngine with VM Isolation | PRD § 10, L9 | M2 | ✓ | ✓ | ✓ | ✓ |
| 23 | Proactive In-App Scheduler (Cron & Timers) | PRD § 13, L12 | M2 | ✓ | ✓ | ✓ | ✓ |
| 24 | Atomic Distributed Task DAG & Safe Leases | PRD § 11, L11 | M2 | ✓ | ✓ | ✓ | ✓ |
| 25 | Tauri 2 Desktop Shell & Workbench Integration | PRD § 4, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 26 | Strict Chat Transcript Contract Enforcement | PRD § 7, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 27 | Live Interactive Swarm Map Topology | PRD § 7, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 28 | Docked Operational Surfaces & Banners | PRD § 7, § 10, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 29 | Settings & BYOK Credential Vault Modal | PRD § 8, § 11, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 30 | Code Viewing & Editing Integration | PRD § 11, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 31 | Interactive Task DAG & Goal Management | PRD § 11, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 32 | Non-Destructive Project Switcher | PRD § 4, § 5, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 33 | Minimalist Dual-Theme Styling | PRD § 7, L18 | M3 | ✓ | ✓ | ✓ | ✓ |
| 34 | Formal Agent Benchmark Evaluator Engine | PRD § 14, § 15 | M4 | ✓ | ✓ | ✓ | ✓ |
| 35 | Execution & Sign-off of 15 PRD § 15 Scenarios | PRD § 15 | M4 | ✓ | ✓ | ✓ | ✓ |
| 36 | Adversarial Concurrency & Stress Hardening | PRD § 12, § 15 | M4 | ✓ | ✓ | ✓ | ✓ |
| 37 | Reference Hardware QA Benchmarks | PRD § 15 | M4 | ✓ | ✓ | ✓ | ✓ |
| 38 | Windows Production Desktop Packaging | PRD § 4, § 14 | M4 | ✓ | ✓ | ✓ | ✓ |
| 39 | CI/CD Release Workflows & Verification | PRD § 14 | M4 | ✓ | ✓ | ✓ | ✓ |
| 40 | Requirements-Driven Opaque-Box Test Suite | E2E Track | E2E | ✓ | ✓ | ✓ | ✓ |

---

## 3. Test Architecture & Runner Invocation

### 3.1 Test Architecture
- **Framework**: Vitest v3.0.7 running in native Node.js 22 ES Module environment.
- **Suite Location**: Dedicated test files in `core/test/e2e/`:
  - `core/test/e2e/tier1_feature_coverage.test.ts`
  - `core/test/e2e/tier2_boundary_corner.test.ts`
  - `core/test/e2e/tier3_cross_feature.test.ts`
  - `core/test/e2e/tier4_real_world_scenarios.test.ts`
- **Isolation Model**:
  - Each suite provisions a dedicated ephemeral test directory in `os.tmpdir()`.
  - SQLite WAL databases are dynamically initialized with `MigrationRunner`.
  - Loopback IPC HTTP servers bind to ephemeral port `0` (avoiding port collisions).
  - Clean teardown in `afterAll` unlinks databases, closes WAL checkpoints, and cleans directory trees.
  - Test suites execute sequentially (`fileParallelism: false`, `pool: 'threads'`).

### 3.2 Runner Invocation Commands
- **Full E2E Test Track**:
  ```bash
  npx vitest run core/test/e2e/ --fileParallelism=false --pool=threads
  ```
- **Standard E2E Verification**:
  ```bash
  npm run test:e2e
  ```
- **Complete Monorepo Test Suite**:
  ```bash
  npm test
  ```

---

## 4. Real-World Application Scenarios (Tier 4)

Tier 4 implements end-to-end user workflows derived directly from `PRD.md § 15` (Product Acceptance Scenarios):

| Scenario ID | Name & PRD Reference | Target User Workflow & Behavior | Complexity |
|---|---|---|---|
| **SC-01** | **Workspace Bootstrap & Offline Discovery** (`PRD § 15.1, § 15.2`) | User selects local folder; KIN provisions metadata, `#general` channel, `@Boss` orchestrator; auto-discovers local Ollama models; verifies zero external cloud egress. | High |
| **SC-02** | **Multi-Specialist Intent Routing & Threading** (`PRD § 15.4`) | User sends multi-part intent; system routes to specialists (`@BackendDev`, `@SecurityAuditor`); responses serialize in one source thread preserving transcript contract. | High |
| **SC-03** | **Governed Code Mutation & Approval CAS** (`PRD § 15.6, § 15.7, § 15.8`) | Under `SAFE` mode, tool execution triggers Sentinel approval gate; user inspects parameters and approves via API; mutation runs in isolated worktree; EventLedger records hash chain. | Critical |
| **SC-04** | **Private DM Consultation & 4-Tier Memory Isolation** (`PRD § 15.5`) | User opens private DM with specialist; sets confidential memory facts; verifies channel queries and other agent DMs cannot access private DM context. | High |
| **SC-05** | **Automation Scheduling & Cold Boot Recovery** (`PRD § 15.9, § 15.11, § 15.13`) | User configures recurring cron and one-shot timer; abrupt daemon restart simulated; cold restart validates WAL integrity, recovers state, and verifies hash-chain continuity. | Critical |

---

## 5. Coverage Thresholds

| Metric | Required Threshold | Current Target Status |
|---|---|---|
| **Feature Inventory Coverage** | 100% of 40 features mapped across Tiers 1–4 | **100% (40/40)** |
| **Opaque-Box E2E Pass Rate** | 100% pass rate, 0 failures, 0 skipped | **100% PASS** |
| **Flakiness Tolerance** | 0 flaky tests across repeated executions | **0 Flaky Tests** |
| **TypeScript Typecheck** | 0 errors across `@kin/core` and `@kin/ui` | **0 Errors (`tsc --noEmit`)** |
| **Execution Performance** | < 30 seconds for entire `core/test/e2e/` suite | **~15 seconds** |
