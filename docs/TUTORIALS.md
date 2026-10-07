# KIN tutorials and workflow sketches

These documents are examples of intended KIN workflows. They have not all been run against the current checkout. Commands, endpoints, skill behavior, and UI labels may change; verify them in the application before relying on a workflow. Read the [current audit](../KIN_AUDIT_2026-10-07.md) for known limitations.

## Workflow documents

- [Research workflow](TUTORIALS/01-research-swarm.md) — a suggested way to divide a research task among agent identities.
- [Timers and routines](TUTORIALS/02-daily-routines.md) — examples involving one-time and recurring schedules.
- [Parallel coding](TUTORIALS/03-parallel-coding.md) — a worktree-based coding workflow sketch.
- [Advanced workflows](TUTORIALS/04-advanced-workflows.md) — examples of compound commands and architecture review.

## Example skill folders

The folders under EXAMPLES are sample packages for inspection. Their presence does not mean they connect to the listed services or produce live results. Some example handlers return canned values and should be treated as scaffolding.

- [Daily briefing example](EXAMPLES/daily-briefing-bot/)
- [GitHub triage example](EXAMPLES/github-triage-bot/)
- [Research analyzer example](EXAMPLES/research-analyzer/)

Review each SKILL.md and implementation before importing it. Only import executable skills you understand and trust.

## Related documentation

- [Skills guide](SKILLS_GUIDE.md)
- [Slash command reference](SLASH_COMMANDS.md)
- [API reference](API.md)
- [Architecture notes](ARCHITECTURE.md)
- [FAQ](FAQ.md)
