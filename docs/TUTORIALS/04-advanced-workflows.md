# Tutorial 4: Advanced Workflows: Compound Command Pipelines & Architectural Stress-Testing

This tutorial explores compound command pipelines and adversarial architectural reviews in KIN. These advanced capabilities enable teams to initialize complex initiatives in a single message and stress-test technical assumptions before writing production code.

---

## Part 1: Compound Command Pipelines

Complex tasks often require setting goals, adjusting agent autonomy, previewing team assignments, and breaking work down into a milestone DAG. Instead of executing multiple conversational turns, KIN allows compounding slash commands into a single directive.

### Pipeline Syntax

Compound commands chain slash commands followed by the initiative description and acceptance criteria:

```text
/plan /boost /teamwork-preview /goal <Title> | <Description> | <Acceptance Criteria>
```

### Concrete Example

In any project channel, submit:

```text
/plan /boost /teamwork-preview /goal Hardened Sovereign Core | Enterprise resilience and contracts | Contract verification, full test suite pass
```

### Chained Execution Lifecycle

When KIN encounters this compound string, the slash command parser unpacks and executes each stage sequentially:

1. **`/goal` (Goal Registration)**:
   - Registers an authoritative goal entity in SQLite.
   - Sets title to `"Hardened Sovereign Core"`, description to `"Enterprise resilience and contracts"`, and stores the acceptance criteria.
2. **`/boost` (Quota Allocation)**:
   - Elevates reasoning token allowances for the upcoming tasks, enabling deeper multi-turn analysis.
3. **`/teamwork-preview` (Workforce Collaboration Matrix)**:
   - Evaluates active agent skills and generates a pre-flight collaboration matrix in the channel, detailing which specialists (`@Backend`, `@Frontend`, `@QA`, `@Boss`) will handle each component.
4. **`/plan` (Milestone Task DAG)**:
   - Decomposes the initiative into ordered milestone tasks linked with dependency edges.
   - Assigns tasks to the appropriate specialist identities.

The channel immediately displays a unified **Compound Pipeline Engaged** card summarizing the goal, teamwork preview, and milestone tasks.

---

## Part 2: Architectural Stress-Testing with `/grill-me`

Before committing to a technical direction, high-performing engineering teams subject designs to adversarial review. KIN automates this via the `/grill-me` command.

### Launching an Architecture Review

Trigger an inquiry on any architectural topic:

```text
/grill-me Database Redundancy and Failover Strategy
```

### The Interactive Grilling Card

`@Boss` immediately responds with an adversarial questionnaire examining potential failure modes:

1. **Host Power Loss**:
   *What happens if workstation power drops during an active SQLite WAL checkpoint?*
   - Option A: WAL replay on startup restores database to last valid transaction.
   - Option B: Maintain shadow replica on a secondary volume.
2. **Concurrency Thresholds**:
   *How does the design prevent reader starvation under thousands of concurrent requests?*
   - Option A: Periodic active checkpoints (`PASSIVE` to `RESTART`).
   - Option B: Queue long-running analytics queries into dedicated read replicas.
3. **Recovery Procedures**:
   *How are stale task leases reclaimed when an agent process exits unexpectedly?*
   - Option A: Periodic heartbeat watchdog marks leases stale after 60 seconds.
   - Option B: Ephemeral worktree deletion upon supervisor reboot.

Engaging with the card clarifies edge cases and exposes hidden architectural risks prior to implementation.

---

## Part 3: Architecture Decision Records (ADRs)

Once consensus is reached, formalize the design into an immutable Architecture Decision Record using `/decision`.

### Proposing an ADR

```text
/decision propose WAL Mode with Periodic Checkpointing | Prevents reader-writer starvation while maintaining zero external server dependencies | In-memory queues, Exclusive file locking
```

### ADR Fields
- **Title**: The core architectural choice.
- **Rationale**: The justification and evaluated trade-offs.
- **Alternatives Considered**: Other approaches analyzed and rejected.

### Storage & Runtime Integration
- **SQLite Persistence**: Stored in the `decisions` table with status `authoritative`.
- **Workbench Visibility**: Displayed under the **Decisions** tab in the desktop application.
- **Context Injection**: Authoritative decisions are automatically compiled into Block 3 of the LLM context prompt for all subsequent agent runs, ensuring the entire workforce adheres to agreed architectural rules.
