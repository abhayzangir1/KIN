# Tutorial 1: Building an Autonomous 3-Agent Research Swarm

This tutorial walks through coordinating a multi-agent team in KIN to investigate technical topics, extract web documentation using real browser tools, and synthesize findings into an authoritative report.

---

## Architecture of the Research Swarm

A research swarm in KIN divides cognitive labor among three specialized agent identities:

1. **`@Boss` (Swarm Orchestrator)**: Decomposes high-level requirements into milestone task DAGs, arbitrates resource allocation, and validates final output.
2. **`@researcher` (Web & Data Specialist)**: Navigates documentation, queries endpoints, and inspects interactive web pages using persistent browser sessions (`browserNavigate`, `browserInspect`).
3. **`@synthesizer` (Technical Synthesizer)**: Consolidates findings from `@researcher`, identifies architectural trade-offs, and formulates Architecture Decision Records (ADRs).

All agents share the SQLite transactional state fabric and communicate asynchronously over project channels.

---

## Step-by-Step Implementation

### Step 1: Establish the Project Goal

Define the top-level mission using the `/goal` command in the `#general` channel:

```text
/goal Investigate SQLite Concurrency and WAL Lock Escalation Limits
```

KIN records this goal in SQLite with status `active` and links subsequent tasks to its identifier.

---

### Step 2: Decompose the Mission into a Task DAG

Use `/plan` to prompt `@Boss` to decompose the goal into structured milestones:

```text
/plan Analyze SQLite WAL reader-writer concurrency, checkpoint behavior under heavy load, and write starvation thresholds
```

`@Boss` evaluates workforce capabilities, provisions a milestone dependency graph, and registers subtasks in the database:
- **Task 1**: Navigate official documentation and extract WAL locking rules.
- **Task 2**: Analyze lock escalation patterns during checkpointing.
- **Task 3**: Draft executive synthesis and configuration recommendations.

---

### Step 3: Recruit Specialist Agents

If your workforce does not yet have dedicated specialists, recruit them with `/hire`:

```text
/hire researcher "Navigates technical documentation and inspects web pages"
/hire synthesizer "Consolidates multi-source technical notes into executive reports"
```

KIN generates agent identities with tailored system prompts and tools:
- `@researcher` is granted `web:browse` capability (`browserNavigate`, `browserInspect`, `browserScreenshot`).
- `@synthesizer` is granted `agent:coordinate` and `fs:read` capabilities.

---

### Step 4: Dispatch the Web Research Specialist

Assign `@researcher` to navigate directly to the authoritative documentation:

```text
@researcher Please navigate to https://sqlite.org/wal.html, inspect the technical layout, and extract the reader-writer concurrency characteristics.
```

#### Under the Hood: Tool Execution Trajectory
During this step, the agent runtime executes the following sequence:

1. **`browserNavigate`**:
   ```json
   {
     "url": "https://sqlite.org/wal.html"
   }
   ```
   Headless or interactive Chromium connects to the remote page, retaining session state and cookies across agent turns.

2. **`browserInspect`**:
   ```json
   {
     "detailed": true
   }
   ```
   Inspects page title, headings, paragraph content, and interactive DOM elements without relying on fragile external web scrapers.

3. `@researcher` formats its extracted observations and posts structured notes back into the channel for the team.

---

### Step 5: Synthesize Findings and Record Architectural Decisions

Instruct `@synthesizer` to consolidate the observations:

```text
@synthesizer Consolidate @researcher's notes into an executive summary with concrete configuration recommendations.
```

`@synthesizer` reads the research trajectory and drafts an executive brief:
- **Concurrency Model**: Readers do not block writers, and writers do not block readers.
- **Starvation Boundary**: Many concurrent readers can prevent WAL checkpoints from completing.
- **Recommendation**: Configure periodic active checkpointing (`PRAGMA wal_checkpoint(PASSIVE)`) and set `busy_timeout` to 5000ms.

Finally, formalize the consensus as an Architecture Decision Record (ADR):

```text
/decision propose SQLite WAL Mode with Periodic Checkpoints | Prevents writer starvation under heavy reader volume | In-memory queues, Exclusive file locks
```

The decision is committed to SQLite and instantly reflected across the project workbench.

---

## Verifying Swarm Execution

To programmatically verify swarm state:
1. **Query Active Runs**: Send `GET /api/runs` to inspect execution state and tool invocation counts.
2. **Channel Transcript**: Send `GET /api/channels/:id/messages` to verify step-by-step communication between `@researcher`, `@synthesizer`, and `@Boss`.
3. **Task Completion**: Send `GET /api/state?projectId=:id` to verify all planned tasks transitioned to `completed`.
