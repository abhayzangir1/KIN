# Tutorial 4: Compound Workflows, Architectural Decisions, and Quota Guard

This tutorial covers advanced operational techniques in KIN: chaining compound slash commands, capturing Architecture Decision Records (ADRs) with automatic memory propagation, handling rate-limit quotas with automatic local failover, and resuming workflows after unexpected crashes.

---

## 1. Mastering Compound Slash Commands

KIN's compound command engine enables you to assemble an entire multi-agent software engineering pipeline into a single instruction.

### The Full Autonomous Pipeline
```text
/plan /boost /teamwork-preview /goal Full Stack Multi-Tenant Isolation | Add tenant_id column and tenant context middleware across all API routes | All routes enforce tenant isolation, complete test coverage, migration scripts verified
```

### What KIN Does:
1. **Workforce Matrix (`/teamwork-preview`)**: Scans all active coworkers (`@Boss`, `@Coder`, `@DBA`, `@Reviewer`), verifies model credentials, and checks Ollama health.
2. **Goal & Milestone (`/goal`)**: Inserts an authoritative milestone in SQLite, ensuring no duplicates.
3. **Execution Plan (`/plan`)**: Creates sequential tasks in SQLite with explicit dependency ordering:
   - Task 1: Migration script authoring (`@DBA`)
   - Task 2: Middleware injection (`@Coder`)
   - Task 3: Test suite execution (`@Reviewer`)
4. **Boost Verification (`/boost`)**: Flags all tasks with high-rigor constraints: zero placeholders permitted, automated verification must be proven before task closure.
5. **Channel Elevation**: If you typed this in a Direct Message (`dm-*`), KIN automatically elevates the shared project milestone to `#general` with an announcement card.

---

## 2. Capturing Architectural Decision Records (ADRs)

In long-running projects, architectural context is easily lost as chat histories grow. KIN provides a native ADR subsystem that captures decisions into durable SQLite storage and automatically injects them into the Context Compiler's Project Architecture block across all agents.

### Creating an ADR
Use `/decisions propose` (or `/adr propose`) with `<Title> | <Rationale> | <Alternatives>`:
```text
/adr propose Adopt SQLite WAL Mode for High Concurrency | Multiple agents reading channels simultaneously need concurrent non-blocking reads and writes via WAL + busy timeout | Rollback journal or external database server
```

### Anatomy of an ADR:
- **Title**: Short summary of the decision.
- **Rationale**: The problem statement, bottlenecks, and chosen technical approach.
- **Alternatives**: Rejected options and trade-offs.

### Querying ADRs
To list all active architectural decisions in the current project:
```text
/decisions
```
Agents will automatically reference these decisions during subsequent code reviews and planning phases.

---

## 3. Handling Rate Limits with Quota Guard Failover

When working with cloud inference providers (OpenAI, Anthropic, OpenRouter), you may encounter HTTP 429 (Rate Limit Exceeded) or credit exhaustion.

### How KIN Quota Guard Protects Your Work:
1. **Autonomous Pause**: When a 429 or quota error occurs, KIN does NOT crash the active run. It transitions the run state to `quota_paused` and checkpoints the exact step and partial thoughts.
2. **Real-time Alert Banner**: A high-visibility Quota Guard banner appears in the UI with the affected provider name, rate-limit reset estimation, and action buttons:
   - **⚡ Switch & Resume**: Opens model selection to pick an alternate model and resume.
   - **🦙 Switch to Ollama**: 1-click fallback to your local Ollama daemon.
   - **Resume Now**: Retries from the checkpoint once quota resets.
3. **Checkpoint Recovery**: Once switched or resumed, the agent loop picks up from the saved checkpoint without losing channel context.

---

## 4. Crash Recovery & State Rehydration

If your machine restarts or the KIN daemon process is terminated mid-flight:
1. **Automatic Detection**: On the next daemon boot, `AgentKernel` inspects the SQLite database for runs left in active states (`running`, `resuming`, `waiting_for_tool`, `waiting_for_agent`, `waiting_for_model`, `waiting_for_approval`, `paused_approval`) with expired heartbeat leases.
2. **Crash Banner**: The UI displays the recovery dock: `Interrupted Run Recovery`.
3. **Checkpointed Resume**: KIN reads the latest durable checkpoint from `checkpoints` and restores conversation state and pending actions.
4. The operator can click **Resume**, **Resume All**, **Switch & Resume**, or **Discard All**.
