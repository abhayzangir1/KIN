# KIN Tutorials & Practical Workflows

*All tutorials and workflows documented here are verified against the active KIN test suite and core runtime.*

---

## Tutorial 1: Building a Deep Research Swarm

In this tutorial, you will coordinate a multi-agent team to investigate a technical topic, extract web documentation, and synthesize findings into an executive report.

### Objective
Deploy a collaborative agent team that:
1. Formulates search queries and navigates technical documentation using persistent browser sessions.
2. Extracts key technical findings without scraping timeouts.
3. Synthesizes findings under `@Boss` supervision and records decisions.

### Step-by-Step Walkthrough

#### Step 1: Open the Project & Channel
1. In the KIN workbench, select the active project (`KIN` or create a new project).
2. Enter the `#general` team channel.

#### Step 2: Hire Specialist Agents
Recruit your specialist workforce using the `/hire` slash command:
```
/hire researcher "Gathers web documentation and extracts API specifications"
/hire synthesizer "Consolidates multi-source findings into executive briefs"
```

#### Step 3: Define Goal & Decompose Plan
Establish a persistent project goal and generate a milestone dependency DAG:
```
/goal Research SQLite WAL Concurrency & Lock Escalation Limits
/plan Evaluate reader/writer starvation thresholds and checkpoint performance
```
`@Boss` automatically decomposes this prompt into structured milestone tasks.

#### Step 4: Execute Web Research
Instruct `@researcher` to navigate to documentation:
```
@researcher Please inspect the SQLite WAL documentation at https://sqlite.org/wal.html, extract the reader-writer concurrency model, and summarize key trade-offs.
```
The agent invokes `browserNavigate` and `browserInspect`, recording step trajectories and producing structured notes in the channel.

#### Step 5: Executive Synthesis
Direct `@synthesizer` to finalize the brief:
```
@synthesizer Consolidate @researcher's notes into an executive summary with concrete configuration recommendations.
```

---

## Tutorial 2: Creating and Persisting a Custom Skill

This tutorial demonstrates how to define a custom procedural skill that persists across application restarts in both SQLite and the `.kin/skills/` directory.

### Objective
Create a custom `git-changelog-generator` skill that automates formatting release notes.

### Step-by-Step Walkthrough

#### Step 1: Issue the Slash Command
In the chat bar of any channel, execute:
```
/skills create git-changelog-generator | Generates clean markdown changelogs from git history | 1. Run git log since last tag. 2. Group commits by feat, fix, docs. 3. Format markdown. | executeShell | git,changelog,release
```

#### Step 2: Verify Persistence
KIN immediately persists the skill definition:
1. **SQLite Database**: Inserted into the authoritative `skills` table with status `active`.
2. **Local Workstation Disk**: Written to `.kin/skills/git-changelog-generator/SKILL.md`:
   ```markdown
   ---
   name: git-changelog-generator
   version: 1.0.0
   description: >
     Generates clean markdown changelogs from git history
   skill_type: tool_extension
   enabled: true
   required_tools: ["executeShell"]
   trigger_patterns: ["git", "changelog", "release"]
   parameters: {}
   ---

   1. Run git log since last tag. 2. Group commits by feat, fix, docs. 3. Format markdown.
   ```

#### Step 3: Automated Activation
Next time you or an agent asks:
```
@Boss Please generate the release changelog for the latest commit batch.
```
The `SkillEngine` matches `changelog` and `release` trigger patterns and injects this procedural guide directly into the agent's context prompt.

---

## Tutorial 3: Configuring Proactive Timers & Background Routines

Agents in KIN do not waste workstation resources with busy-polling loops. Instead, they register durable timers with the platform scheduler and enter a quiescent sleep state.

### Objective
Set up a non-blocking one-shot wakeup timer and a recurring background health routine.

### Step-by-Step Walkthrough

#### Step 1: Set a One-Shot Timer (`/schedule`)
To instruct an agent to pause and awaken after a specified duration:
```
/schedule 30s Check on background build progress and report status
```
- KIN registers a durable schedule record in SQLite.
- The agent loop transitions to quiescent idle without consuming CPU cycles.
- When 30 seconds elapse, the scheduler wakes the agent with the reminder prompt.

#### Step 2: Set a Recurring Routine (`/routine`)
To establish a periodic background maintenance job:
```
/routine */15m Audit disk space and check SQLite WAL journal size
```
The routine fires every 15 minutes, prompting the assigned agent to check system health.

#### Step 3: Inspect Active Schedules
List all active scheduled timers anytime:
```
/schedule list
```
Or cancel a specific routine:
```
/schedule cancel <schedule-id>
```

---

## Tutorial 4: Stress-Testing Architecture with `/grill-me`

KIN features an interactive architectural stress-testing protocol inspired by adversarial engineering reviews.

### Objective
Conduct an interactive requirements and trade-off alignment session, then record decisions as Architectural Decision Records (ADRs).

### Step-by-Step Walkthrough

#### Step 1: Initiate the Session
In the `#general` channel, trigger `/grill-me` with your topic:
```
/grill-me High-Concurrency SQLite Persistence & Crash Recovery
```

#### Step 2: Evaluate Trade-Offs
`@Boss` launches an interactive assessment card challenging your system design on:
1. Host power loss during active WAL disk writes.
2. Cloud LLM rate-limit failovers.
3. Concurrent agent worker race prevention.

#### Step 3: Formalize Decision Records (ADRs)
Once the trade-offs are settled, propose and commit the decision:
```
/decision propose WAL Mode with Checkpointing | Enables concurrent reads alongside active writes without lock escalation | In-memory queues, Shared file locks
```
The decision is recorded in SQLite under project architectural decisions and visible in the **Decisions** tab of the Workbench.
