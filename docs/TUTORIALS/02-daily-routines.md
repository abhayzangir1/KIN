# Tutorial 2: Configuring Proactive Timers & Background Routines

In KIN, autonomous agents do not waste host compute or burn CPU cycles with active busy-polling loops. Instead, agents register durable schedules with the platform scheduler and transition into quiescent sleep until triggered.

This tutorial guides you through configuring non-blocking one-shot wakeup timers and recurring maintenance routines.

---

## Architectural Principles

1. **Quiescent Sleep**: When waiting on a long-running external process (such as a large build, database backup, or remote deployment), agents schedule a wakeup and release CPU resources.
2. **Durable Persistence**: All schedules are stored in the SQLite `schedules` table, enabling scheduled tasks to survive daemon restarts.
3. **Channel Delivery**: When a schedule fires, the scheduler constructs a high-priority prompt and dispatches it directly to the designated project channel and agent identity.

---

## Step-by-Step Implementation

### Step 1: One-Shot Timers with `/schedule`

A one-shot timer directs an agent to perform an action after a specified duration has elapsed.

#### Syntax
```text
/schedule <duration> <directive>
```
*Durations support `s` (seconds), `m` (minutes), `h` (hours), or `d` (days).*

#### Example
In the chat interface, execute:
```text
/schedule 45s Check compilation artifacts and verify bundle sizes
```

#### What Happens Internally
1. The server registers a schedule record in SQLite:
   - `type`: `one_shot`
   - `duration_seconds`: `45`
   - `prompt`: `"Check compilation artifacts and verify bundle sizes"`
   - `target_channel_id`: Current channel ID
2. The agent yields execution immediately.
3. After 45 seconds, the scheduler dispatches the wakeup prompt to `@Boss`, which inspects the build directory and reports status.

---

### Step 2: Recurring Routines with `/routine`

Recurring routines schedule repetitive maintenance, monitoring, or synthesis workflows.

#### Syntax
```text
/routine <interval_or_cron> <directive>
```
*Supports standard 5-part cron expressions (e.g., `0 9 * * *` for daily 9 AM) or shorthand intervals (e.g., `*/15m`, `*/2h`).*

#### Example
Set up an automated workspace health audit:
```text
/routine */15m Audit disk space, review memory limits, and check SQLite journal status
```

Every 15 minutes, the scheduler triggers `@Boss` or a designated specialist to inspect system health and report any anomalies.

---

### Step 3: Inspecting Active Schedules

To view all scheduled timers and active recurring routines, use `/schedule list`:

```text
/schedule list
```

The system responds with a formatted card displaying:
- **ID**: Unique schedule UUID (e.g., `sched-a1b2c3d4`)
- **Type**: `one_shot` or `cron`
- **Cadence / Due**: Time remaining or interval expression
- **Directive**: The scheduled instruction
- **Status**: `active` or `paused`

You can also query active routines via REST:
```bash
curl -X GET http://127.0.0.1:54321/api/automations
```

---

### Step 4: Canceling or Modifying Routines

To terminate an active schedule before it triggers:

```text
/schedule cancel sched-a1b2c3d4
```

Or via REST API:
```bash
curl -X DELETE http://127.0.0.1:54321/api/automations/sched-a1b2c3d4
```

The scheduler immediately unlinks the timer and marks the schedule record as cancelled.

---

## Direct Tool Invocation by Agents

Specialist agents can self-schedule wakeup reminders directly through tool calls during autonomous execution loops:

```json
{
  "tool": "schedule",
  "parameters": {
    "prompt": "Inspect test container logs and report test results",
    "durationSeconds": 60,
    "type": "one_shot"
  }
}
```

The runtime registers the schedule, pauses the agent run, and wakes the agent upon expiration without manual operator intervention.
