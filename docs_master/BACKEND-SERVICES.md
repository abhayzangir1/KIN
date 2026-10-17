# KIN Backend Subsystems & Runtime Services

**Document ID:** `KIN-SRV-10.0-PROD`  
**System Name:** KIN — Sovereign Local-First Autonomous Multi-Agent AI Workforce & Harness  
**Version:** `10.0.0-PRODUCTION`  
**Status:** Canonical Engineering Specification for All Six Engine Subsystems  

---

## 1. Subsystem 1: Agent Harness & Multi-Agent Orchestration

The KIN Agent Harness provides a robust, deterministic execution environment around language models. It enforces strict lifecycle transitions, deterministic turn routing, loop stagnation prevention, and hierarchical subagent supervision.

### 1.1 The Canonical 15-State Harness Lifecycle
Every agent run progresses through a formal finite state machine enforced by the core engine:

```text
       ┌───────────┐
       │  Queued   │
       └─────┬─────┘
             ▼
       ┌───────────┐
       │ Preparing │ ◄── (Hydrates memory, compiles 9-layer prefix)
       └─────┬─────┘
             ▼
    ┌──────────────────┐
    │  StreamingModel  │ ◄── (Receives tokens & tool invocations from LLM)
    └────────┬─────────┘
             ▼
    ┌──────────────────┐
    │ EvaluatingPolicy │ ◄── (Dual-AST static analysis & security check)
    └────────┬─────────┘
             │
     ┌───────┴─────────────────────────┐
     ▼                                 ▼
┌──────────────────┐         ┌────────────────────┐
│ WaitingApproval  │         │  ExecutingTools    │
│ (Operator Gate)  │         │  (Sandboxed Run)   │
└────────┬─────────┘         └─────────┬──────────┘
         │                             │
         └──────────────┬──────────────┘
                        ▼
             ┌─────────────────────┐
             │ VerifyingCompletion │ ◄── (Epoch-locked test/LSP gate)
             └──────────┬──────────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Completed   │ │  Cancelled   │ │    Failed    │
└──────────────┘ └──────────────┘ └──────────────┘
```

- **Special Auxiliary Waiting States:**
  - `WaitingTakeover`: Browser automation encountered CAPTCHA, 2FA, or login screen; suspended waiting for operator hand-back.
  - `WaitingSubagent`: Parent agent suspended awaiting completion of delegated subagent lanes.
  - `WaitingRecovery`: Tool call failed due to external fault; waiting for operator retry/abort resolution.
  - `Compacting`: Token budget threshold reached; conversation history being summarized.
  - `BudgetExceeded`: Run terminated due to project spend ceiling.

### 1.2 The 3-Stage Deterministic Turn Arbiter (DTA)
To eliminate the high latency and token cost of invoking an LLM router on every conversational turn, the DTA resolves message turn assignments in three deterministic stages:

```text
Incoming Channel Message
          │
          ▼
┌───────────────────────────────────────────────────┐
│ Stage 0: Ack Pre-Gate                             │
│ Regex / AST filter catches short acknowledgments   │ ───> 0 Wakes, 0 Tokens (<1ms)
│ (e.g., "thanks", "ok", "got it", "nice")          │
└─────────────────┬─────────────────────────────────┘
                  │ (Non-ack message)
                  ▼
┌───────────────────────────────────────────────────┐
│ Stage 1: Explicit Mention & Role Router           │
│ Direct @agent (e.g. @backend) or @role matching   │ ───> Wakes targeted agent (<2ms)
└─────────────────┬─────────────────────────────────┘
                  │ (No explicit mention found)
                  ▼
┌───────────────────────────────────────────────────┐
│ Stage 2: Quantized Semantic Domain Matcher        │
│ Local INT8 ONNX embedding matcher against active  │ ───> Wakes highest-scoring
│ specialist charters (cosine similarity threshold) │      specialist (<15ms)
└─────────────────┬─────────────────────────────────┘
                  │ (Score < 0.32 or ambiguous)
                  ▼
┌───────────────────────────────────────────────────┐
│ Stage 3: Lead Orchestrator Fallback               │
│ Default to @boss in #general to coordinate,       │ ───> @boss evaluates and replies
│ answer directly, or advise hiring a new coworker  │      or delegates
└───────────────────────────────────────────────────┘
```

- **Performance Metrics:** Stages 0 through 2 resolve **>= 95%** of all channel messages within **< 15ms p95** at **0 LLM token cost**.

### 1.3 LoopBreaker Stagnation Guard
To prevent infinite repetitive loops where an agent executes identical failing commands:
- KIN computes a rolling BLAKE3 hash over the agent's last 3 tool invocations and arguments.
- If an agent generates identical tool calls 3 times in succession without intermediate file mutations or test advancements, the **LoopBreaker** trips immediately with `KIN-HRN-0009`. The run is paused and escalated to the operator.

---

## 2. Subsystem 2: Cognitive Memory & 9-Layer Context Engineering

### 2.1 4-Tier Memory Scoping & Bi-Temporal Knowledge Graph
Memory claims are partitioned across four explicit visibility boundaries, categorized into four cognitive banks:

| Memory Tier | Visibility Scope | Typical Knowledge Stored | Persistence Rule |
| :--- | :--- | :--- | :--- |
| **Tier 1 (Project)** | All agents in project | Architecture decisions, system facts, style guidelines | Long-term, versioned |
| **Tier 2 (Channel)** | Members of channel | API endpoint schemas, UI design tokens, sprint tasks | Department-scoped |
| **Tier 3 (Private)** | Specific agent only | Personal scratchpad, internal reasoning reflections | Agent lifetime |
| **Tier 4 (Direct Msg)** | DM participants only | 1-on-1 handoff agreements, private consultations | Thread lifetime |

- **Cognitive Banks:**
  1. `World`: Objective verifiable facts about the system and environment.
  2. `Experience`: Historical outcomes of past tool runs, builds, and test executions.
  3. `Opinion`: Architectural preferences, conventions, and design tradeoffs.
  4. `Procedure`: Step-by-step instructions for repetitive deployment or migration tasks.
- **Bi-Temporal Validity:** Every memory item carries `valid_from_us` and `valid_to_us` timestamps. When an architectural fact is superseded, the old claim is marked with `valid_to_us = now_us`, preserving full historical recall without causing prompt hallucinations.

### 2.2 The 9-Layer Prefix Compiler & Cache Stability Invariant
To maximize KV-cache reuse on providers (achieving `>= 85%` cache hit rates on Anthropic and OpenAI), KIN organizes system prompts into 9 strictly bounded layers:

```text
┌────────────────────────────────────────────────────────┐
│ Layer 1: Core System Invariant & Safety Guardrails     │ ──┐
├────────────────────────────────────────────────────────┤   │ Base Prefix 1 (BP1)
│ Layer 2: Specialist Persona & Behavioral Charter       │   │ RUN-STATIC
├────────────────────────────────────────────────────────┤   │ Byte-Identical across
│ Layer 3: Capability Grants & Allowed Tool Definitions  │   │ all turns in project
├────────────────────────────────────────────────────────┤   │
│ Layer 4: Active Project Topology & Channel Context     │ ──┘
├────────────────────────────────────────────────────────┤
│ Layer 5: Active Goal & Task DAG Leaf State             │ ──┐ Base Prefix 2 (BP2)
├────────────────────────────────────────────────────────┤   │ Semi-Static
│ Layer 6: Grounded Code Intelligence (PPR Repo-Map)     │ ──┘ Session-Stable
├────────────────────────────────────────────────────────┤
│ Layer 7: Scoped Cognitive Memory (T1-T4 Claims)        │ ──┐ Base Prefix 3 (BP3)
├────────────────────────────────────────────────────────┤   │ Dynamic
│ Layer 8: Compacted Conversation Trajectory             │   │ Append-Only
├────────────────────────────────────────────────────────┤   │
│ Layer 9: Active Turn User Prompt & Current Tool Results│ ──┘
└────────────────────────────────────────────────────────┘
```

- **Prefix Cache Stability Invariant:** Layers 1 through 4 are compiled into a bitwise byte-identical string across all turns for an agent, guaranteeing instant KV-cache lookup at the model provider.

### 2.3 Output Spilling Engine
When any tool execution (such as `shell_exec`, `fs_search`, or build outputs) produces more than 2,000 tokens of raw data:
1. The full payload is written to disk as a compressed blob (`blobs/<hash>.zst.enc`).
2. The agent's prompt receives a compact preview:
   ```text
   [OUTPUT SPILLED TO DISK]
   Blob Hash: 3b1a...8f9c (Size: 45,210 bytes, 1,420 lines)
   Preview (First 10 lines):
     ...
   Preview (Last 10 lines):
     ...
   To inspect specific line ranges, invoke fs_read with line ranges on this blob.
   ```

---

## 3. Subsystem 3: Isolated Worktrees & Code Review Workflow

### 3.1 Self-Contained `$KIN_HOME/.../repo.git` Architecture
To guarantee that agent modifications never corrupt the user's working tree or alter file metadata in `<root_path>`, KIN implements a true zero-write architecture:

```text
<user_root_path>/                      [USER WORKSPACE — READ-ONLY TO AGENTS]
├── src/                               Zero bytes written by agents
└── .git/                              mtime and ctime never modified
      │
      │ (Objects fetched into local mirror)
      ▼
$KIN_HOME/projects/<project_id>/
├── repo.git/                          [SELF-CONTAINED AGENT REPOSITORY]
│   └── objects/                       Full bare Git clone / mirror
└── worktrees/
    ├── wkt_01J9A.../                  [AGENT LANE 1: @backend]
    │   └── src/api/routes.rs          Isolated file mutations
    └── wkt_01J9B.../                  [AGENT LANE 2: @frontend]
        └── src/ui/App.tsx             Concurrent parallel development
```

### 3.2 The 4-Tier Cascading Patch Engine (`fs_patch`)
Modifying files via language models frequently fails due to slight indentation shifts or missing whitespace. KIN resolves this with a 4-tier fallback patch algorithm:

1. **Tier 1 (Exact Match):** Direct byte-for-byte substring search. If unique, applies replacement immediately (<1ms).
2. **Tier 2 (Whitespace-Normalized):** Strips trailing spaces and normalizes line endings (`\r\n` vs `\n`).
3. **Tier 3 (Indentation-Agnostic):** Trims common leading indentation on every line of the search block, finds the matching block, and applies the replacement with the file's native indentation.
4. **Tier 4 (AST-Anchored Match):** Uses Tree-sitter to parse the file into an AST, locates the target function or struct node matching the search block signatures, and replaces the specific syntax node directly.

### 3.3 Safe 3-Way Merge & Reversible Apply Journal
1. When an agent completes work in `wkt_<id>`, it invokes `lane_enqueue_merge`.
2. KIN acquires the project merge lock and performs an in-memory 3-way merge check against the current root commit.
3. If conflicts exist, the lane is frozen and an interactive diff review banner surfaces in Zone 4.
4. If clean, the merge commits to root, records a complete diff in `apply_journals`, and updates the user's workspace.
5. **1-Click Atomic Rollback:** Any applied merge can be reverted at any time by issuing `LaneRevertApply`, which uses the `apply_journals` diff to cleanly back out changes without git rebase gymnastics.

---

## 4. Subsystem 4: Process Control (PTY) & Browser Automation

### 4.1 Lane-Scoped Interactive PTYs (`kin-pty`)
Agents needing to run terminal commands (compilers, linters, REPLs) do not spawn detached host processes. They operate via managed pseudo-terminals:
- Terminals run inside the agent's sandboxed worktree lane.
- Output is captured in an in-memory circular ring buffer (`pty_read_ring`) to prevent memory leaks during unbounded streaming.
- **Secret Redaction:** Environment variables passed into PTYs are scrubbed. Real credentials are substituted with `KIN_SECRET_HANDLE_*` tokens.

### 4.2 Managed CDP Browser & Zero-Capture Human Takeover
KIN includes a built-in headless browser automation engine using the Chrome DevTools Protocol (CDP):
- Each agent maintains a persistent browser profile directory (`$KIN_HOME/projects/<id>/browser_profiles/<agent_id>`), preserving cookies and local storage across runs.
- **The Human Takeover Protocol:**
  1. When an agent navigates to a URL containing a login form, CAPTCHA challenge, or 2FA prompt, the agent's run pauses and transitions to `WaitingTakeover`.
  2. The UI in Zone 4 immediately displays the **Takeover Banner** with an embedded live view.
  3. The human operator clicks **"Take Over Browser"**, completing the login or solving the CAPTCHA in the live interactive window.
  4. The operator clicks **"Hand Back to Agent"**. The browser session resumes execution with authenticated cookies intact.

---

## 5. Subsystem 5: Goal & Task DAG Engine

### 5.1 Directed Acyclic Graph Execution
Complex objectives are structured as dependency graphs:

```text
                        ┌────────────────────────┐
                        │   Goal: Auth System    │
                        └───────────┬────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
         ┌─────────────────────┐         ┌─────────────────────┐
         │ Task 1: DB Schema   │         │ Task 2: JWT Utils   │
         │ (Assigned: @backend)│         │ (Assigned: @security│
         └──────────┬──────────┘         └──────────┬──────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
                         ┌─────────────────────┐
                         │ Task 3: Login Route │
                         │ (Assigned: @backend)│
                         └──────────┬──────────┘
                                    ▼
                         ┌─────────────────────┐
                         │ Task 4: UI Login    │
                         │ (Assigned: @frontend│
                         └─────────────────────┘
```

### 5.2 Atomic Task Leasing & OCC Fencing Epochs
- Tasks in state `ready` are claimed by agents via atomic SQLite transactions.
- Each claim increments the task's `epoch` counter and sets a time-bounded lease (`lease_expires_at_us = now + 15m`).
- If an agent attempts to submit completion or mutate a task using an expired or superseded epoch, the transaction fails with `KIN-TSK-0004 TaskLeaseEpochMonotonic`, preventing stale duplicate executions.

---

## 6. Subsystem 6: Code Intelligence & Indexing

### 6.1 Personalized PageRank (PPR) AST Repo-Mapping
Rather than dumping an entire codebase into context or relying on superficial filename searches:
1. Tree-sitter parses all source files in the project into syntax trees.
2. Symbol definitions, references, function calls, and import statements are extracted into a directed call graph.
3. KIN executes a Personalized PageRank algorithm seeded with the files currently active in the user's channel context.
4. The highest-ranked symbols and their type signatures are formatted into an ultra-compact **Repo-Map** (Layer 6 of the prompt), providing the agent with perfect structural awareness in under 800 tokens.

### 6.2 4-Signal Hybrid Semantic Search
Code search queries in KIN utilize a 4-signal hybrid retrieval pipeline:
1. **Dense Vector Search:** Quantized 384-dimensional embeddings stored in `sqlite-vec` `vec0` tables.
2. **Full-Text BM25 Search:** Lexical keyword search over `code_chunks_fts`.
3. **AST Symbol Proximity:** Prioritizes exact matches on function and struct identifiers.
4. **Reciprocal Rank Fusion (RRF):** Merges the results into a unified top-20 ranking in under **45ms**.
