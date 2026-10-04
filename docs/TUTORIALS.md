# KIN Tutorials & Practical Workflows

Welcome to the KIN tutorials suite. Every workflow, command, and skill example documented here is verified against the active KIN core test suite and runtime architecture.

---

## 📚 Core Tutorials

Detailed walkthroughs for building multi-agent teams, automating routines, isolating parallel work, and executing advanced workflows:

### [Tutorial 1: Building an Autonomous 3-Agent Research Swarm](file:///d:/KIN/docs/TUTORIALS/01-research-swarm.md)
Learn how to deploy a collaborative agent team combining `@Boss`, `@researcher`, and `@synthesizer`:
- Formulate strategic goals (`/goal`) and milestone DAGs (`/plan`).
- Recruit specialists (`/hire`).
- Direct persistent browser sessions using real browser automation tools (`browserNavigate`, `browserInspect`).
- Synthesize technical findings and commit Architecture Decision Records (`/decision`).

### [Tutorial 2: Configuring Proactive Timers & Background Routines](file:///d:/KIN/docs/TUTORIALS/02-daily-routines.md)
Discover how KIN handles non-blocking automation without burning CPU cycles:
- Register one-shot timers with `/schedule <duration> <directive>`.
- Configure recurring maintenance jobs with `/routine <cron> <directive>`.
- Inspect and cancel active schedules via `/schedule list` and `/schedule cancel`.
- Allow agents to enter quiescent sleep while awaiting time-based callbacks.

### [Tutorial 3: Parallel Feature Development with Git Worktrees & AI Review](file:///d:/KIN/docs/TUTORIALS/03-parallel-coding.md)
Prevent branch collisions and index lock contention during multi-agent coding:
- Provision isolated git worktrees with `WorktreeManager.provisionWorktree()`.
- Run specialist agents inside isolated workspaces without repository conflicts.
- Commit worktree changes and generate unified diffs.
- Request automated AI code reviews via `POST /api/projects/:id/git/review`.

### [Tutorial 4: Advanced Workflows: Compound Pipelines & Architecture Reviews](file:///d:/KIN/docs/TUTORIALS/04-advanced-workflows.md)
Master enterprise coordination and architectural hardening:
- Execute compound command pipelines: `/plan /boost /teamwork-preview /goal <Title> | <Desc> | <Criteria>`.
- Stress-test system assumptions using adversarial review cards (`/grill-me`).
- Formalize trade-offs into authoritative ADRs (`/decision propose`).

---

## 🛠️ Runnable Skill Packages & Examples

KIN includes ready-to-import runnable skill packages under [`docs/EXAMPLES/`](file:///d:/KIN/docs/EXAMPLES/):

| Skill Name | Type | Description | Required Tools | Directory |
|---|---|---|---|---|
| **research-analyzer** | Tool Extension | Deep technical documentation analysis and contract extraction | `browserNavigate`, `browserInspect`, `readFile` | [`docs/EXAMPLES/research-analyzer`](file:///d:/KIN/docs/EXAMPLES/research-analyzer) |
| **daily-briefing-bot** | Workflow | Proactive workspace digest and daily status compiler | `schedule`, `readFile`, `executeShell` | [`docs/EXAMPLES/daily-briefing-bot`](file:///d:/KIN/docs/EXAMPLES/daily-briefing-bot) |
| **github-triage-bot** | Tool Extension | PR triage, git diff review, and regression checking | `readFile`, `executeShell` | [`docs/EXAMPLES/github-triage-bot`](file:///d:/KIN/docs/EXAMPLES/github-triage-bot) |

### How to Import an Example Skill

#### Method 1: Using Slash Commands in Workbench
In any channel, import a skill directory directly into persistent storage:
```text
/skills import docs/EXAMPLES/research-analyzer
```
KIN parses `SKILL.md`, compiles parameters and handler code, inserts the definition into the SQLite `skills` table, and mirrors it into `.kin/skills/research-analyzer/`.

#### Method 2: Import All Examples at Once
Import the entire bundle directory:
```text
/skills import docs/EXAMPLES
```

#### Method 3: Via REST API
```bash
curl -X POST http://127.0.0.1:54321/api/skills/import \
  -H "Content-Type: application/json" \
  -d '{"directoryPath": "docs/EXAMPLES/research-analyzer"}'
```

---

## Additional Documentation
- [Skills Guide](file:///d:/KIN/docs/SKILLS_GUIDE.md) — Comprehensive guide to authoring procedural and tool skills.
- [Slash Commands Reference](file:///d:/KIN/docs/SLASH_COMMANDS.md) — Full syntax guide for all chat commands.
- [API Reference](file:///d:/KIN/docs/API.md) — REST endpoints and real-time SSE specifications.
- [Architecture](file:///d:/KIN/docs/ARCHITECTURE.md) — System layering and concurrency contracts.
