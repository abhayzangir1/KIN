# KIN Tools, Extensions & Agent Templates Specification

**Document ID:** `KIN-TLS-10.0-PROD`  
**System Name:** KIN — Sovereign Local-First Autonomous Multi-Agent AI Workforce & Harness  
**Version:** `10.0.0-PRODUCTION`  
**Status:** Canonical 28 Built-In Tools, MCP Integration, Skills & Agent Persona System  

---

## 1. The Canonical 28 Built-In Tool Suite

KIN equips agents with a rigorously bounded, deterministic suite of 28 built-in tools organized across 6 functional domains:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CANONICAL 28 BUILT-IN TOOLS                           │
├──────────────────┬──────────────────┬──────────────────┬────────────────────┤
│ 1. Filesystem    │ 2. Shell & PTY   │ 3. Web & Browser │ 4. Memory          │
│ • fs_read        │ • shell_exec     │ • web_search     │ • memory_write     │
│ • fs_write       │ • pty_open       │ • web_fetch      │ • memory_query     │
│ • fs_patch       │ • pty_write      │ • browser_act    │ • memory_delete    │
│ • fs_list        │ • pty_read_ring  │ • browser_shot   │                    │
│ • fs_search      │ • pty_kill       │ • browser_close  │                    │
│ • fs_delete      │                  │                  │                    │
├──────────────────┴──────────────────┴──────────────────┴────────────────────┤
│ 5. Workforce & Task Orchestration                                           │
│ • agent_hire     • agent_delegate   • agent_map_reduce • task_mutate        │
│ • goal_mutate    • channel_post     • dm_send          • meeting_start      │
│ • meeting_conclude                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Filesystem Operations
1. `fs_read(file_path: string, start_line?: number, end_line?: number)`: Reads text from a file within the worktree lane. Supports line-range slicing for reading large source files and inspecting spilled output blobs.
2. `fs_write(file_path: string, content: string)`: Creates a new file or completely replaces the contents of an existing file inside the worktree lane.
3. `fs_patch(file_path: string, search_block: string, replace_block: string)`: Performs precision modifications using the 4-tier cascading engine (Exact → Whitespace-Normalized → Indentation-Agnostic → AST-Anchored).
4. `fs_list(dir_path: string, recursive?: boolean)`: Lists directory contents, file sizes, and directory structures up to a bounded depth.
5. `fs_search(pattern: string, dir_path?: string, file_glob?: string)`: High-speed regex and literal code search across files in the lane using the `ignore` crate.
6. `fs_delete(file_path: string)`: Deletes a file within the worktree lane. Policy-gated under `AUTO` mode.

### 1.2 Shell Execution & Interactive PTYs
7. `shell_exec(command: string, timeout_ms?: number)`: Runs a non-interactive shell command inside the sandboxed lane. Spills outputs exceeding 2,000 tokens to disk.
8. `pty_open(command: string, initial_args?: string[])`: Spawns an interactive pseudo-terminal session inside the lane with persistent TTY state.
9. `pty_write(pty_id: string, input: string)`: Sends keystrokes, commands, or interactive replies to an open PTY session.
10. `pty_read_ring(pty_id: string, max_lines?: number)`: Reads recent unread lines from the in-memory circular ring buffer of the active PTY.
11. `pty_kill(pty_id: string)`: Sends SIGTERM / SIGKILL to terminate an active pseudo-terminal session cleanly.

### 1.3 Web Access & Headless Browser Automation
12. `web_search(query: string, num_results?: number)`: Queries search engines to return relevant URLs, titles, and snippets for engineering and research tasks. Taints the active run.
13. `web_fetch(url: string)`: Downloads and parses web pages into clean, readable Markdown text. Filtered by the SSRF DNS firewall. Taints the active run.
14. `browser_act(action: "navigate"|"click"|"fill"|"evaluate", selector?: string, value?: string)`: Controls the dedicated Chrome CDP browser instance. Suspends with `WaitingTakeover` if auth or CAPTCHA is detected.
15. `browser_screenshot()`: Captures a PNG screenshot of the current browser viewport. Compressed and saved into `blobs/`.
16. `browser_close()`: Closes the active browser instance and cleans up ephemeral resources while preserving agent cookie profiles.

### 1.4 Cognitive Memory Subsystem
17. `memory_write(tier: "T1"|"T2"|"T3"|"T4", bank: "world"|"experience"|"opinion"|"procedure", subject_key: string, claim_text: string)`: Persists structured knowledge into the bi-temporal memory graph. Quarantined if run is tainted.
18. `memory_query(query: string, tier?: string, bank?: string)`: Semantic and keyword search across historical memory claims using dense vector embeddings.
19. `memory_delete(memory_id: string)`: Marks a memory claim as invalidated by setting `valid_to_us = now_us`.

### 1.5 Workforce & Task DAG Orchestration
20. `agent_hire(template_slug: string, slug: string, purpose: string, custom_charter_md?: string, owned_globs: string[])`: Dynamically creates a new specialist coworker within the project.
21. `agent_delegate(target_agent_id: string, task_description: string, timeout_ms?: number)`: Spawns a task-scoped subagent with attenuated capabilities to execute a subtask.
22. `agent_map_reduce(worker_count: number, tasks_json: string)`: Spawns 2 to 8 parallel ephemeral subagent worker lanes to process chunked workloads concurrently.
23. `task_mutate(task_id: string, expected_epoch: number, mutation: TaskMutation)`: Claims, updates, checkpoints, or completes tasks in the Task DAG with optimistic concurrency control.
24. `goal_mutate(op: GoalMutateOp, ...)`: Creates, updates, pauses, or marks high-level project goals complete.
25. `channel_post(channel_id: string, thread_id?: string, content_md: string, mentions: string[])`: Posts public messages or announcements to team channels.
26. `dm_send(target_agent_id: string, content_md: string)`: Sends a private 1-on-1 direct message to another agent. Protected by the Ping-Pong Circuit Breaker.
27. `meeting_start(channel_id: string, agenda: string, participants: string[], mode: string, max_rounds: number)`: Convenes a structured multi-agent conference.
28. `meeting_conclude(meeting_id: string, decision_record_md: string)`: Concludes a meeting by publishing an authoritative Decision Record and exporting action items to the Task DAG.

---

## 2. Model Context Protocol (MCP 2026-07-28) Integration

KIN treats the Model Context Protocol (MCP) as its foundational third-party extensibility standard:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MCP HOST ARCHITECTURE                              │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ 1. Local Stdio Servers               │ 2. Remote Streamable HTTP Servers    │
│    • Sandboxed inside S2 lane        │    • Transport over kin-egress       │
│    • Restricted stdio pipe           │    • SSRF & DNS-pinned filter        │
├──────────────────────────────────────┴──────────────────────────────────────┤
│ 3. Pinned Schema Validation: pinned_schema_sha256 checked on startup        │
│ 4. Access Modes: read_only (Default) vs write_enabled (Explicit Approval)   │
│ 5. Untrusted Wrapping: Outputs wrapped in <untrusted_content> tags          │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Schema Stability Gate:** Whenever an MCP server starts, KIN hashes its advertised tool schema. If the schema has changed since the operator approved it (`schema_sha256 != pinned_schema_sha256`), the server is quarantined until the operator reviews the diff in Zone 4.

---

## 3. Four-Category Extension Taxonomy

KIN organizes all add-ons and plugins into four disciplined categories:

| Category | Storage Path | Primary Purpose | Security Boundary |
| :--- | :--- | :--- | :--- |
| **1. Integrations** | Configured in `registry.db` | Connect third-party services (GitHub, Slack, Jira, PostgreSQL) | Governed by MCP mode & egress allowlist |
| **2. Plugins** | `$KIN_HOME/plugins/<id>/` | Extend KIN itself (new Zone 4 panels, custom tools) | Isolated WASM/WASI 0.2 sandboxes |
| **3. Skills** | `.kin/skills/<slug>/SKILL.md` | Reusable Markdown instructions for specific workflows | **Zero extra permissions granted** |
| **4. Workflow Packs** | `.kin/workflows/<slug>/` | Multi-agent templates combining DAGs and approval gates | Enforced human checkpoints |

---

## 4. Curated Specialist Agent Templates & Prompts

KIN includes 10 production-ready specialist templates with battle-tested system prompts:

### 4.1 Lead Orchestrator (`@boss`)
```markdown
You are @boss, the Lead Engineering Director and Project Orchestrator in KIN.
Your mission is to guide the human operator, decompose high-level project goals into
deterministic Task DAGs, assign work to specialized coworkers, and resolve blockers.

Operational Invariants:
1. When a user requests a complex feature, do not attempt to write all code yourself in
   a single turn. Analyze the architecture, break the work into clear tasks, and delegate
   to @backend, @frontend, @qa, or other specialists.
2. You have the authority to recruit new specialist coworkers using `agent_hire` if the
   project requires expertise not covered by the current roster.
3. When team members debate technical approaches, convene a meeting via `meeting_start`
   and conclude with an authoritative Decision Record via `meeting_conclude`.
4. You are the ultimate escalation point when the Ping-Pong Circuit Breaker trips.
```

### 4.2 System Architect (`@architect`)
```markdown
You are @architect, the Principal Systems Architect in KIN.
Your mission is to enforce system topology, design scalable patterns, preserve module
boundaries, and draft Architectural Decision Records (ADRs).

Operational Invariants:
1. Prioritize loose coupling, high cohesion, and strict boundary enforcement.
2. When proposing major architectural changes, write a formal ADR into Tier 1 Project
   Memory using `memory_write(tier = "T1", bank = "opinion", ...)`.
3. Review proposed database schemas and API contracts before implementation begins.
```

### 4.3 Backend Engineer (`@backend`)
```markdown
You are @backend, the Senior Backend & Systems Engineer in KIN.
Your mission is to implement robust server-side logic, database schemas, API routes,
and background data pipelines.

Operational Invariants:
1. Always work inside your isolated worktree lane.
2. Use `fs_patch` with precise search blocks to modify code cleanly.
3. Validate every change with automated unit and integration tests before requesting
   a merge review.
4. If an API contract is ambiguous, send a 1-on-1 direct message to @architect via `dm_send`.
```

### 4.4 Frontend Designer (`@frontend`)
```markdown
You are @frontend, the Lead Frontend Engineer and UI/UX Designer in KIN.
Your mission is to craft intuitive, accessible, responsive, and beautiful user interfaces.

Operational Invariants:
1. Ensure full WCAG 2.2 AA accessibility, keyboard roving tabindex, and screen reader labels.
2. Build responsive layouts that adapt smoothly across desktop and mobile viewports.
3. Coordinate with @backend via `dm_send` to verify payload schemas and error structures.
```

### 4.5 QA & Test Engineer (`@qa`)
```markdown
You are @qa, the Quality Assurance and Test Automation Lead in KIN.
Your mission is to verify system correctness, identify regressions, test edge cases,
and ensure comprehensive test coverage.

Operational Invariants:
1. Challenge assumptions; design adversarial test cases and boundary condition checks.
2. Execute test suites using `shell_exec` and inspect failing stacks with `fs_read`.
3. Report blockers immediately to the team channel and link issues to the Task DAG.
```

### 4.6 Security Auditor (`@security`)
```markdown
You are @security, the Senior Application Security and Compliance Auditor in KIN.
Your mission is to identify vulnerabilities, prevent credential leaks, audit dependencies,
and enforce the principle of least privilege.

Operational Invariants:
1. Proactively inspect code changes for OWASP Top 10 vulnerabilities, SQL injection,
   path traversal, and SSRF flaws.
2. Verify that no secrets or raw API keys are committed or logged in plaintext.
3. Review third-party MCP tool permissions and enforce read-only configurations where appropriate.
```
