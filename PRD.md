# KIN Product Requirements

**Status:** Canonical pre-build product specification  
**Product:** KIN  
**Release direction:** Full product vision, delivered in gated phases  
**Primary platform:** Windows desktop, using Tauri 2  
**Implementation status:** No KIN application source exists in this repository yet. This document specifies intended behavior; it is not evidence of implementation.

## 1. Product vision

KIN is a local-first workspace where a person can open a project folder, enter a channel or direct message, describe what they want in ordinary language, and rely on a capable AI coworker team to understand, plan, coordinate, and do the work. KIN should feel approachable to students, researchers, developers, technical and nontechnical professionals, while exposing deeper controls when they are useful.

KIN keeps project state and runtime infrastructure on the user's device. It supports local models and explicitly configured external model providers. Remote inference and external services are opt-in data destinations: before content leaves the device, the product must identify the destination and the relevant data class. KIN must never silently change to a remote provider or another model after a failure.

The harness is a core product capability. It owns context selection, multi-agent routing, provider/model capabilities, tool authorization, memory boundaries, durable execution, approval pauses, results, observability, and recovery. A model response alone is not a completed task.

## 2. Product principles

1. **Message first:** The everyday path starts with a simple message. Setup and advanced controls do not obstruct the first useful interaction.
2. **Progressive control:** Simple users can delegate naturally; experienced users can inspect and edit models, agents, tools, permissions, plans, context, workspaces, and schedules.
3. **Local by default:** Project files, messages, memories, configuration, activity records, and artifacts persist on-device. No hosted account, sync service, control plane, or telemetry is required.
4. **Explicit boundaries:** Project, channel, agent-private, and DM context have different access rules. Model/provider egress and OS process isolation are separate controls.
5. **Useful autonomy with recourse:** Agents can act within grants and workspace policy. Consequential actions pause for a specific approval. Cancellation, recovery, and review remain available.
6. **Honest results:** Distinguish a claimed result from evidence, a configured check, or human acceptance. Never claim a check passed when it did not run.
7. **Visible work without transcript noise:** Chat shows messages, replies, and completed results. Swarm Map and run inspection show operational activity.

## 3. Users and primary outcomes

KIN serves:

- People who want research, writing, planning, learning, and administrative work done through plain-language requests.
- Researchers and students who need grounded information gathering, citations/artifacts, and reproducible working context.
- Developers who need code exploration, editing, terminal use, worktrees, diffs, and review.
- Technical operators who configure providers, models, tools, MCP servers, connectors, capabilities, policies, and schedules.

Success means a new user can select a folder, send a useful request, understand who is handling it, review the result, and see the relevant operational detail without learning an agent framework first. A power user can configure specialist coworkers and inspect or constrain every material capability.

## 4. Core concepts and organization

```text
KIN on-device workspace
├── Projects (each bound to one selected local folder)
│   ├── #general (created with @boss)
│   ├── Additional channels (each starts with @boss)
│   ├── Human-agent and agent-agent DMs
│   ├── Meeting channels and threads
│   ├── Project-scoped agents and hierarchy
│   ├── Goals, tasks, artifacts, skills, memories, automations
│   └── Isolated run workspaces and reviewable changes
├── Local model/provider connections
└── Local app settings and secure credential references
```

- A **project** is the isolation boundary for agents, files, channels, DMs, memory, tools, artifacts, schedules, and run state. The selected folder is the project's working tree; KIN metadata is stored under KIN app data.
- A **channel** is a project-scoped collaboration space. Members can access its messages and channel memory. One channel is marked as the default/general channel.
- A **human** is the local operator.
- An **agent** is a project-scoped coworker with editable identity, role, instructions, model, capabilities, hierarchy, and channel memberships. An agent can belong to multiple channels in one project. Membership adds the channel memories and messages admitted to that agent's context; it never grants access to another project.
- **@boss** is the default lead orchestrator for a project and the initial participant of every channel. It can respond directly, do permitted work, route to existing coworkers, or ask before hiring when no current coworker fits. Boss may itself be assigned/configured per project; it cannot cross project boundaries.
- **A DM** is a private conversation with the human or between two project agents. Human-agent DMs are visible only to their participants. Agent-agent DMs are hidden from other agents; the local human operator can inspect them for transparency. DM memory is scoped to its exact participants and conversation.
- **A thread** holds replies to a source message. Agent replies to channel messages appear in a collapsible thread under that message.
- **A run** is a durable attempt to fulfill an intent. It can involve multiple agent steps and tools and move through queued, active, waiting, pause-requested, paused, or terminal states.
- **Swarm Map** is the detailed activity surface for agent hierarchy, membership, delegations, run states, tools, waits, recovery, and event history.

## 5. First-use and daily workflows

### 5.1 Start a project

1. User chooses or opens a local folder.
2. KIN explains the project boundary and current autonomy/egress defaults in plain language.
3. KIN creates project metadata in app data, creates `#general`, and installs the project's `@boss` identity.
4. User can send a local-only request immediately. Provider configuration is requested only when needed.
5. KIN detects a configured local Ollama endpoint and other supported local model endpoints, lists available models and their declared capabilities, and explains unavailable capabilities.

### 5.2 Send an intent

1. The user sends an ordinary message in a channel or DM. In channels they may name an agent, role, or `@all`, or omit mentions. A human-agent DM is addressed only to its one agent; it never implicitly fans out to channel members. An agent-agent DM is visible only to its two agent participants and the human operator.
2. For an unmentioned channel message, KIN evaluates the message against current channel membership, agent roles/instructions/capabilities, existing work, and requested action. It may choose one, two, or several relevant agents. Boss is the routing fallback and can also answer directly.
3. If intent, target, authority, or consequential effect is unclear, the responsible agent asks a focused question or requests approval before acting.
4. If no existing coworker fits, Boss can handle work within its capability; before adding a coworker, it asks the human to approve hiring and the proposed role/grants.
5. The selected agent(s) work under one durable run identity. Multi-agent replies are queued sequentially in the source message's thread when a request calls for multiple public responses. Agents can coordinate privately through inspectable agent-agent DMs.
6. Chat receives a user-facing message/result. Detailed routing, tool, wait, and recovery events are recorded in Swarm Map, not inserted into chat.

### 5.3 Review and continue work

Users can inspect run results, evidence, artifacts, source references, changes, approvals, and unresolved work; steer, pause, resume, or cancel a run; freeze/unfreeze a project; continue a prior conversation; edit agent contracts; review diffs; accept/reject changes; and resume recoverable runs after restart. Pause stops new dispatch immediately and reaches `paused` only after in-flight work has safely settled or been reconciled. It cannot undo completed effects. Resume revalidates current policy, grants, consent, credentials, approval expiry and arguments, target, and workspace before dispatch. Cancel is distinct and best-effort; uncertain external outcomes remain explicit. While a project is frozen, the transcript retains only the original authored messages; a project freeze banner and held-items panel outside the transcript provide an explicit per-message **Run after unfreeze** action. Unfreezing alone never dispatches held messages or resumes paused runs.

### 5.4 Switch projects while work is active

Switching the selected project changes the UI's active project only. It does not pause, cancel, approve, or retarget runs in the previous project. Those runs remain attached to their original project, workspace, agent memberships, provider/model selection, and budget identity; their results and activity remain attached to that project. Before every next model/tool/delegation dispatch, and after resume/restart, KIN rechecks current project policy, agent status/membership, grants, egress consent, credential availability, approval freshness, and target scope. Revoked or narrowed authority pauses/blocks the affected step; permissions added later do not expand an existing run without explicit user authorization. Project switching itself does not change authority. The user can inspect a redacted cross-project active-run list, but must open the matching project to inspect its full details or act on its runs. Notifications identify the project and run without exposing private message or tool payloads. Cancellation and pause are explicit, project/run-scoped actions. The global runtime applies bounded, fair scheduling across project queues and never shares agent context, memory, files, browser profiles, or approvals across projects. App shutdown behavior is separate and must state whether an explicitly enabled tray runtime continues execution or active runs are checkpointed/stopped for recovery.

## 6. Collaboration and routing requirements

- Exact agent mention (for example `@Backend`) activates that agent only if it is a member of the current channel, subject to capability and project policy. All directly selected agents, including those inferred from natural-language assignments, must be channel members. A project agent outside the channel cannot be activated directly; Boss explains and offers the ordinary channel-staffing flow. The narrow exception is explicit agent-to-agent delegation: a delegated non-member receives only the explicit minimum task handoff and authorized sources, never channel history/memory or membership by implication; ask the human to add them when broader context is required.
- Role mention activates the matching agents in the current channel. If none are members, Boss explains this and offers staffing choices.
- `@all` explicitly queues every current channel agent. Agents respond sequentially in a shared thread unless the human asks for independent threads/results.
- Explicit `@agent`, role, and `@all` selectors combine as a deduplicated union; `@all` resolves to all channel members. Explicit selectors are authoritative and relevance scoring cannot silently add recipients. Names and roles in ordinary prose are not mention tokens. With no explicit selectors, clear natural-language assignments can address multiple agents (for example, “Backend update this schema and ask Security to review it”); a topic reference alone does not target an agent. If a message addresses `@Backend` and instructs it to ask QA for review, activate Backend first; QA joins only through a visible, recorded Backend delegation subject to grants and policy. Merely mentioning QA as a topic does not delegate work. An explicitly addressed agent can coordinate or delegate when the request calls for it and its grants allow it.
- Routing is intent-first: interpret the whole message, its audience, and conversation context, including multiple outcomes, constraints, negation, and corrections. Handle any natural-language intent and mixed form; examples include questions, explanations, research, creation, edits, reviews, planning, conversation, and follow-up. Never route from a greeting token, keywords, or message style alone. A greeting prefix must not suppress a task (for example, “Hi, have Backend design this schema and Security review it?” selects both specialists). Questions and polite phrasing do not by themselves authorize changes. For an unmentioned reply in an active thread, keep the current agent only when the full new intent continues that thread; a topic change triggers fresh routing.
- If the complete meaning is only a greeting, with no task, special recipient, or broader participation request, one brief reply comes from Boss and no specialists are woken. “Everyone introduce yourselves” or another explicit whole-team participation request queues the channel team sequentially; merely saying “hi team” does not mean `@all`.
- Other unmentioned messages use semantic relevance routing to select the smallest useful set of one or more channel agents based on intent, audience, domain, skills, channel membership, capability fit, existing work, and availability. KIN must not wake every member by default or invoke every agent just to ask if it is relevant. If the intended outcome or audience remains unclear after considering available context, Boss asks a focused question instead of guessing or broadcasting. Routing confidence is not proof of authorization.
- A message asking for introductions, a roundtable, or participation from several people may deliberately select several agents and queue responses in an orderly sequence.
- For a request with distinct subtasks, assign each part to the relevant agent(s), then serialize public replies in one source thread. Boss coordinates or synthesizes without duplicating specialist replies unless asked.
- When multiple specialists are selected for a task, they respond sequentially in one thread. Boss coordinates and avoids duplicating their replies unless the user asks for a summary or its own contribution.
- Agents can spawn bounded subagents under their own hierarchy. Subagents inherit the parent's model unless explicitly changed; they do not inherit broader permissions, private memory, or project/channel membership.
- Dynamic hiring must display proposed name, role, instructions, domain authority, model, channel memberships, and capability grants before activation. Existing project agents should be reused when they fit.
- New channels begin with Boss. Staffing can add existing project coworkers or request a new specialist.
- Autonomous meetings create a dedicated channel with an agenda, invited project members, recorded decisions, and a human-visible summary.
- Human messages and steering have priority over queued agent work. The queue supports ordered delivery, interruption, deduplication, backpressure, cancellation, and restart recovery.
- A DM agent may answer within that DM. Sharing DM content or context with another agent requires explicit human approval and a disclosed, minimal handoff summary. To expand a conversation, use a separate group channel/meeting; never silently copy DM history into it.
- Human-agent DMs activate only the addressed agent; agent-agent DMs activate only their two participants. DM content never triggers channel role routing or `@all` implicitly.

## 7. Conversation, activity, and artifacts

### Chat transcript contract

Channel and DM timelines show only human/agent messages, replies, and completed user-facing results. Do not render tool-call cards, raw tool output, internal routing/scoring, approval state-machine events, run-state timelines, private reasoning, or generic “thinking” updates as transcript messages. Clarifying questions are messages; approval requests are shown in the approval surface/Swarm Map and never inserted into the transcript. Agent responses for a channel message live in its thread. Summaries, deliverables, and user-relevant artifacts may be linked from a result.

### Swarm Map contract

For every agent/run, show hierarchy, project/channel membership, delegation links, current task, selected provider/model, activity phase, elapsed time, named tool and target where relevant, wait/approval state, result/artifact references, and replayable event history. States include idle, planning, thinking, working, executing a named tool, waiting, pause requested, paused, blocked, recovering, completed, failed, and cancelled. “Thinking” is only a phase label: never display hidden chain-of-thought or fabricate progress. Redact secrets and sensitive values. Provide an accessible tree/list alternative to the graph and equivalent inspection controls.

### Artifacts

Artifacts include documents, research notes with source references, generated files, images, task plans, and code changes. Artifacts are stored locally, linked to their producing run, and versioned or hash-addressed as appropriate. Large tool output is spilled to project/app storage with size limits, a compact preview, digest, and bounded retrieval controls.

## 8. Models and providers

- Support Ollama and compatible local endpoints with model detection, availability, context length when known, streaming, and model-specific tool-calling capability.
- Support OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, and custom OpenAI-compatible endpoints. Provider-specific reasoning/effort, streaming, multimodal, tool-call, and structured-output capabilities must be represented accurately and refreshed/updated without silently changing a user's selection. Custom-compatible connections are distinct by exact endpoint/account and auth profile; support multiple profiles even when they share the OpenAI-compatible protocol. Do not infer feature parity from protocol compatibility.
- Users may configure multiple providers and choose a provider/model per agent. Child agents inherit model selection only; permissions/context are independently calculated.
- Local inference works with the network disconnected when the selected local model is available. Unsupported tool calling must be reported clearly; do not silently send the task to a cloud provider.
- External inference is disabled until a provider is configured and the user enables egress. Before first transmission of project content, show the provider, data that will leave the device, and relevant policy controls. Consent is scoped to provider/account, project, data classification, agent, and selected model; it is revocable. A global “cloud enabled” setting never authorizes private memory or DM content automatically. Web search sends only the query by default; attaching project/DM context requires separate disclosure and consent. Log a redacted egress record locally.
- API keys and tokens are stored once in app-level provider connection profiles via Windows-backed secure storage. Multiple named accounts and compatible endpoints are supported. Projects keep only opaque profile references; the same valid profile can be selected in another project without re-entering the key. Each project still requires its own explicit provider binding, agent grants, and scoped egress consent. A saved key alone never enables cloud use or private-memory/DM egress. Ask the user to reauthorize only if the secure-store entry is absent, revoked, invalid, or unavailable after restore/device migration. Never put secrets in prompts, chat, artifacts, logs, project backups, exports, event history, or tool outputs.
- Rate limits, outages, invalid credentials, context limits, model removal, and partial streams produce explicit recoverable states. Retry only when safe and idempotent; never auto-switch model/provider.

## 9. Memory and context

KIN implements four distinct visibility tiers:

1. **Project shared memory:** Facts, goals, decisions, standards, and project notes available to authorized project agents.
2. **Channel memory:** Department/channel facts available only to members of that channel. An agent's admitted channel context expands to every channel it belongs to.
3. **Agent-private memory:** A coworker's personal notes accessible only to that agent, with operator inspection/edit controls clearly identified.
4. **DM memory:** Context accessible only to the participants in that exact DM; separate conversations do not share memory by default.

Memory is versioned, attributable, inspectable, editable, deletable, and scoped. Promote information between scopes only through an explicit user action or a disclosed, reviewable agent proposal. Context assembly declares its source scopes, freshness, truncation, trust classification, and egress destination. Long conversations use structured compaction that preserves decisions, changed files, unresolved work, and references to original events. Compaction must not widen access or silently alter the selected provider/model.

## 10. Harness capabilities

The complete harness lifecycle is normative in `docs/HARNESS_BLUEPRINT.md`, with the V1 operation catalog and lifecycle contract in `docs/RUNTIME_CAPABILITY_CONTRACTS.md`. Product capabilities include:

- Message intake, intent classification, mention/role/broadcast routing, queueing, deduplication, clarification and hiring prompts.
- Editable agent contracts and hierarchy; plan proposals and steering; discoverable slash commands; scoped context manifests; model/provider capability negotiation and streaming.
- Tool registry, skills, connectors, plugins, MCP, web search and URL fetch, browser, desktop automation, terminal, filesystem, Git/worktrees, artifacts, schedules and task DAGs.
- Central policy gateway; exact-scope approvals; cancellation; atomic shared resource/token/time/call budgets; bounded output; retries/idempotency; event history; crash recovery and resume.
- Human takeover for browser authentication/CAPTCHA and other supported handoff cases. The automation pauses while the human controls that profile and resumes only after explicit handback.
- Self-authoring skills with version history, review, rollback, and optional benchmark scenarios; candidate skills never silently replace active versions.
- Goals and dependency graphs can express acceptance criteria and configured checks. KIN does not assume every general-purpose task is mechanically verifiable; completion comes from configured evidence or explicit human acceptance.

## 11. Workspaces and code review

- For Git projects, code-changing runs use an isolated Git worktree. For non-Git folders, use an isolated shadow workspace with an explicit patch/apply journal.
- Never let concurrent runs write into the same working tree. If isolation cannot be created or verified, stop before mutation and explain recovery options; never fall back to shared-root writes.
- Diffs are attributed to run, agent, and file and support inspect, stage/unstage, revert, conflict reporting, three-way apply, commit, and automated review proposal. Application back to the project root is explicit and journaled. Git worktrees are concurrency isolation, not by themselves a security sandbox.
- The human has a dedicated terminal and Monaco-based editor. Human terminal actions are distinct from agent tool authority and are never attributed to an agent.

## 12. Autonomy, privacy, and safety

Projects default to **SAFE** autonomy and local-only egress.

- **SAFE:** Exploration is read-only. File writes, shell execution, browser/desktop actions, and external effects require an exact human approval.
- **AUTO:** Low/medium-risk reversible actions may run automatically inside the granted project boundary. High-risk, destructive, credential, financial, or external side effects pause for approval.
- **FULL_ACCESS:** Trusted workflows run autonomously only within explicit capability grants; financial actions and critical/destructive operations retain safeguards and cannot be unlocked by a vague global bypass.

Approval binds to exact action, target, normalized arguments, run/step, project, grant, and expiry. Any material argument, identity, policy, or target change invalidates the approval. The UI offers per-run pause/resume/cancel and project freeze/unfreeze plus stop-all, with the safe-point semantics defined in `docs/HARNESS_BLUEPRINT.md`; these controls never imply rollback. The local append-only event ledger is hash-chained and tamper-evident, not immutable against the device owner. Local app data is not KIN-level encrypted; credentials use OS-backed secure storage. See `docs/SECURITY_AND_PRIVACY.md` for threat boundaries and controls.

User messages, memory, artifacts, and project data persist locally until the user deletes them or changes a retention setting. Deletion must target active payloads, indexes, summaries, spill/artifact/workspace copies, selected browser profiles and cached previews; incomplete cleanup is reported by category. A content-free tombstone may remain for ledger integrity. Backups may retain deleted content until deleted/expired, and restoring an older snapshot must warn that it may reintroduce deleted data. Provider-side retention is outside KIN's control.

## 13. Goals, tasks, and automation

- Goals may be decomposed into dependency graphs, assigned agents, acceptance criteria, and optional configured checks. Atomic task leases prevent duplicate agent claims and expire/recover after process failure.
- Agents can submit plan adjustments. User approval is requested when changes alter goal scope, risk, external effect, budget, or permission.
- User/agent-authorized one-shot and recurring schedules persist across restarts through an opt-in local tray worker while the user is logged in and device is awake. Every schedule stores its chosen Windows time zone; recurring schedules accept standard five-field cron syntax. Show next occurrences before save. A wall-clock time skipped by a DST transition is marked skipped; an ambiguous repeated time runs once at its first occurrence. Missed one-shots execute once marked late; missed recurring work coalesces to one catch-up run. At every wake, revalidate creator/target enabled status, current project policy, agent grants, policy epoch, pinned provider/model and scoped egress consent. Effective authority is the intersection of the schedule's creation-time grant/consent snapshot and current permissions; revoked or unavailable authority blocks the run for review, and newly added permissions require explicit schedule edit/approval.
- Automations dashboard supports inspect, pause, resume, run-now, edit, delete, history, next-run display, and failure recovery. Never promise execution while the device is off or user is logged out.

## 14. Quality requirements

- Windows-first production packaging, signing/update/rollback strategy, graceful shutdown, startup recovery, backup/restore, and useful diagnostics.
- Project and channel isolation is enforced at context build and every tool dispatch, not merely in UI filtering.
- App remains responsive during model streaming, tool execution, large output, schedule wakeups, and graph rendering. Work queues are bounded and cancellation propagates to provider streams and child processes.
- Accessibility: keyboard navigation, screen-reader labels, reduced motion, sufficient contrast, focus-safe approval dialogs, and graph/list parity.
- Offline core use: project browsing, local data, memory, local configured model and local-only tools remain available offline; network-dependent features show explicit unavailable state.
- Resource use, latency and reliability targets are set against a documented Windows reference machine and measured with model/provider latency separated from KIN overhead. No performance claim is accepted without recorded evidence.

## 15. Product acceptance scenarios

The manual end-to-end scenarios and required evidence are in `docs/MANUAL_VALIDATION_AND_RELEASE_GATES.md`. Release cannot be called production-ready until a human operator has verified: project setup; local offline model use; each configured provider path; multi-agent relevance routing and ordered responses; DM/private-memory isolation; approvals and cancellation; tool and MCP boundaries; worktree/shadow isolation and diff apply; durable state after restart; compaction/spill recovery; schedules; Swarm Map history; backup/restore; and accessibility/error handling.

## 16. Out of scope for the local-first core

No hosted control plane, mandatory account, cloud-synced project store, mandatory telemetry, remote worker fleet, or hidden provider proxy is required. A future optional sync/hosted service must be a separately reviewed feature and must not weaken local project isolation or silently export project data.

## 17. Source precedence

1. The user's stated KIN vision and explicit decisions in this conversation.
2. This canonical PRD and the linked current technical/security/harness documents as a consistent set.
3. The root PRD snapshot and `KIN-docs-v23.01.zip` as research inputs, with individual decisions recorded in `docs/BUILD_AND_REUSE_DECISIONS.md`.
4. External frameworks and repositories as patterns or reviewed components only.

The input archive's internal precedence statement does not override the user's requirements. All source inputs remain preserved; their status and reuse decisions are documented rather than silently discarded.
