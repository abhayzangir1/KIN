# KIN — FINAL MASTER PRODUCT REQUIREMENTS DOCUMENT
## Version 12.0 — Autonomous Scheduler, Computer Use & Proactive Routines Evolution

**Date:** 2026-10-01  
**Status:** Authoritative product baseline (V12)  
**Product:** KIN  
**Category:** Local-first autonomous AI workforce and multi-agent coordination platform  
**Platforms:** Windows, macOS, Linux  
**Distribution:** Open source  
**Primary UX:** Message-first collaborative workspace with Antigravity-Style Timed Autonomy  

---

## 0. Canonical decisions

This document merges the three supplied KIN specifications into one product contract. Conflicts are resolved in favor of lower user friction, stronger autonomy, clearer authority boundaries, local-first operation, recoverability, and long-term extensibility.

### 0.1 Selected product architecture

- Tauri 2 is the desktop shell.
- Rust is the native/privileged boundary for platform integration, process supervision, secure IPC, filesystem roots, window lifecycle, packaging, and native capabilities.
- The main KIN agent/product runtime is a local TypeScript/Node sidecar/core rather than a Rust-only agent runtime.
- The core is a modular local monolith, not a local microservice fleet.
- DeepSeek Harness/Cordis, Google ADK, OpenHands, LangGraph/Deep Agents, OpenAI Agents SDK, Letta and similar systems are reference/adapter sources, not the authoritative KIN domain model.

### 0.2 Workspace model

The primary product hierarchy is:

```text
Workspace
├── Projects
│   ├── Teams
│   ├── Agents
│   ├── Channels
│   ├── DMs
│   ├── Goals / Tasks
│   ├── Artifacts
│   ├── Memory / Knowledge
│   └── Automations
├── Agent Library
├── Model / Provider Library
├── Tool / MCP Library
├── Skills Library
└── Settings
```

Organization and Department layers remain supported as future/optional enterprise extensions, not hard dependencies of the first-run experience.

### 0.3 Orchestrator model

There is one persistent **Default Orchestrator per workspace**.

It is:

- the primary human-facing counterpart;
- an ordinary agent with configured role/capabilities;
- able to answer or execute simple work itself;
- able to create/select projects;
- able to reuse, hire and spawn agents;
- able to delegate recursively subject to policy;
- never allowed to bypass permissions or approvals.

Projects do not create competing Root Orchestrator authorities.

### 0.4 Agent lifecycle model

KIN supports:

1. **Persistent agents** — stable coworkers whose identity, history, skills and memory survive runs and restarts.
2. **Ephemeral agents** — bounded short-lived workers created for isolated tasks.
3. **Agent runs** — individual executions of either lifecycle.
4. **Agent definitions** — reusable role/capability templates.
5. **Skills** — reusable procedural knowledge that can be attached to agents or dynamically retrieved.

### 0.5 Approval modes

Every workspace supports three user-selectable autonomy modes:

#### Mode A — Auto Approval

Automatically allow actions that satisfy the workspace policy and are reversible, scoped, and non-sensitive.

Examples:

- reversible file edits with a checkpoint/diff;
- local reads;
- local test execution;
- creating or updating internal tasks;
- non-destructive local tool use.

Anything outside the safe/reversible envelope escalates.

#### Mode B — Always Ask

Require interactive user approval before every consequential agent capability invocation and any configured operation class. The user sees the exact action, target, parameters, risk, and evidence.

#### Mode C — Full Access

Do not interrupt with approval prompts for actions already permitted by the user's explicit capability policy. Security boundaries, permission scopes, audit logs, host platform restrictions, kill switches, and policy enforcement remain active.

**Full Access is not permission bypass. It is approval-prompt bypass.**

### 0.6 Capability-improvement model

KIN has a deliberately small improvement layer. The product improves primarily by **reusing better procedures, memory, and runtime experience**, not by continuously retraining models or running a second autonomous meta-system.

```text
Current run
  -> self-correct / verify
  -> durable experience
  -> memory and/or skill candidate
  -> optional validation
  -> future reuse

Runtime faults
  -> self-heal
  -> checkpoint / recover / verify

Repeated task patterns
  -> improve a skill or lightweight routing/decomposition rule
  -> regression check
  -> staged adoption
```

### Selected priorities

1. **Skills are first-class** because they externalize reusable procedures and can be loaded only when relevant.
2. **Experience records** are durable evidence of what worked, failed, and why.
3. **Memory** stores durable facts, decisions, preferences, and validated lessons.
4. **Self-correction** is part of ordinary task execution.
5. **Self-healing** is part of ordinary runtime recovery.
6. **Lightweight adaptation** may improve skill selection, model selection, delegation and verification heuristics from accumulated outcomes.

### Explicitly not part of the core

- continuous reinforcement learning during normal user work;
- continuous model-weight updates;
- a permanent meta-agent evaluating every run;
- continuous replay of every historical trajectory;
- autonomous rewriting of KIN security, permissions or core architecture.

Dream-RSI is retained as a future research pattern for suitable long-horizon discovery workloads, not as a mandatory V1/V1.5 runtime.

---

# 1. Vision

KIN is a local-first desktop environment where a human can describe an outcome in ordinary language and a persistent AI workforce autonomously plans, communicates, executes, verifies, learns from experience, and recovers from failures while keeping the user in control.

The product combines:

- Discord/Slack-style channels, DMs, mentions, presence and visible collaboration;
- a default general-purpose assistant similar to a general conversational AI;
- source-backed research workflows;
- autonomous coding/project execution;
- persistent AI coworkers with identity, memory, history and skills;
- adaptive delegation and temporary specialist workers;
- durable tasks, artifacts, decisions, evidence and audit history.

### Product promise

> **The user describes the outcome. The workforce decides how to accomplish it.**

The product should minimize the amount of workflow configuration the human must perform while maximizing inspection, steering, interruption, verification, and rollback capability.

### Primary success measure

**Useful autonomous work per unit of user attention.**

---

# 2. What KIN is not

KIN is not:

- a chatbot with cosmetic personalities;
- a Discord clone with bots;
- a manual workflow builder;
- a cloud-only service;
- a fake simulation of a brain or consciousness;
- an unrestricted autonomous process with hidden permission escalation;
- a system that treats repetition as evidence of truth;
- a system that silently rewrites its own security policy.

---

# 3. Target users

## 3.1 Solo builder

A developer or technical founder with a mid-range machine who wants coding, research, documentation and operations delegated to a local AI workforce.

## 3.2 Privacy-constrained professional

A user working with sensitive material who needs local custody, inspectability, policy controls and an audit trail.

## 3.3 Power orchestrator

A technical user who wants granular models, tools, MCP servers, skills, permissions, agent policies and autonomy controls.

## 3.4 Evaluator / team lead

A user who wants reproducible runs, evidence, task state, cost/usage visibility and failure analysis.

---

# 4. First-run experience

A new installation should start with:

```text
Workspace
└── Default Orchestrator
```

The first user-facing interaction is a message composer, not a configuration wizard.

Example:

> Build the next release of my Android application, investigate the production issue, and prepare the release notes.

The orchestrator should:

1. understand the request;
2. determine whether a project already exists;
3. create/select a project when appropriate;
4. inspect existing capabilities;
5. reuse existing agents where possible;
6. hire/create specialists only when justified;
7. create a durable goal and task DAG;
8. establish channels only when useful;
9. execute simple work itself when efficient;
10. delegate specialized work when beneficial;
11. request approvals only according to policy;
12. verify outcomes;
13. persist useful knowledge and artifacts;
14. return a concise result with evidence.

The user is never required to choose a mode such as “coding mode” or “research mode” for ordinary tasks.

---

# 5. Core product concepts

| Concept | Definition |
|---|---|
| Workspace | The user's complete KIN environment |
| Project | A durable body of work with goals, tasks, files, agents and knowledge |
| Agent | A persistent or temporary AI worker |
| Agent Definition | Reusable role/capability template |
| Agent Identity | Stable coworker record |
| Agent Run | One execution instance |
| Channel | Shared visible communication surface |
| DM | Private scoped conversation |
| Goal | Desired outcome with constraints and acceptance criteria |
| Task | Durable unit of work with owner, status, dependencies and evidence |
| Skill | Reusable procedural knowledge / execution guidance |
| Memory | Durable knowledge, experience or state |
| Model | LLM/provider configuration |
| Tool | Executable capability |
| Artifact | Durable reviewable output |
| Event | Recorded state transition or runtime fact |
| Decision | Explicit durable project choice with evidence/context |
| Evidence | Source, test, tool result or human confirmation supporting a claim |

These concepts are distinct and must not be collapsed in the product model.

---

# 6. Agent experience

## 6.1 Persistent coworker

A persistent agent has:

- stable identity;
- display name/presence;
- role/responsibilities;
- skills;
- primary/fallback model policy;
- tool policy;
- permissions;
- project membership;
- channel membership;
- private memory;
- shared knowledge access;
- task history;
- artifact history;
- experience records;
- relationship metadata where applicable.

Changing the model does not change the agent identity.

## 6.2 Ephemeral worker

An ephemeral worker has:

- bounded objective;
- bounded context;
- bounded tools;
- bounded model;
- bounded token/cost/time budget;
- temporary workspace/state;
- structured result contract.

Its identity may disappear after completion while its run, result, task record and artifacts remain inspectable.

## 6.3 Presence

Presence must reflect real state, not decorative animation:

```text
idle
working
thinking
waiting
blocked
needs approval
paused
failed
done
recovering
```

---

# 7. Workforce formation and delegation

Any sufficiently authorized agent may:

- reuse existing child agents;
- create persistent specialists;
- spawn ephemeral workers;
- create child tasks;
- request review;
- wait for dependencies;
- cancel descendants;
- report structured results.

Delegation policy includes:

```text
maximum depth
maximum descendants
spawn rate
runtime budget
token budget
cost budget
allowed models
allowed roles
allowed tools
permission inheritance
project scope
cancellation behavior
approval mode
```

The default starting depth is 3, but the implementation must make this configurable rather than hard-coding it.

### Capability inheritance

Children receive only a subset of the parent's delegated capability envelope.

A role name never grants a capability.

### No implicit recursion

No agent may recursively spawn indefinitely.

### Loop breaker

Detect repetitive agent-to-agent communication without productive progress.

A productive signal includes at least one of:

- tool use;
- state mutation;
- task progress;
- artifact creation;
- evidence discovery;
- meaningful user input;
- verified result.

---

# 8. Communication

## 8.1 Shared channels

Channels provide human-visible multi-party collaboration.

Agents can:

- send messages;
- mention agents;
- reply in threads;
- assign/claim tasks;
- request review;
- attach artifacts;
- propose decisions;
- report blockers;
- request approvals.

## 8.2 DMs

DMs are private between explicitly authorized participants.

## 8.3 Activation

A message is not automatically an inference trigger for every channel member.

Activation occurs when one or more signals are satisfied:

```text
explicit mention
OR direct assignment
OR relevant subscription/event
OR dependency became ready
OR parent delegation
OR automation trigger
OR approval/resume event
OR explicit user request
```

Role relevance may be used as a candidate signal, but it must not wake many agents by default.

## 8.4 Human priority

Human steering has higher scheduling priority than passive agent chatter.

---

# 9. Goals, planning and tasks

A natural-language request becomes durable structure when useful:

```text
Goal
├── requirements
├── constraints
├── acceptance criteria
├── milestones
├── task DAG
├── agent assignments
├── risks
└── open questions
```

Task lifecycle:

```text
backlog
 -> ready
 -> assigned
 -> running
 -> blocked
 -> review
 -> completed

running -> failed
running -> cancelled
```

A task can survive an agent restart, replacement or reassignment.

Completion requires evidence, not merely an agent assertion.

Examples of completion evidence:

- test passed;
- expected artifact exists;
- build succeeded;
- external confirmation exists;
- user approved the result;
- independent verification succeeded.

---

# 10. Two graphs

KIN must expose two distinct graphs.

## Workforce graph

Who manages, collaborates with or delegates to whom.

## Task graph

What task depends on what.

Neither graph implicitly grants permissions.

The UI graph is always a projection of actual runtime state.

---

# 11. Memory

Memory is a governed local fabric.

## 11.1 Scopes

```text
User/Global
Workspace
Project
Team
Channel
Agent-private
Task/working
Artifact-derived
```

## 11.2 Types

```text
Semantic knowledge
Episodic experience
Procedural knowledge
Decision records
Preferences
Working state
Relationship/state metadata
Evidence / claims
```

## 11.3 Trust rules

- An agent's confidence is not evidence.
- Repetition does not create truth.
- Tool output, tests, sources and human confirmation can support claims.
- Contradictory knowledge must be represented as supersession/versioning rather than merged into one ambiguous fact.
- Private memory never becomes shared memory silently.

## 11.4 Learning from correction

The system distinguishes at least:

```text
one-off correction
persistent preference
candidate project rule
approved project rule
hard constraint
```

Only appropriate categories are promoted into durable organizational knowledge.

---

# 12. Context and long-running work

Agents do not receive all history by default.

The context is purpose-built for the current action.

### Context inputs

```text
current request
steering
agent identity / role
project state
current task
working state
relevant channel messages
validated decisions
private memory
shared memory
relevant files/artifacts
relevant tool observations
external evidence
model/tool schemas
relevant skills
```

### Context pipeline

```text
raw input
 -> classify
 -> scope-filter
 -> retrieve
 -> rank
 -> deduplicate
 -> budget
 -> compile
 -> execute
 -> persist state
```

### Long-context layers

1. progressive disclosure;
2. micro-pruning;
3. oversized tool-output spill;
4. structured compaction;
5. retrieval-based reconstruction.

Compaction must preserve operational state including objective, constraints, decisions, completed work, pending work, blockers, validated facts, artifacts and next actions.

The product does not require or expose hidden chain-of-thought.

---

# 13. Skills system

**Agent Skills are a first-class capability.**

A skill is a versioned reusable procedural package containing some combination of:

- purpose;
- trigger conditions;
- prerequisites;
- instructions;
- tool requirements;
- input/output contract;
- verification rules;
- failure/recovery rules;
- examples or test fixtures;
- version metadata;
- provenance;
- trust/policy metadata.

### Skill lifecycle

```text
discover
 -> retrieve
 -> validate compatibility
 -> load
 -> execute
 -> verify
 -> record experience
 -> improve / supersede
```

Skills may be:

- built in;
- project-local;
- workspace-local;
- imported from an external source;
- generated from repeated successful experience;
- improved by evidence-gated learning.

### Skill safety

A skill cannot silently grant permissions. Tool access remains subject to policy.

### Skill routing

The Context/Skill system should retrieve only relevant skills for a task instead of injecting the entire skills library.

---

# 14. Adaptive capability layer

The adaptive capability layer exists to make future work better without becoming a large always-running AI subsystem. It reuses the same run, memory, skill and evaluation infrastructure already required for normal execution.

## 14.1 Self-correction — always on

```text
act
 -> observe
 -> detect failure
 -> diagnose
 -> choose bounded alternative
 -> retry / repair
 -> verify
```

Rules:

- never repeat an identical failed strategy indefinitely;
- count retries against task/run budgets;
- preserve previous errors as local evidence;
- escalate when recovery requires authority the agent does not have.

## 14.2 Self-healing — always on for supported faults

```text
detect
 -> classify
 -> checkpoint if needed
 -> recover / restart / retry / requeue
 -> verify
 -> resume or quarantine
```

Self-healing covers runtime and infrastructure faults; it does not grant new permissions or silently alter product policy.

## 14.3 Experience — durable but cheap

Each meaningful run may produce a compact experience record:

```text
objective
result
strategies_used
failures
success_conditions
verification
useful_artifacts
possible_reusable_lesson
```

Experience is stored as data, not replayed into every future context.

## 14.4 Skill improvement — primary adaptation path

A repeated, useful, verifiable pattern may become or improve a Skill:

```text
experience
 -> candidate lesson
 -> candidate skill/change
 -> validation
 -> versioned skill
 -> selective future retrieval
```

Skill promotion must be evidence-gated. A single bad or ambiguous run must not automatically create a permanent rule.

## 14.5 Lightweight adaptive heuristics

The runtime may accumulate compact statistics for:

- skill success rates;
- model/provider success rates;
- tool reliability;
- delegation usefulness;
- verification yield;
- common failure classes.

These statistics can influence future selection without requiring a continuously running learning agent.

## 14.6 Self-growing workforce — controlled

The workforce may grow when the work demonstrates a recurring capability gap:

- reuse an existing agent first;
- reuse an existing Skill second;
- create a persistent specialist only when recurring value is evident;
- spawn an ephemeral worker for one-off work.

Workforce growth must remain subject to existing delegation, permissions, budget and approval rules.

### Protected boundaries

No adaptive mechanism may silently change:

- approval mode;
- permission grants;
- credentials;
- security policy;
- network allowlists;
- audit invariants;
- kill-switch behavior;
- KIN core binaries.

---

# 15. Dream-RSI as an optional research reference

Dream-RSI is not part of the normal KIN execution loop. It is retained as a research reference for a future, narrowly scoped optimization subsystem.

The useful pattern is:

```text
completed discovery histories
 -> replayable search outcomes
 -> evaluate alternative exploration policies offline
 -> deploy only a validated improvement
```

The paper describes this for structured discovery tasks such as algorithm engineering, mathematical optimization and GPU-kernel engineering. Its core idea is attractive because the historical discovery tree can provide off-policy feedback without rerunning every candidate online, but it is not evidence that the method should govern arbitrary user work.

For KIN:

- no Dream-RSI runtime in V1;
- no continuous replay of normal chat/work histories;
- no meta-agent permanently optimizing the product;
- no dependency on Dream-RSI for correctness;
- only introduce it where the search problem has measurable outcomes and replayable structure.

---

# 16. Tools

Core capabilities:

- filesystem read/search/write;
- shell/process execution;
- git;
- browser automation;
- web search/fetch where enabled;
- database access;
- document operations;
- scheduling;
- user interaction;
- MCP resources/tools;
- project-specific tools.

### Capability routing order

```text
native local capability
 -> MCP
 -> subprocess/native plugin
 -> remote API
```

Remote capabilities are optional.

---

# 17. Human control

The user can:

- steer a running agent;
- pause work;
- resume work;
- cancel work;
- reassign tasks;
- edit requirements;
- inspect context;
- inspect artifacts;
- review diffs;
- approve/reject actions;
- change agent model;
- change skill assignments;
- modify permissions;
- change autonomy mode.

Requirement changes should update affected work surgically rather than resetting unrelated completed work.

---

# 18. Artifacts and evidence

Supported artifact types include:

- task plans;
- implementation plans;
- code diffs;
- research dossiers;
- source/evidence bundles;
- browser recordings;
- walkthrough reports;
- build/test reports;
- generated documents;
- structured decision records.

Artifacts are versioned and traceable to:

```text
agent
run
project
task
conversation
source/evidence
```

A final result should point to relevant evidence whenever practical.

---

# 19. Research workflow

```text
question
 -> search
 -> collect sources
 -> extract
 -> normalize evidence
 -> check contradictions
 -> synthesize
 -> cite
 -> verify
 -> artifact
```

Evidence metadata is persisted separately from prose.

---

# 20. Coding workflow

```text
inspect
 -> plan
 -> modify
 -> test
 -> observe
 -> repair
 -> review
 -> package
```

Concurrent coding work should use workspace isolation or equivalent safe boundaries.

---

# 21. Automation

Automations are local and durable:

```text
trigger
 -> optional condition
 -> action
```

Actions may:

- create a task;
- wake an agent;
- send a message;
- run an approved workflow;
- request approval;
- execute an approved capability.

V1 prioritizes durable in-app scheduling. Host-level wake/background scheduling is an enhancement.

---

# 22. UI architecture

Primary surface:

```text
+-----------------------------------------------------------+
| Workspace / Project                         models/tools  |
+----------------+----------------------+------------------+
| Projects       | Channel / DM         | Members          |
| Channels       |                      | Tasks            |
| DMs            | Human + agent chat   | Agent presence   |
| Agents         |                      | Approvals        |
| Tasks          | Message composer     | Activity         |
| Artifacts      |                      |                  |
| Memory         |                      |                  |
+----------------+----------------------+------------------+
```

Secondary surfaces:

- workforce/swarm graph;
- task DAG;
- artifact/diff viewer;
- memory explorer;
- skill explorer;
- run/trace inspector;
- approval center;
- model/provider settings;
- tool/MCP manager;
- autonomy policy settings;
- recovery/health panel;
- usage/cost dashboard.

The interface should expose detail progressively rather than forcing users to monitor low-level logs continuously.

---

# 23. Security and trust requirements

### Core principles

- local-first by default;
- no mandatory cloud backend;
- explicit external connections;
- least privilege;
- scoped filesystem roots;
- Keyring-protected secrets;
- auditability;
- policy authority outside the agent prompt;
- untrusted content remains untrusted.

### Prompt injection boundary

Web pages, documents, tool output and external content are evidence, not authority.

No external content may:

- grant permissions;
- change approval mode;
- rewrite system policy;
- reveal protected secrets;
- bypass tool restrictions.

---

# 24. Non-functional product requirements

The application should be:

- responsive while agents stream and work concurrently;
- resilient to agent/model/tool failure;
- restart-safe;
- offline-capable for local models and local tools;
- deterministic enough to replay important runs;
- inspectable enough to explain operational decisions without exposing hidden chain-of-thought;
- efficient in token use through routing, scoped activation and context management;
- scalable in agent count according to available machine resources;
- cross-platform.

Exact performance targets are specified in the TRD and must be benchmarked on representative hardware rather than assumed from theoretical footprint numbers.

---

# 25. Product scope

## V1

- Tauri desktop shell;
- local Node/TypeScript core;
- SQLite persistence;
- default orchestrator;
- one cloud-compatible provider plus Ollama/local endpoint;
- persistent agents;
- DMs/channels;
- mentions;
- task objects;
- task DAG;
- persistent and ephemeral subagents;
- recursive delegation with limits;
- filesystem/shell/git;
- MCP;
- Context Compiler;
- tool-output spill/pruning;
- structured compaction;
- basic memory;
- three approval modes;
- artifacts;
- presence;
- pause/resume/cancel;
- local scheduler;
- coding workflow;
- baseline skill system;
- baseline runtime self-correction and self-healing.

## V1.5

- richer skill retrieval and skill marketplace/import;
- multiple cloud providers;
- browser automation;
- source-backed research pipeline;
- worktree isolation;
- richer memory retrieval;
- advanced recovery;
- swarm map;
- usage/cost analytics;
- experience extraction and validated learning;
- model routing improvements.

## V2 / Research track

- Dream-RSI-inspired meta-exploration;
- policy evolution;
- advanced self-growing team formation;
- automated skill generation and validation;
- stronger long-context virtualization;
- agent-to-agent interoperability;
- remote/distributed workers;
- enterprise organizations/departments;
- cross-device synchronization;
- marketplace/ecosystem.

---

# 26. Product acceptance criteria

A release is product-complete for the stated scope only if:

1. A new user can submit a goal without configuring a workflow.
2. The default orchestrator can answer, execute or delegate appropriately.
3. Persistent agents retain identity across runs/restarts.
4. Ephemeral agents can perform bounded jobs and return structured results.
5. Agent activation does not wake every agent in a channel.
6. Agent collaboration is human-visible where scope says it should be.
7. DMs remain isolated.
8. Task dependencies are separate from workforce relationships.
9. Context is assembled from relevant state rather than full history by default.
10. Large tool outputs can leave active context and remain recoverable.
11. Compaction preserves operational state.
12. Memory is scoped, attributable and supersedable.
13. Skills are reusable, versioned and permission-independent.
14. Self-healing can recover supported runtime faults without lowering security policy.
15. Learning changes are evidence-gated and reversible.
16. All three approval modes behave exactly as configured.
17. Agents cannot self-grant permissions.
18. Failed tasks can resume/retry without accidental duplicate external side effects.
19. Important outputs have evidence/artifact traces.
20. Local-only operation works without a cloud backend.
21. Models can change without changing agent identity.
22. The application survives restart without losing durable work state.
23. The product can inspect/replay critical runs.
24. Core state is owned by KIN rather than any optional external harness.

---

# 27. Product principles carried forward

1. Message-first.
2. Persistent coworkers.
3. Recursive but bounded workforce.
4. Visible collaboration.
5. State over raw history.
6. Context as a managed resource.
7. Local sovereignty.
8. Consequential actions are governed.
9. Few authoritative boundaries.
10. Frameworks are replaceable.
11. Evidence beats confidence.
12. Learning is staged and reversible.
13. Recovery is part of normal operation.
14. User attention is a scarce resource.

---

# 28. Reference implementation ecosystem

The following are reference sources, not mandatory dependencies:

- DeepSeek Harness / Cordis — plugin composition, agent loop, sessions, context, spill, tools, subagents.
- Google ADK — agent/workflow composition, tools, sessions/events, evaluations.
- OpenHands — coding-agent patterns and workspace/tool execution.
- LangGraph / Deep Agents — durable execution, checkpoints, subagents, context management.
- Letta — stateful agents, memory and skill-oriented workflows.
- OpenAI Agents SDK — agents, handoffs, tools, guardrails, tracing and sessions.
- MCP — standardized tool/resource interoperability.
- A2A — future cross-agent interoperability.
- AG-UI — future agent-to-frontend streaming/event patterns.
- AutoSkill — experience-driven skill self-evolution without model retraining.
- SAGE — research direction for skill-library self-improvement.
- Dream-RSI — replay-based recursive improvement of exploration policies.

---

# 29. Canonical links

- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- DeepSeek Harness Cordis tutorial: https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cordis-tutorial
- Google ADK: https://github.com/google/adk-docs
- OpenHands: https://github.com/All-Hands-AI/OpenHands
- MCP: https://modelcontextprotocol.io/
- OpenAI Agents SDK: https://developers.openai.com/api/docs/guides/agents/sdk
- Letta: https://docs.letta.com/
- LangGraph: https://langchain-ai.github.io/langgraph/
- AutoSkill: https://arxiv.org/abs/2603.01145
- SAGE / Reinforcement Learning for Self-Improving Agent with Skill Library: https://aclanthology.org/2026.acl-long.69/
- Dream-RSI: https://arxiv.org/abs/2609.14858
- Dream-RSI HTML: https://arxiv.org/html/2609.14858v1

---

# 30. Final decision ledger — what was selected from the three specifications

This section is the canonical resolution of the differences among the supplied PRD, v9 Unified PRD/TRD, and v9 Final Master Plan.

| Area | Selected final design | Reason / extracted pattern | Explicitly rejected or deferred |
|---|---|---|---|
| Desktop shell | Tauri 2 | Lightweight cross-platform desktop shell | Electron |
| Native boundary | Small Rust boundary | Host platform integration, process supervision, native security surfaces | Rust-only agent/product core |
| Agent/product core | Local Node/TypeScript modular monolith | Better fit for current JS/TS agent ecosystem and adapter reuse | Python microservice fleet; Rust-only runtime |
| Workspace hierarchy | Workspace-first | Lowest onboarding friction | Mandatory Organization→Department bureaucracy in V1 |
| Enterprise hierarchy | Optional extension | Preserves future enterprise support without polluting core UX | V1 dependency |
| Orchestrator | One Default Orchestrator per workspace | One human-facing authority, no duplicate project roots | Root Orchestrator per project |
| Orchestrator behavior | May execute simple work directly or delegate | Lowest-friction autonomy | Manager-only orchestrator |
| Persistent agents | Stable identities reusable across projects with explicit membership | Strong coworker model + scope safety | Project-only identity semantics |
| Ephemeral workers | Yes, bounded | Efficient for narrow jobs | Long-lived temporary sprawl |
| Delegation | Recursive + bounded | Strong autonomy with budget/permission controls | Unlimited recursion |
| Graphs | Workforce graph + task DAG | Clean separation of social hierarchy and execution dependencies | Single graph for everything |
| Activation | Mention/assignment/dependency/subscription/delegation/event based | Prevents unnecessary model calls | Wake every channel member |
| Role relevance | Selection hint, not default wake trigger | Useful routing without token explosion | Automatic execution by semantic role match |
| Memory | Multi-scope local fabric | Combines strict isolation with richer memory types | Flat global memory |
| Context | Context Compiler + progressive disclosure + spill + compaction + retrieval | Best token efficiency/reliability balance | Full-history injection |
| Skills | First-class versioned capability objects | High leverage, selective context loading | Treating skills as always-on prompt text |
| Learning | Experience→validated skill/memory improvement | Reuse existing infrastructure | Continuous RL during ordinary work |
| Self-correction | Normal task loop | Cheap and directly useful | Separate correction meta-agent |
| Self-healing | Runtime recovery manager | Reliability without large model overhead | Always-on autonomous system doctor |
| Workforce growth | Need-driven, reuse-first | Avoid unnecessary agents | Continuous self-expansion |
| Dream-RSI | Research track only | Potentially powerful for structured discovery | Core V1 subsystem |
| Approval model | Auto / Always Ask / Full Access | Explicit user agency with low-friction default | Single fixed approval policy |
| Auto approval | Auto-approve safe reversible actions | Best default UX | Blanket automatic side effects |
| Full Access | No prompts within granted permissions | Power-user autonomy | Permission bypass |
| State | SQLite + filesystem + event journal | Durable local state and auditability | Full CQRS/event sourcing |
| Frameworks | Adapters/references | Avoid duplicated authority | Making any external framework the product core |
| Tool boundary | Native → MCP → plugin/subprocess → remote | Local-first and extensible | Provider-specific bespoke tool stacks |
| Models | Provider-neutral gateway | Local + BYOK flexibility | Model-specific domain architecture |
| Verification | Evidence/artifact based | Prevents “AI said it is done” | Trust by model confidence |

The resulting product is intentionally **simpler internally than the sum of its reference systems**. Complexity is earned only when it improves user-visible autonomy, reliability, security or efficiency.

---

# 30. Final product statement

> **KIN is a local-first autonomous AI workforce platform: one human-facing orchestrator, persistent coworkers, temporary specialists, visible collaboration, durable work state, managed context, governed tools, adaptive skills, verified execution, and system-level recovery — with the ability to improve its reusable capabilities over time without silently weakening user control.**

---

# 31. V12 Capability Evolution — Governed Computer Use & Timed Autonomy

### 31.1 In-App Scheduler & Timed Autonomy
- **Antigravity-Style Scheduler:** Agents can wake themselves using non-blocking timers (`schedule` / `timer`) rather than busy-polling on GPU/CPU.
- **Modes:** One-shot timers (`DurationSeconds`, `TimerCondition`, `Prompt`) and recurring cron schedules (`CronExpression`, `Prompt`, `MaxIterations`).
- **Persistence:** Stored in durable SQLite `schedules` table with WAL mode.
- **Trigger Behavior:** When a timer fires, the scheduler broadcasts a high-priority system wakeup into the project channel/inbox.

### 31.2 Autonomous Multi-Turn ReAct Tool Loop
- **Multi-Turn Bounded Execution:** Agents iteratively call tools (`readFile`, `writeFile`, `listDirectory`, `executeShell`, `schedule`, `mcp`), observe outputs, and self-correct errors up to a maximum turn budget.
- **Policy Enforcement:** All tool invocations remain governed by the Policy Engine (Auto, Always Ask, Full Access).

### 31.3 Runtime Skills Engine & MCP Integration
- **Dynamic Skills:** First-class procedural packages dynamically matched by domain/trigger patterns and injected into context.
- **Durable Experience:** Successful executions and error repairs are stored in `skill_experiences`.
- **MCP Protocol:** Native JSON-RPC client connecting to external stdio/SSE MCP servers, auto-discovering capabilities.

### 31.4 Governed Computer & Application Use
- **Desktop & App Control:** Discovery and control of installed desktop applications (VS Code, Android Studio, WhatsApp, browsers).
- **Physical Interaction Cycle:** Strict Observe → Act → Observe → Verify → Continue loop.
- **Human Takeover Overlay:** Ubiquitous floating takeover banner allowing the user to press `ESC` or click to pause the agent, interact manually (e.g. solve CAPTCHA/MFA), and click `Resume Agent`.
- **Persistent Headful Browser Sessions:** Dedicated browser profiles preserving cookies, logins, and session storage.
- **Financial Safety Shield:** Financial transactions and checkout actions are hardcoded to `CRITICAL RISK` requiring explicit user approval. Payment credentials are never exposed to LLM context.
- **Proactive Personal Routines:** Natural language routines ("Every morning review calendar...", "Watch this repository...") translated into scheduled tasks with triggers, conditions, and autonomous delegation.

---

# 32. Enterprise Resilience, Crash Recovery & Collaborative Autonomy

### 32.1 Turn-by-Turn Checkpointing & Crash Recovery
- **Granular Checkpointing:** Every turn of execution within `agent_loop.ts` persists an immutable turn checkpoint (`onTurnCheckpoint`) containing model messages, tool invocation arguments, tool execution results, and updated token usage to SQLite `agent_runs.checkpoint_data`.
- **Interrupted Run Detection:** Upon daemon initialization or supervisor self-healing sweeps, the system inspects active runs for abandoned heartbeats (`recoverStaleRunsDetailed()`). Stale executions transition to interrupted states and are staged in `pendingRecoveries`.
- **Docked Recovery Surface:** A dedicated UI banner surfaces interrupted agent operations with one-click actions:
  - `Resume All`: Resumes all interrupted runs from their exact last recorded checkpoint turn.
  - `Discard`: Acknowledges and dismisses the interrupted sessions without re-running.
  - Per-Run Actions: Granular controls to resume individual runs or route them to local fallback models (e.g., Ollama).
- **Context Preservation Invariant:** Restores full conversation context, tool state history, and execution parameters, avoiding duplicate tool invocations and wasted model inference.

### 32.2 HTTP 429 Quota Guard & Quota-Paused Run State
- **Proactive Quota Handling:** Runtime intercepts HTTP 429 and `RESOURCE_EXHAUSTED` responses from LLM providers (Anthropic, OpenAI, Gemini).
- **Non-Destructive Pause:** Rather than failing the task, runs transition to `RunState = 'quota_paused'` with `quotaResetsAt` computed from HTTP `Retry-After` headers or intelligent exponential backoff.
- **Automated Resume Timer:** A docked Quota Pause Banner presents a live countdown timer until quota reset, an instant `Resume Now` override, and a `Switch to Ollama` one-click fallback for offline/local execution.

### 32.3 Atomic Distributed Task Leases
- **Distributed Concurrency Control:** Extends the `tasks` schema with `claimed_by_run_id`, `lease_expires_at`, and `retry_count`.
- **Atomic Lease Claims:** Atomic SQL operations (`claimTaskWithLease`) ensure that a task can only be claimed by a single agent run, preventing duplicate execution and race conditions during high-concurrency swarm operations.
- **Lease Renewal & Heartbeats:** Active runs periodically renew their task lease (`renewTaskLease`).
- **Abandoned Lease Reclamation:** If a worker process terminates abnormally, expired task leases are automatically reclaimed (`reclaimExpiredTaskLeases`), resetting task status to `pending` and incrementing `retry_count` subject to max retry thresholds.

### 32.4 Strategic Goal Ancestry & Objective Anchor
- **Root-to-Leaf Alignment:** Deep recursive delegation chains propagate ancestral goal trees (`GoalAncestryChain`) down to leaf agents.
- **Context Injection:** Injected directly into agent prompt context via `context_compiler.ts` under `### STRATEGIC GOAL ANCESTRY & OBJECTIVE ANCHOR:`.
- **Goal Drift Prevention:** Ensures that sub-delegated agents maintain full awareness of parent objectives, constraints, and success criteria even in complex multi-tier delegations.

### 32.5 Coalesced Wakeup Queue & Concurrency Governor
- **Debounced Windowing:** The `WakeupQueue` batches burst notifications and dependency triggers across agents within a configurable 1000ms coalescing window.
- **Resource Governor:** Prior to dispatching agent runs, the queue queries host-level system metrics (free memory, CPU headroom). Dispatches are throttled or deferred if system resources are constrained.
- **Storm Prevention:** Prevents catastrophic cascading awakenings and memory exhaustion when multi-agent teams broadcast messages simultaneously.

### 32.6 Extended Slash Command Suite (`/btw` & `/grill-me`)
- **`/btw <query>` (Side Queries):** Allows users to ask ephemeral side questions directly to the orchestrator or agent without polluting project history, task DAGs, or persistent channel context. Output is styled with an ephemeral badge (`💡 [Side Query / BTW]`).
- **`/grill-me [topic]` (Interactive Architectural Scrutiny):**
  - Triggers an adversarial architectural review mode where the orchestrator interrogates the user's design choices.
  - Generates structured multiple-choice grilling questions rendered in an interactive `GrillMeCard` UI.
  - Synthesizes user responses into a hardened Architectural Decision Record (ADR) stored in SQLite and linked to project artifacts.

### 32.7 Formal Agent Evaluations
- **Benchmark Rubrics:** Quantitative evaluation framework assessing agent outputs across multiple core dimensions:
  - *Reasoning Depth & Logic*
  - *Context Grounding & Factuality*
  - *Tool & Policy Compliance*
  - *Execution Efficiency & Latency*
- **Persistence & Telemetry:** Evaluation runs and scores are recorded in the SQLite `agent_evaluations` table with test case inputs, expected outputs, execution latencies, and normalized scores (0-100%).
- **Interactive Inspector UI:** Dedicated `Evals` subtab in the Agent Inspector showing benchmark radar/score meters, historical performance trends, and an interactive `Run Benchmark Eval` trigger.

### 32.8 Managed Credentials & Bring-Your-Own-Key (BYOK)
- **Centralized Credential Vault:** Secure storage for provider API keys and external service credentials in `managed_credentials` table.
- **Granular Scoping:** Keys are bound to specific provider types (`gemini`, `openai`, `anthropic`, `ollama`), rate limits, and token budgets.
- **Usage Metering:** Real-time tracking of token expenditures and request counts per credential.
- **Inspector Management UI:** Integrated `BYOK` subtab in the Agent Inspector for adding, inspecting, rotating, and revoking provider credentials with masked display and active usage statistics.


