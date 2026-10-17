# Slash Command Reference Manual

KIN provides an enterprise-grade slash command framework that enables direct operator steering, workflow orchestration, workforce management, and runtime diagnostics directly within any channel or direct message thread.

All slash commands are parsed by the core engine (`core/src/server/core_server.ts`) and execute with strict validation, real-time Server-Sent Events (SSE) broadcasting, and SQLite durability.

---

## Command Quick Reference

| Command | Category | Description | Primary Syntax Example |
|---|---|---|---|
| [`/plan`](#1-plan) | Execution Planning | Generate milestone DAG and autonomous tasks | `/plan Implement OAuth2 authentication` |
| [`/boost`](#2-boost) | Autonomous Drive | Deep reasoning and rigorous verification | `/boost Verify edge cases and zero regressions` |
| [`/teamwork-preview`](#3-teamwork-preview--teamwork) | Workforce Topology | Inspect workforce matrix, capabilities, and readiness | `/teamwork-preview` |
| [`/goal`](#4-goal) | Milestone Tracking | Register tracked milestone with acceptance criteria | `/goal Ship v1.0 \| Review APIs \| Tests pass` |
| [`/schedule`](#5-schedule--timer) | Timers & Wakeups | One-shot scheduled wake-up timer | `/schedule 15m Check build logs` |
| [`/routine`](#6-routine) | Proactive Routines | Recurring cron or interval routine | `/routine 0 9 * * * Morning standup briefing` |
| [`/skills`](#7-skills--skill) | Skill Management | List, create, or import specialized skills | `/skills list` or `/skills create` |
| [`/decisions`](#8-decisions--decision--adr) | Architectural Decisions | Manage and query Architecture Decision Records | `/adr Use SQLite WAL mode for concurrency` |
| [`/grill-me`](#9-grill-me) | Socratic Interview | Interactive architecture inquiry and stress-testing | `/grill-me Database schema migration strategy` |
| [`/compact`](#10-compact) | Context Management | Compact channel history into Tier 2 Channel Memory | `/compact` |
| [`/browser`](#11-browser) | Web & Navigation | Inspect or navigate the dedicated browser session | `/browser https://docs.github.com` |
| [`/learn`](#12-learn) | Knowledge Retention | Store rules/patterns in Tier 1 Project-Shared Memory | `/learn Always verify tests before committing` |
| [`/hire`](#13-hire) | Workforce Hiring | Hire and configure a new specialist agent | `/hire @SecurityExpert` |
| [`/assign`](#14-assign) | Task Delegation | Enroll and route tasks to a named specialist | `/assign @SecurityExpert Review auth headers` |
| [`/btw`](#15-btw) | Side Channel | Ask side questions without cluttering task context | `/btw Where is the database migration located?` |
| [**Compound Pipeline**](#16-compound-multi-command-pipelines) | Orchestration | Chain multiple directives into an atomic execution DAG | `/plan /boost /teamwork-preview <objective>` |

---

## Detailed Specifications

### 1. `/plan`
Deconstructs a complex user objective into an authoritative multi-phase Directed Acyclic Graph (DAG) with explicit task dependencies, assigned specialists, and milestone deliverables.

**Syntax:**
```text
/plan <objective>
/plan <objective> | <description> | <criterion 1>, <criterion 2>
```

**Examples:**
- `/plan Refactor database connection pooling to handle 10,000 concurrent queries`
- `/plan Migrate to Vite 6 | Upgrade bundler and update config | All tests pass, build bundle size < 2MB`

**Runtime Effects:**
- Evaluates existing project goals and open tasks.
- Generates structured milestone tasks in SQLite (`taskRepo.createTask`).
- Emits SSE events: `task:created`, `message:created`.
- Triggers `@Boss` to begin sequential task coordination.

---

### 2. `/boost`
Activates maximum reasoning autonomy and verification-oriented execution. Instructs assigned agents to deeply analyze constraints, verify edge cases, confirm zero runtime errors, and produce verifiable evidence before closing milestones.

**Syntax:**
```text
/boost <verification directive>
```

**Examples:**
- `/boost Stress test SQLite write contention with 50 parallel workers`
- `/boost Audit all IPC endpoints for token authentication and payload schema validation`

**Runtime Effects:**
- Injects a high-priority Boost autonomy directive into the agent loop prompt.
- Enforces strict verification policies (no placeholders, test execution required).

---

### 3. `/teamwork-preview` / `/teamwork`
Generates a comprehensive real-time Workforce Collaboration Matrix displaying all active agents in the project, their assigned channels, runtime inference models (including Ollama status), and tool capabilities.

**Syntax:**
```text
/teamwork-preview
/teamwork
```

**Output Includes:**
- Total workforce count and agent role directory (`@Boss`, `@Researcher`, `@Coder`, `@Reviewer`, etc.).
- Active model tiering: model identifier, provider status, and fallback routes.
- Channel assignment mappings.
- SQLite journal status and Ollama availability (`models.length` or `offline`).

---

### 4. `/goal`
Creates or updates a tracked project milestone with structured acceptance criteria.

**Syntax:**
```text
/goal <title>
/goal <title> | <description>
/goal <title> | <description> | <acceptance criteria 1>, <acceptance criteria 2>
```

**Examples:**
- `/goal Production Launch Readiness`
- `/goal Implement Secure Secret Broker | Encrypt credentials in SQLite with AES-256-GCM | Zero plain-text keys on disk, automated audit passes`

**Runtime Effects:**
- Checks for existing goals with the same title to prevent duplicate clutter.
- Inserts or updates the goal in SQLite (`goalRepo.createGoal`).
- Creates an associated bootstrap milestone task (`taskRepo.createTask`).
- Emits SSE events: `goal:created` / `goal:updated`, `task:created`.

---

### 5. `/schedule` / `/timer`
Sets a one-shot wake-up timer that triggers an agent execution run after a specified duration.

**Syntax:**
```text
/schedule <duration> <prompt>
/timer <duration> <prompt>
```

**Duration Formats Supported:**
- Seconds: `30s`, `45 seconds`
- Minutes: `5m`, `15m`, `10 minutes`
- Hours: `1h`, `2 hours`
- Natural phrases: `in 10 minutes <prompt>`

**Examples:**
- `/schedule 15m Poll server deployment status and notify channel`
- `/timer 1h Run automated database backup verification`

**Runtime Effects:**
- Stores timer in SQLite (`scheduler.createOneShotTimer`).
- Calculates precise fire timestamp (`Date.now() + durationMs`).
- Dispatches automatic agent wakeup upon timer expiry.
- Emits SSE event: `schedule:created`.

---

### 6. `/routine`
Configures a recurring background automation routine using either a five-field cron expression or an interval.

**Syntax:**
```text
/routine <cron expression> <directive>
/routine <interval> <directive>
```

**Examples:**
- `/routine 0 9 * * * Compile daily workspace briefing covering active goals and commits`
- `/routine */30 * * * * Health check: verify API gateway responsiveness`
- `/routine 4h Sync documentation with recent code changes`

**Runtime Effects:**
- Validates the 5-field cron syntax via `cron_calendar.ts`.
- Registers durable recurring schedule in SQLite (`scheduler.createRecurringSchedule`).
- Emits SSE event: `schedule:created`.

---

### 7. `/skills` / `/skill`
Lists registered capabilities, creates custom skill definitions, or imports external skill bundles.

**Subcommands:**
- `/skills list` — Display all registered workspace and global skills.
- `/skills create <name> | <description> | <prompt>` — Author a new declarative skill.
- `/skills import <path_or_url>` — Import a skill package or directory into the project.

**Examples:**
- `/skills list`
- `/skills create data-auditor | Automated data hygiene scanner | Run SQL schema validation and check null ratios`

---

### 8. `/decisions` / `/decision` / `/adr`
Creates, lists, or queries Architectural Decision Records (ADRs) stored in Tier 1 Project-Shared Memory and SQLite.

**Syntax:**
```text
/decisions
/adr <title> | <context> | <decision> | <consequences>
```

**Examples:**
- `/decisions` — Lists all registered ADRs with status (`accepted`, `deprecated`, `superseded`).
- `/adr Use SQLite WAL Mode | Concurrent readers block writers under default journal | Enable WAL mode and 5000ms busy timeout | Unlocks zero-latency multi-agent concurrency`

**Runtime Effects:**
- Persists ADR in `decision_records` table and announces to `#general`.
- Injected automatically into the Context Compiler's Project Architecture block.

---

### 9. `/grill-me`
Launches an interactive, high-rigor architectural review. `@Boss` or specialist agents challenge requirements, probe potential failure modes, identify edge cases, and ensure comprehensive technical clarity before implementation begins.

**Syntax:**
```text
/grill-me <architecture topic or proposed feature>
```

**Example:**
- `/grill-me Distributed consensus mechanism for multi-agent state replication`

---

### 10. `/compact`
Manually triggers conversation turn compaction for the active channel.

**Syntax:**
```text
/compact
```

**Runtime Effects:**
- Compresses conversation turns into a structured summary.
- Archives older message turns while preserving key decisions, open tasks, and file modifications in Tier 2 Channel Memory.
- Frees prompt context tokens for sustained long-running operations.

---

### 11. `/browser`
Controls or queries the persistent headless/headed browser instance.

**Syntax:**
```text
/browser <url>
/browser inspect
```

**Examples:**
- `/browser https://github.com/trending`
- `/browser inspect` — Captures screenshot and extracts current DOM accessibility tree.

---

### 12. `/learn`
Persists an operational rule, guideline, or lesson learned directly into Tier 1 Project-Shared Memory across all current and future agents.

**Syntax:**
```text
/learn <rule or operational pattern>
```

**Example:**
- `/learn Always run 'npm test --workspace=core' before proposing PR merges`

---

### 13. `/hire` & 14. `/assign`
Dynamic workforce expansion and task routing commands.

**Syntax:**
```text
/hire @<specialist_name> [role/specialization description]
/assign @<specialist_name> <task description>
```

**Examples:**
- `/hire @DevOps Kubernetes and Docker deployment specialist`
- `/assign @DevOps Author production Helm charts and health check probes`

---

### 15. `/btw`
Sends a side-channel question or clarifying inquiry without derailing active task workflows or polluting the main execution DAG.

**Syntax:**
```text
/btw <question>
```

**Example:**
- `/btw Which migration introduced the secret_vault table?`

---

## 16. Compound Multi-Command Pipelines

KIN features a multi-command parser capable of evaluating compound directives in a single chat input.

**Supported Combinations:**
Any combination of two or more commands from: `/plan`, `/boost`, `/teamwork-preview`, `/goal`, `/schedule`, `/routine`.

**Syntax:**
```text
/plan /boost /teamwork-preview <Target Objective>
/plan /boost /goal <Title> | <Description> | <Criteria>
/plan /schedule 30m /boost Deploy staging release and verify sanity
```

**Compound Execution Pipeline Behavior:**
1. **Deduplication & Extraction**: Separates all command tokens and extracts the core directive and optional pipe-delimited parameters.
2. **DM Elevation Guard**: If a compound command with shared project scope is issued inside a Direct Message (`dm-*`), KIN automatically notifies the operator and elevates the execution to `#general` with `@Boss` leadership.
3. **Multi-Mode Engagement**:
   - Generates the unified **Workforce Collaboration Matrix** (`/teamwork-preview`).
   - Registers or deduplicates the **Project Goal** (`/goal`).
   - Builds the milestone **Breakdown DAG** (`/plan`).
   - Configures timers or routines if specified (`/schedule`, `/routine`).
   - Injects the **High-Autonomy Boost Directive** (`/boost`).
4. **Unified Master Compound Card**: Posts a single consolidated Markdown card into the channel with mode badges, project context, Git status, engine diagnostics, and milestone task lists.
5. **Autonomous Dispatch**: Dispatches `@Boss` and coworkers to immediately begin executing Phase 1 deliverables without requiring secondary operator confirmation.
