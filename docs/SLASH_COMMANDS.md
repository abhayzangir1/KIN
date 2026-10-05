# KIN Slash Commands Reference

KIN provides a unified slash command interpreter in the Workbench chat interface for directing autonomous agent swarms, scheduling timers, managing skills, and formalizing architecture decisions.

---

## Quick Reference Table

| Command | Syntax | Purpose | Example |
|---------|--------|---------|---------|
| `/plan` | `/plan <objective>` | Decompose a high-level goal into a milestone dependency DAG | `/plan Build OAuth2 authentication flow with JWT tokens` |
| `/goal` | `/goal <title>` | Create a persistent top-level project goal | `/goal Achieve sub-50ms SQLite read latency in WAL mode` |
| `/schedule` | `/schedule <duration> [prompt]` | Register a non-blocking one-shot timer for agent wakeup | `/schedule 45s Check build output and verify artifacts` |
| `/routine` | `/routine <cron \| interval> [prompt]` | Configure a recurring background task | `/routine */30m Inspect memory usage and clean test caches` |
| `/skills` | `/skills [list]` | Display all installed built-in and persistent custom skills | `/skills` |
| `/skills create` | `/skills create <name> \| <desc> \| <inst> [\| <tools> \| <tags>]` | Dynamically create and persist a custom skill to disk & DB | `/skills create pdf-reader \| Extract text from PDF \| Read file and extract text \| readFile \| pdf,extract` |
| `/skills import` | `/skills import <path \| json>` | Import an external skill package or directory into storage | `/skills import ./my-external-skills` |
| `/btw` | `/btw <question>` | Dedicated non-blocking fast-path side inquiry | `/btw What port is the core daemon running on?` |
| `/grill-me` | `/grill-me [topic]` | Launch interactive architecture stress-testing review | `/grill-me Database Lock Contention & Crash Recovery` |
| `/decision` or `/decisions` | `/decision [propose <title> \| <rationale> \| <alts> \| choose <choice>]` | Record, list, or authoritatively select Architecture Decision Records (ADR) | `/decision choose Option A: Shift from REST to GraphQL` |
| `/hire` | `/hire <role> [description]` | Register and hire a specialist agent definition | `/hire researcher "Inspects technical documentation and APIs"` |
| `/assign` | `/assign <agent> <task>` | Assign a task directly to a specific specialist agent | `/assign @researcher Analyze competitor performance metrics` |
| `/help` | `/help` | Display platform capabilities and command usage | `/help` |

---

## Detailed Command Specifications

### 1. `/plan` (Decomposition & Execution)
Decomposes complex requests into milestone task DAGs:
```
/plan Refactor core server endpoints into modular route controllers
```
- `@Boss` evaluates required capabilities, assigns tasks to specialists (`@Backend`, `@Frontend`, `@QA`), and visualizes progress in the **Swarm Map**.

### 2. `/schedule` & `/routine` (Non-Blocking Timers)
Agents enter quiescent sleep without polling CPU loops:
- **One-Shot Wakeup**: `/schedule 60s Resume testing after migration script completes`
- **Recurring Routine**: `/routine */1h Run test suite and report regression status`
- **List Schedules**: `/schedule list`
- **Cancel Routine**: `/schedule cancel <schedule-id>`

### 3. `/skills` (Skill Management & Persistence)
Manage procedural skills stored in SQLite and `.kin/skills/`:
- **Create**:
  ```
  /skills create log-analyzer | Parses daemon logs for SQL errors | Search logs for SQLITE_BUSY and report timestamps | readFile | logs,sqlite
  ```
- **Import**:
  ```
  /skills import .kin/skills/my-skill-bundle
  ```
- **List**:
  ```
  /skills
  ```

### 4. `/btw` (Fast-Path Ephemeral Inquiry)
Asks a question without creating DAG tasks or acquiring agent work leases:
```
/btw Is Ollama currently online on port 11434?
```
The request executes in parallel on a fast path, responding immediately in the channel.

### 5. `/grill-me` & `/decision` (Architecture Hardening & Interactive Replanning)
Launches an adversarial architecture inquiry session:
```
/grill-me Distributed Task Leases and Heartbeat Watchdogs
```
Select choices from the interactive **Grill-Me Assessment Card** to forge decisions, or propose directly:
```
/decision propose Atomic Task Leases | Watchdogs reclaim expired leases without deadlocks | Redis redlocks, Global mutex
```

#### Interactive Replanning & Decision Cards:
When an agent encounters blocked states or proposes architectural adjustments using `proposePlanAdjustment`, KIN renders an interactive `[DECISION_CARD]` directly in chat.
Clicking **Choose Option A**, **Choose Option B**, or **Apply Compromise** automatically executes:
```
/decisions choose Option A: Shift from REST to GraphQL
```
This records an authoritative ADR in the `decisions` table and adopts the direction across active goals.

### 6. Compound Command Pipelines
KIN supports chained slash commands executed sequentially in a single invocation:
```
/plan /boost /teamwork-preview /goal Deploy Next.js frontend with Tailwind CSS
```
- `/goal`: Establishes the authoritative goal in SQLite.
- `/plan`: Decomposes milestones into specialist subtasks.
- `/boost`: Allocates additional token quotas for complex turns.
- `/teamwork-preview`: Visualizes agent role assignments before work begins.
