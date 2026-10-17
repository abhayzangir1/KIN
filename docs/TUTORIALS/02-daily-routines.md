# Tutorial 2: Configuring Timers and Proactive Background Routines

KIN includes a native background automation scheduler that runs independently of open chat windows. This tutorial explains how to set one-shot timers, author recurring cron routines, and build proactive workspace monitoring bots that report directly to project channels.

---

## How KIN Scheduling Works

Unlike cloud SaaS platforms that require webhooks or external cron daemons, KIN's scheduler runs as an internal service (`core/src/automation/scheduler_service.ts`) backed by SQLite:
- **Durable Persistence**: All schedules are written to the `schedules` and `schedule_attempts` tables in WAL mode.
- **Precision Calendar**: Uses a robust five-field cron parser (`core/src/automation/cron_calendar.ts`) to compute exact future timestamps.
- **Daemon Resilience**: If the daemon or computer restarts, KIN recovers missed or pending schedules upon startup and executes overdue triggers according to configurable catch-up policies.

```
[Cron Calendar / Interval Parser]
               │
               ▼
   [SQLite 'schedules' Table]
               │ (tick evaluation)
               ▼
       [SchedulerService]
               │
      (Dispatches Wakeup)
               │
               ▼
        [AgentKernel] ──► Dispatches Run ──► [@Boss / Specialist] ──► Publishes Digest
```

---

## Part 1: Setting One-Shot Timers

One-shot timers are ideal for reminders, build polling, or delayed follow-ups.

### Example 1: Standard Relative Timer
In any channel, schedule an agent wake-up:
```text
/schedule 15m Check backend build status and verify docker container health
```
- **Result**: KIN registers a one-shot timer scheduled for `Date.now() + 15 * 60 * 1000`.
- **Feedback**: A confirmation card appears in the channel displaying the target time and timer ID (e.g. `sched-1792...`).
- **Trigger**: When the timer expires, KIN automatically dispatches a run to the target agent with your directive.

### Example 2: Natural Language Duration
You can also use human-friendly phrases:
```text
/schedule in 2 hours Run integration tests against staging environment
/timer 45s Ping database to verify connection pool recovery
```

---

## Part 2: Creating Recurring Routines

Recurring routines automate repetitive engineering workflows such as daily standup digests, dependency updates, and git commit summaries.

### Syntax
```text
/routine <cron expression> <directive>
/routine <interval> <directive>
```

### Standard Cron Formats (5 Fields: Minute Hour Day-of-Month Month Day-of-Week)
- `0 9 * * *` — Every day at 09:00 AM local time.
- `*/30 * * * *` — Every 30 minutes.
- `0 18 * * 1-5` — Weekdays at 6:00 PM (end-of-day summary).
- `0 0 * * 0` — Every Sunday at midnight (weekly architecture audit).

### Interval Formats
- `4h` — Every 4 hours.
- `12h` — Twice a day.
- `1d` — Once daily.

### Practical Example: Daily Morning Briefing Bot
To set up a daily workspace status briefing:
```text
/routine 0 9 * * * Review open milestone tasks, recent git commits from the last 24h, and summarize blocked items into #general
```

**Execution Flow:**
1. At 09:00 AM, the scheduler triggers a background wake-up for `@Boss`.
2. `@Boss` executes a read-only query against:
   - SQLite tasks repository (`taskRepo.listTasksByProject`).
   - Git log via `executeShell` (`git log --since="24 hours ago" --oneline`).
3. `@Boss` composes an executive markdown digest and broadcasts it via `channel_post` to `#general`.
4. Team members receive real-time notifications via SSE.

---

## Part 3: Inspecting & Managing Active Schedules

### Via Slash Command
To view and manage schedules in your active channel:
```text
/schedule list
```
Displays all scheduled items, next trigger times, interval rules, and active states.

### Via REST API
You can also inspect or cancel schedules programmatically:
```bash
# List all schedules for the project
curl -H "Authorization: Bearer $KIN_TOKEN" \
  http://127.0.0.1:54321/api/projects/proj-default/schedules

# Cancel a specific schedule
curl -X DELETE -H "Authorization: Bearer $KIN_TOKEN" \
  http://127.0.0.1:54321/api/schedules/sched-123456
```

---

## Operational Tips
- **Keep Daemons Running**: Schedules fire as long as the KIN Core Daemon is active. For continuous 24/7 background operation, run KIN as a background system service or startup task.
- **Idempotent Prompts**: Ensure routine directives are self-contained and idempotent so that repetitive triggers do not generate duplicate tickets or spam channels.
- **Model Efficiency**: For lightweight daily routines, configure local Ollama models (such as `qwen2.5:7b` or `llama3.2`) to eliminate cloud API costs for routine monitoring.
