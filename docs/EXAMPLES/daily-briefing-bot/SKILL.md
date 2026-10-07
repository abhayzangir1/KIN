---
name: daily-briefing-bot
version: 1.0.0
description: >
  Example scaffold; its included handler returns fixed sample counts and does not query workspace state.
skill_type: workflow
enabled: true
required_tools:
  - schedule
  - readFile
  - executeShell
trigger_patterns:
  - briefing
  - daily
  - morning
  - routine
  - digest
  - summary
parameters:
  interval: "0 9 * * *"
  includeHealth: true
---

# Daily Briefing Bot Skill

> Example only. The included implementation returns canned values such as two active goals, five pending tasks, and “All services operational.” It does not collect live workspace or health data.

Automates compiling proactive morning briefings and executive workspace digests without operator prompting.

## When to Use
Activate this skill whenever:
- Running periodic team status checks or standups.
- Reviewing open milestone tasks and blocked goals.
- Verifying workspace repository commits and system health metrics.

## Routine Specification
- **Schedule Type**: Recurring cron routine
- **Recommended Schedule**: `0 9 * * *` (Daily at 09:00 local time)
- **Direct Activation Slash Command**:
  ```text
  /routine 0 9 * * * Compile daily workspace briefing covering active goals, pending tasks, and recent git commits
  ```

## Step-by-Step Procedure

1. **Collect Goal & Task Status**:
   - Query uncompleted tasks from SQLite state.
   - Group tasks by assigned specialist (`@Backend`, `@Frontend`, `@QA`).

2. **Audit Recent Repository Commits**:
   - Run `git log --oneline -n 10` using `executeShell`.
   - Identify recent changes and newly merged features.

3. **Check System Diagnostics**:
   - Query system health to confirm database journal and memory usage remain within safe limits.

4. **Format & Publish Executive Digest**:
   - Render a formatted briefing card into the primary `#general` channel:
     - **Active Goals**: Current milestones and progress percentages.
     - **Assigned Priorities**: Outstanding high-priority items.
     - **Recent Progress**: Summary of recent git commits.
     - **System Diagnostics**: Database and resource availability status.
