# DOC-03: Self-Healing Agent Harness, 15-State Transition Table, Bi-Temporal Graph Memory & 9-Layer Context Compiler

| Field | Value |
| :--- | :--- |
| **Document ID** | KIN-DOC-03 (`03-HARNESS-MEMORY-CONTEXT.md`) |
| **Suite Version** | `10.0.0-PRODUCTION` |
| **Status** | **Canonical Specification & Reference Contract Bundle** |
| **Scope** | Stage-0 Pre-Gate + 3-Stage Deterministic Turn Arbiter (`Stage 0–3 DTA`, `ST-38`), Complete 15-State Run Transition Table & Recovery Matrix (`ST-29`), Subagent Child-to-Parent Taint Propagation & Orphan Cancellation Cascade (`RT4-11`, `RT7-06`), 3-Strike Completion Gate (`ST-13`, `RT4-20`, `RT9-08`), 3-Strike Loop Breaker (`HRN-LOOP-001`, `RT6-09`), Pre-Step Budget & Step-Limit Guards (`HRN-BDG-001`, `HRN-STP-001`, `RT8-06`, `RT9-15`), Memory Governance & Quarantine Triggers (`RT4-11.4`), Scoped `vec0` KNN + RRF (`ST-23`, `RT9-13`), and 9-Layer KV-Cache Compiler (`L1`–`L9`, `ST-39`, `RT11-07`) |

## 1. The Stage-0 Pre-Gate + 3-Stage Deterministic Turn Arbiter (`Stage 0–3 DTA`, `ORC-RTE-001..008`, Fixing `ST-38` & `RT4-22`)

1. **Stage 0: Hop-Depth Loop Guard, DM Ping-Pong Pre-Check & Zero-Token Ack Gate (`0 ms`, `0 tokens`)**:
   - If `author_kind == 'agent'` and `hop_depth >= 4`, block specialist wake and escalate to `@boss`.
   - **DM Ping-Pong Pre-Check & Reset (`RT4-22`)**: In `agent_agent` DMs (`dm_send`), before updating `dm_conversations`, inspect `consecutive_agent_turns`:
     - If `consecutive_agent_turns == 4`, block the DM before SQLite `UPDATE` (avoiding `CHECK` constraint abort), reset `consecutive_agent_turns = 0`, and post a blocker summary to `@boss`.
     - If `consecutive_agent_turns < 4`, increment `consecutive_agent_turns = consecutive_agent_turns + 1`.
     - Whenever a human operator posts a message, or either agent participant executes `fs_write`, `fs_patch`, or a `task_mutate` state transition, reset `consecutive_agent_turns = 0`.
   - If `author_kind == 'human'` and message is `<= 6` words matching the non-imperative acknowledgment lexicon (`thanks`, `thank you`, `ok`, `okay`, `got it`, `sounds good`, `lgtm`, `cool`, `ack`) with zero `?` characters and zero file path / code tokens, persist as **HEAR-ONLY** (`0` wakes, `0` tokens).
2. **Stage 1: Explicit Structural Routing (`0 ms`, `0 tokens`)**:
   - `/command` -> Command Handler; explicit `@agent` (`1..3` mentions) -> wake mentioned specialists; `@all`/`@channel` -> wake `@boss` only; reply in active thread with valid sticky affinity (`now_us < sticky_until_us` and `cos(m, t) >= 0.35`) -> wake `sticky_agent_id`; sole specialist channel lead -> wake `lead_agent_id`.
3. **Stage 2: Normalized Multi-Signal Scorer (`< 12 ms` p95 target, `0 tokens`)**:
   - For each channel specialist $A \in M_{\text{chn}}$, compute active signals:
     - $S_{\text{sem}}(A) = \max(0, \cos(\text{embed}(m), A.\text{role\_embedding}))$ (base weight $w_{\text{sem}} = 0.45$)
     - $S_{\text{lex}}(A) = \min(1.0, \text{BM25}(m, A.\text{domain\_keywords}) / 10.0)$ (base weight $w_{\text{lex}} = 0.20$)
     - $S_{\text{path}}(A) = \text{Jaccard}(\text{paths}(m), A.\text{owned\_globs})$ (base weight $w_{\text{path}} = 0.20$, active only when $\text{paths}(m) \neq \emptyset$)
     - $S_{\text{lease}}(A) = 1.0$ if $A$ holds an active task/lane in channel else $0.0$ (base weight $w_{\text{lease}} = 0.15$, active only when any lease exists in channel)
   - Normalize active weights $\tilde{w}_k = w_k / \sum_{j \in \text{active}} w_j$ so $\max S(A) = 1.00$.
   - Let $A_1, A_2$ be the top-2 scoring specialists:
     - **High-Confidence Route ($S(A_1) \ge 0.58$ and $S(A_1) - S(A_2) \ge 0.10$)**: Wake $A_1$ and set `sticky_agent_id = A_1` for 10 minutes.
     - **Low-Signal Human Fallback ($S(A_1) < 0.32$, Fixing `ST-38`)**: If `author_kind == 'human'` (since Stage 0 already filtered out pure acknowledgments), **always wake `@boss`** so declarative bug reports or general requests are never silently ignored. (If `author_kind == 'agent'` with no `@mention` and $S(A_1) < 0.32$, persist as HEAR-ONLY.)
4. **Stage 3: Bounded `fast_tool` Classifier Fallback ($0.32 \le S(A_1) < 0.58$ or margin $< 0.10$, Capped at `< 5%` of Turns)**:
   - **Latency & Invocation Boundary (`NFR-PERF-004`)**: The `< 15 ms` p95 (`0` LLM tokens) router latency budget governs deterministic **Stages 0–2**, which resolve `>= 95%` of turns on the `KIN-Bench-Router-1k` workload. Stage 3 triggers only on ambiguous mid-band messages (`< 5%` fallback frequency budget) and is governed by a separate **Stage-3 Fallback Latency Budget of `< 800 ms` p95 and `1,500 ms` hard timeout**.
   - Invokes `fast_tool` (`max_output_tokens = 96`, temperature `0.0`, timeout `1,500ms`) with `stage3_router_classifier.md.tera`. Defaults deterministically to `@boss` on timeout or `confidence < 0.50`.
5. **Wake Coalescing Taint Preservation (`RT4-11.2`)**:
   - When a newly arrived message or task coalesces into an already-queued `wake_queue` row (`UPDATE wake_queue SET coalesce_count = coalesce_count + 1, source_message_id = :msg_id`), `kin-orch` sets `tainted = CASE WHEN tainted = 1 OR :new_tainted = 1 THEN 1 ELSE 0 END`, enforced at the database layer by `trg_wake_monotonic_taint` (`KIN-SEC-0016`).

## 2. Canonical 15-State Run Lifecycle, Transition Table & Recovery Matrix (`HRN-RUN-*`, Fixing `ST-29` & `RT4-20`)

### 2.1 Complete 15-State Run Transition Table (`ST-29`, `RT4-20`)

| # | State (`runs.status`) | Valid Outbound Transitions (`Event -> Next State`) |
| :--- | :--- | :--- |
| 01 | `queued` | `WakeClaimed -> preparing`, `CancelRequested -> cancelled` |
| 02 | `preparing` | `ContextReady -> streaming_model`, `CompactionNeeded -> compacting`, `BootInterruptedNonIdempotent -> waiting_recovery`, `BudgetExceeded -> budget_exceeded`, `CancelRequested -> cancelled`, `FatalError -> failed` |
| 03 | `streaming_model` | `ToolCallsProposed -> evaluating_policy`, `EndTurnOnDirtyLane -> verifying_completion`, `EndTurnClean -> completed`, `BudgetExceeded -> budget_exceeded`, `CancelRequested -> cancelled`, `FatalError -> failed` |
| 04 | `evaluating_policy` | `AllApprovedOrReadOnly -> executing_tools`, `NeedsHumanApproval -> waiting_approval`, `AllDeniedContinue -> preparing`, `HardStopAbort -> failed`, `CancelRequested -> cancelled` |
| 05 | `waiting_approval` | `HumanApproved -> executing_tools`, `HumanDeniedOrExpired -> preparing`, `CancelRequested -> cancelled` |
| 06 | `waiting_takeover` | `HumanHandBack -> preparing`, `TakeoverAborted -> cancelled` |
| 07 | `waiting_subagent` | `AllSubagentsCompleted -> preparing`, `CancelRequested -> cancelled`, `FatalError -> failed` |
| 08 | `waiting_recovery` | `OperatorRetryApproved -> executing_tools`, `OperatorMarkedSucceeded -> preparing`, `OperatorAborted -> cancelled` |
| 09 | `executing_tools` | `StepToolsFinished -> preparing`, `BrowserTakeoverRequested -> waiting_takeover`, `SubagentFanoutSpawned -> waiting_subagent`, `BootCrashNonIdempotent -> waiting_recovery`, `CancelRequested -> cancelled`, `FatalError -> failed` |
| 10 | `verifying_completion` | `GatePassedOrNoGate -> completed`, `GateFailedSelfHeal(fail_attempt<3) -> preparing`, `GateFailedMaxAttempts(fail_attempt>=3) -> failed`, `TreeMutatedSelfHeal(tree_mutate_attempts<=2) -> preparing`, `TreeMutatedMaxAttempts(tree_mutate_attempts>2) -> failed`, `CancelRequested -> cancelled` |
| 11 | `compacting` | `CompactionDone -> streaming_model`, `FatalError -> failed`, `CancelRequested -> cancelled` |
| 12 | `completed` | *(Terminal State)* |
| 13 | `cancelled` | *(Terminal State)* |
| 14 | `failed` | *(Terminal State)* |
| 15 | `budget_exceeded` | *(Terminal State)* |

### 2.2 Complete Boot Crash Recovery Matrix Across All Non-Terminal States (`HRN-REC-001`, Fixing `ST-29` & `RT4-20`)

| Interrupted `runs.status` on Disk | Interrupted `tool_calls` State | Deterministic Boot Recovery Action |
| :--- | :--- | :--- |
| `queued`, `preparing`, `streaming_model`, `evaluating_policy`, `compacting`, `verifying_completion` | None or `intent_logged` (unstarted) | Clear `worktree_lanes.write_frozen = 0`, preserve SQLite-persisted `worktree_lanes.tree_mutate_attempts` and `worktree_lanes.gate_fail_attempts` (`RT4-20`), mark any unstarted `tool_calls` as `aborted_on_crash`, discard partial `run_steps` stream, and transition to `preparing` at `step_index`. |
| `waiting_approval` | `awaiting_approval` | If `approval_requests.expires_at_us > now_us`, keep in `waiting_approval` and re-broadcast `approval.requested` in `project_events`; if expired, set `approval_requests.status = 'expired'`, `tool_calls.status = 'denied'`, and transition run to `preparing`. |
| `waiting_takeover` | `executing` (`browser_act`) | Keep run in `waiting_takeover` and re-emit takeover banner so operator can **Hand Back** or **Abort**. |
| `waiting_subagent` | `executing` (`agent_delegate` / `agent_map_reduce`) | Recover all child runs (`parent_run_id = run.id`) first; propagate any child `tainted = 1` to parent (`RT4-11.1`); once all child runs reach terminal state, aggregate `SubagentArtifact` results and transition parent to `preparing`. |
| `waiting_recovery` | `interrupted_needs_reconcile` (`non_idempotent_write` / `external_side_effect`) | Keep run in `waiting_recovery` (never auto-replaying the interrupted side-effecting tool per `INV-005`) and re-emit the Crash Recovery Card in `project_events` so the operator can choose **Retry**, **Mark Succeeded**, or **Abort**. |
| `executing_tools` | `intent_logged` or `executing` with `mutability == 'read_only'` | Set `tool_calls.status = 'aborted_on_crash'` and automatically re-execute the read tool. |
| `executing_tools` | `intent_logged` or `executing` with `mutability == 'idempotent_write'` | Clean up any `.kin-tmp-*` staging file in Lane, verify file BLAKE3, set `aborted_on_crash`, and re-apply idempotently. |
| `executing_tools` | `intent_logged` or `executing` with `mutability IN ('non_idempotent_write','external_side_effect')` | **NEVER auto-replay (`INV-005`)**. Set `tool_calls.status = 'interrupted_needs_reconcile'` and `runs.status = 'waiting_recovery'`. Surface Crash Recovery Card (**Retry**, **Mark Succeeded**, or **Abort**). |

### 2.3 Parallel Subagent Fan-Out, Bidirectional Taint Propagation & Orphan Cancellation Cascade (`HRN-SUB-001`, Fixing `ST-28`, `RT4-11.1` & `RT7-06`)

When `@boss` or a specialist invokes `agent_delegate` or `agent_map_reduce(subtasks, concurrency_max)`:

1. **Validation & Attenuation (`INV-006`)**: Verifies `2 <= subtasks.len() <= 8` (for `agent_map_reduce`), `parent.spawn_depth < 2`, and pairwise disjointness of `owned_paths` across any non-read-only subtasks. Each child run receives `budget_micro_usd_max = (parent.remaining_budget * 80 / 100) / subtasks.len()` and inherits `parent.tainted` (`trg_runs_propagate_wake_taint`).
2. **Isolated Execution & Cancellation Cascade (`HRN-SUB-001`, `RT7-06`)**: Spawns up to `concurrency_max` (`<= 8`) child runs concurrently (each in its own `wkt_sub_<i>` lane if `read_only == false`) with a child `CancellationToken` linked to the parent run, and transitions the parent run to `waiting_subagent`. If the parent run transitions to `cancelled`, `failed`, or `budget_exceeded`, SQLite trigger `trg_runs_cancel_children_on_parent_abort` (`KIN-HRN-0010`) atomically marks all active child runs `cancelled` and the child `CancellationToken` aborts any in-flight child streams/tools immediately.
3. **Child-to-Parent Taint Propagation & Bounded Reduction (`RT4-11.1`, `RT5-03`)**:
   - The moment any child subagent becomes tainted (`child.tainted = 1`, e.g., by calling `web_fetch` or `web_search`), SQLite trigger `trg_runs_propagate_child_taint_to_parent` immediately sets `tainted = 1` on `parent_run_id` (and any grandparent run up to `spawn_depth = 2`).
   - When all child runs finish, if any child had `tainted == 1`, its `SubagentArtifact.summary_md` is wrapped in `<untrusted_content>` when injected into the parent's L8 prompt, and the parent run's `ctx.mark_tainted()` state is synchronized in memory before resuming `preparing`.

### 2.4 Epoch-Locked Pre-Completion Self-Healing Gate (`HRN-VRF-001`, Fixing `ST-13` & `RT4-20`)

1. **Async Write Permit & Mutation Epoch (`ST-13`)**: Every mutating tool in `kin-tools` holds a shared read guard (`tokio::sync::RwLock::read().await`) on the Lane's in-memory execution lock and atomically increments `worktree_lanes.mutation_epoch` on completion. When `verifying_completion` begins, `kin-harness` acquires the exclusive `RwLock::write().await` guard (and sets `write_frozen = 1`, enforced in SQLite by `trg_worktree_lanes_freeze_and_terminal`, `RT6-03`) and records `epoch_before = lane.mutation_epoch`.
2. **Honest Unconfigured Gate Behavior (`ST-13`)**: If `[gates].fast_check` is empty/unconfigured in `kin.toml`, `kin-harness` sets `lane.verification_state = 'unverified_no_gate'`, leaves `last_verified_tree_sha = NULL`, and allows completion with an explicit `Unverified (No Gate Configured)` badge in Zone 4.
3. **Pre/Post Tree-SHA, Formatter Loop Cap & Persisted `gate_fail_attempts` (`ST-13`, `RT4-20`)**: Computes `pre_tree_sha`, runs `fast_check` inside `kin-sandbox` (`S2-Lane-Exec`) with `timeout = config.gates.timeout_seconds` (`180s` default), and computes `post_tree_sha` and `epoch_after`:
   - If `post_tree_sha != pre_tree_sha` or `epoch_after != epoch_before`: increments `worktree_lanes.tree_mutate_attempts` (`CHECK (tree_mutate_attempts BETWEEN 0 AND 3)` in SQLite, `RT12-01`). On attempts `1` and `2` (`tree_mutate_attempts <= 2`), injects `<kin-reminder type="pre_completion_tree_mutated" attempt="{attempts}/2">` and transitions to `preparing`. On the 3rd consecutive tree mutation (`tree_mutate_attempts > 2`, i.e., `== 3`), transitions to `failed` and escalates to `@boss`.
   - If `exit_code == 0 && post_tree_sha == pre_tree_sha`: sets `last_verified_tree_sha = post_tree_sha`, `verification_state = 'verified'`, and resets both `tree_mutate_attempts = 0` and `gate_fail_attempts = 0` in SQLite (`RT4-20`).
   - If `exit_code != 0`: sets `verification_state = 'failed'` and atomically increments `fail_attempt = worktree_lanes.gate_fail_attempts + 1` in SQLite (`RT4-20`, `RT9-08`). On attempts `1` and `2` (`fail_attempt < 3`), injects `<kin-reminder type="pre_completion_verification_failed" attempt="{fail_attempt}/3">` and transitions to `preparing`. On the 3rd consecutive failure (`fail_attempt >= 3`), transitions to `failed` and escalates to `@boss`. Because `gate_fail_attempts` is persisted in `worktree_lanes`, a `SIGKILL` crash mid-self-heal never resets the retry counter.

### 2.5 Deterministic 3-Strike Identical-Call & Oscillating Tree-SHA Loop Circuit Breaker (`HRN-LOOP-001`, Fixing `RT6-09`)

To prevent an agent from burning steps or budget on repeated failing commands or oscillating edits:

1. **Per-Step Tool Signature Tracking**: Every `tool_calls` row records `tool_name` and `args_blake3` (`BLAKE3(JCS(args_redacted_jcs_json))`), and every mutating step records `worktree_lanes.current_tree_sha`.
2. **Strike 2 Warning (`<kin-reminder type="loop_warning">`)**: Before executing a proposed tool call `(tool_name, args_blake3)`, if the identical `(tool_name, args_blake3)` has already executed once within the last 6 steps on the same `current_tree_sha` (or if `current_tree_sha` reverted to an earlier SHA `A -> B -> A`), `kin-harness` appends a `<kin-reminder type="loop_warning">` in Layer L9 displaying the previous attempt's exit code and output preview and instructing the agent to change its approach.
3. **Strike 3 Circuit Breaker (`KIN-HRN-0008` / `KIN-HRN-0009`)**: If the model proposes the same `(tool_name, args_blake3)` a 3rd time on the same `current_tree_sha` (or if `current_tree_sha` oscillates `A -> B -> A -> B` across 4 consecutive mutating steps):
   - The redundant tool call is blocked pre-execution with `KIN-HRN-0008 DuplicateToolCallBlocked`.
   - `kin-harness` forces one diagnostic reflection turn with `reasoning_effort = 'high'`.
   - If the very next step again proposes a blocked duplicate or fails to advance `current_tree_sha`, the run transitions to `failed` (`error_code = "KIN-HRN-0009"`, `LoopCircuitBreakerTripped`) and automatically posts a structured blocker summary to `@boss`.

### 2.6 Pre-Step Budget & Step-Limit Enforcement Guards (`HRN-BDG-001`, `HRN-STP-001`, Fixing `RT8-06` & `RT9-15`)

To guarantee deterministic cost bounds across individual runs, specialists, and the project:

1. **Three-Level Pre-Step Check**: Before transitioning from `preparing` to `streaming_model` on every step, `kin-harness` evaluates:
   - `run.cost_micro_usd < run.budget_micro_usd_max`
   - `agent_daily_spend_micro_usd < agent.daily_budget_micro_usd`
   - `project_daily_spend_micro_usd < project.budget_daily_micro_usd` and `project_monthly_spend_micro_usd < project.budget_monthly_micro_usd`
2. **85% Soft Warning (`<kin-reminder type="budget_warning">`)**: When any active budget reaches `>= 85%` of its ceiling, `kin-harness` injects a `<kin-reminder type="budget_warning">` block into Layer L9 instructing the agent to complete its current edit, run `[gates].fast_check`, and conclude cleanly.
3. **100% Hard Ceiling (`KIN-HRN-0011 BudgetExceeded`)**: The moment a step causes `cost_micro_usd >= budget_micro_usd_max` (or exceeds the agent/project ceiling), `kin-harness` aborts any further model turns, transitions `runs.status` to `'budget_exceeded'` (`error_code = "KIN-HRN-0011"`), cascades cancellation to any active child subagents (`trg_runs_cancel_children_on_parent_abort`), and logs `run.budget_exceeded` to `ledger_events`.

4. **Pre-Step `step_count >= max_steps` Guard (`HRN-STP-001`, Fixing `RT9-15`)**: Before incrementing `runs.step_count` in `preparing`:
   - If `run.step_count + 2 == run.max_steps`, `kin-harness` injects `<kin-reminder type="step_limit_warning" remaining="2">` in Layer L9.
   - If `run.step_count >= run.max_steps`, `kin-harness` **does not increment `step_count`** (avoiding a SQLite `CHECK (step_count <= max_steps)` abort); instead, it transitions `runs.status` to `'failed'` with `error_code = "KIN-HRN-0012"` (`MaxStepsReached`) and `ended_at_us = now_us`, and posts a structured checkpoint summary to `@boss`.

## 3. Governed 4-Tier × 4-Bank + Bi-Temporal Graph Memory (`MEM-*`, Fixing `ST-22`, `ST-23`, `ST-28`, `RT4-11.4`, `RT5-04`)

### 3.1 Write Governance Matrix & SQLite Quarantine Triggers (`MEM-WRT-001`, Fixing `ST-28`, `RT4-11.4` & `RT5-04`)

Every agent-authored row in `memory_items` records `created_by_agent_id` and `created_by_run_id` (`REFERENCES runs(id)`), and SQLite triggers `trg_memory_enforce_taint_quarantine_insert` and `trg_memory_enforce_taint_quarantine_update` enforce the governance table below at the database level:

| Target Tier | Invoking Actor & Taint State | Base Risk | Resulting `memory_items.status` & `trust` (Enforced by SQLite Trigger) |
| :--- | :--- | :--- | :--- |
| **T3 (Agent-Private) / T4 (DM)** | Owning agent / DM participant (`tainted == 0`) | R1 | `status = 'active'`, `trust = 'agent'` |
| **T3 / T4** | Owning agent / DM participant (`tainted == 1`) | R1 | **Forced `trust = 'untrusted'`** (`status = 'active'`, tagged `<untrusted_memory>` in L6; `KIN-SEC-0017` aborts if `trust != 'untrusted'`) |
| **T1 (Project) / T2 (Channel)** | Any agent with `run.tainted == 1` | R2 | **Forced `status = 'quarantined', trust = 'untrusted'`** (`KIN-SEC-0017` aborts any non-quarantined insert; `KIN-SEC-0018` blocks activation unless `trust = 'human'`) |
| **T1 / T2** | Untainted specialist without `memory.write.t1` grant | R2 | `status = 'pending_review'`, `trust = 'agent'` (reviewed by `@boss` or human in Zone 4) |
| **T1 / T2** | Untainted `@boss` or specialist with `memory.write.t1` grant | R2 | `status = 'active'`, `trust = 'agent'` |
| **T1–T4** | Human operator (`/remember` or UI approval) | R0 | `status = 'active'`, `trust = 'human'` |

### 3.2 `scope_key`-Partitioned `vec0` & 4-Signal Ordinal-Rank RRF (`MEM-RET-001`, Fixing `ST-22` & `ST-23`)

1. **Strict Partition Isolation in `memory_vec` (`ST-23`)**: Every vector in `memory_vec` is indexed with `scope_key = tier || ':' || scope_id` (`'T1:project'`, `'T2:chn_...'`, `'T3:agt_...'`, `'T4:dmc_...'`). When an agent queries memory, `kin-memory` issues KNN queries restricted to `WHERE scope_key IN ('T1:project', 'T2:chn_<joined>', 'T3:<self_agt_id>', 'T4:<self_dmc_id>') AND k = 20`, guaranteeing at the `sqlite-vec` partition level that another agent's T3 or T4 vectors are never scanned (`INV-012`). In `DOC-02 §4`, `trg_memory_vec_ad` and `trg_memory_vec_au` automatically delete/update `memory_vec` rows whenever a `memory_items` row is deleted, superseded, archived, or quarantined, and `kin-store::query_memory_vec_knn_scoped(ctx: &AgentSecurityContext, scope_key: &str, ...)` validates `ctx.can_read_scope_key(scope_key)?` before binding `WHERE scope_key = ?1 AND embedding MATCH ?2 AND k = ?3` (`RT9-13`).
2. **Ordinal-Rank RRF Formula with Explicit $\lambda$ (`ST-28`)**:
   $$\text{Score}(m) = \left( \frac{0.45}{60 + \text{rank}_{\text{vec}}(m)} + \frac{0.25}{60 + \text{rank}_{\text{fts}}(m)} + \frac{0.20}{60 + \text{rank}_{\text{grf}}(m)} + \frac{0.10 \cdot B_{\text{prc}}(m)}{61} \right) \cdot \left(0.5 + 0.3 \cdot m.\text{importance} + 0.2 \cdot m.\text{utility\_ema}\right) \cdot m.\text{confidence} \cdot e^{-\lambda \cdot \Delta t_{\text{days}}}$$
   where $\text{rank}_{\text{vec}}, \text{rank}_{\text{fts}}, \text{rank}_{\text{grf}} \in \{1, 2, \dots, K\}$ ($1$ = best match), $B_{\text{prc}}(m) \in \{0, 1\}$, and **$\lambda = 0.005\text{ day}^{-1}$ for `bank IN ('experience','opinion')` and $\lambda = 0.0\text{ day}^{-1}$ for `bank IN ('world','procedure')`**.
3. **Zero-Churn Read Accounting (`ST-22`)**: Updating `access_count = access_count + 1` and `last_accessed_at_us` batches asynchronously and does **not** fire `trg_memory_au` (which is scoped to `UPDATE OF status, subject_key, claim_text, tier, scope_id`).

### 3.3 Post-Run Procedural Trajectory Auto-Distillation (`MEM-PRC-001`, Fixing `ST-28`)

When an untainted run (`runs.tainted == 0`) completes with `status = 'completed'`, `step_count >= 6`, `lane.verification_state == 'verified'`, and its `tool_calls` history contains at least one failed command (`exit_code != 0`) followed by a successful fix (`exit_code == 0`), `kin-memory` spawns a background distillation job using `fast_research` and `procedural_distiller.md.tera` (DOC-07 §1.4). If `should_save == true`, the extracted recipe is saved into `memory_items` (`bank = 'procedure'`, `tier IN ('T1', 'T2')` — defaulting to `'T2'` for channel-scoped runs or `'T1'` for project-wide procedures — with `status = 'pending_review'` or `'active'`, `RT12-18`).

## 4. The 9-Layer KV-Cache-Optimized Prompt Compiler (`HRN-CTX-001..012`, Fixing `ST-28` & `ST-39`)

To guarantee 100% byte-stability of BP1 (L1–L3) and BP2 (L4–L6) across all steps of a run (`INV-011`), **no lane-modified or per-step dynamic content is ever placed in L1–L6** (`ST-39`):

| Layer | Cache Zone | Content & Strict Determinism Contract (`ST-28`, `ST-39`) |
| :--- | :--- | :--- |
| **L1: Constitutional Core** | BP1 (Project-Static) | `L1_constitutional_core.md.tera` (DOC-07 §1.1). Static across the entire project. |
| **L2: Canonical 26-Tool Catalog** | BP1 (Project-Static) | All 26 built-in tool JSON schemas sorted A–Z (DOC-07 §2) + 1-line active skill catalog (~40 tokens/skill) + compact read-only `mcp_tool_search` directory block (`<mcp_tool_directory>`, not a 27th built-in tool) when an active MCP integration exposes `> 12` tools (`DOC-05 §6.1`, `RT12-12`). |
| **L3: Tier-0 Project Charter** | **BP1 Breakpoint** | Root `KIN.md` + static stack metadata + UTC calendar date (`YYYY-MM-DD`). **Never changes mid-run.** |
| **L4: Agent Role Charter & Grants** | BP2 (Run-Static) | Agent `charter_markdown`, `autonomy_effective`, `sandbox_level`, and capability grants locked at `run.start`. |
| **L5: Snapshot-Pinned T1/T2 Digest** | BP2 (Run-Static) | Top-K active T1 (Project) and T2 (Channel) memories as of `runs.memory_snapshot_seq` locked at `run.start`. |
| **L6: Snapshot-Pinned T3/T4 Digest** | **BP2 Breakpoint** | Top-K active T3 (Agent-Private) and T4 (DM) memories as of `runs.memory_snapshot_seq` locked at `run.start`. |
| **L7: Stable Conversation Prefix** | **BP3 Breakpoint** | Active `context_items` (`1 .. K-1`): prior messages, compaction Checkpoint Summaries, and completed step pairs. |
| **L8: Current Step & Dynamic Repo-Map** | Volatile Tail | Latest user/peer message, active step tool results, on-demand MCP tool schemas & triggered `<kin-skill>` playbooks (`DOC-05 §6.1–§6.3`), and the **Personalized PageRank Call-Graph Repo-Map (`HRN-PPR-001`, 1,024–2,048 tokens)** biased toward files touched in the current run (`ST-39`). |
| **L9: Ephemeral `<kin-reminder>` Tail** | Volatile Tail | Path-scoped `.kin/rules/*.md` for newly touched files, mid-run `memory_write` deltas, loop warnings, and human steer directives. |

### 4.1 Effective Context Window ($W_{\text{eff}}$) & 4-Level Compaction (`HRN-CMP-001`, `ST-28`)

Let the effective prompt token budget be:
$$W_{\text{eff}} = \min\big(\text{model.context\_window},\; \text{session.num\_ctx}\big) - \text{model.max\_output\_tokens} - 4096_{\text{safety}}$$
When compiled prompt tokens $N_{\text{prompt}}$ cross threshold $T$:

- **L1 Observation Masking ($N_{\text{prompt}} \ge 0.72 \cdot W_{\text{eff}}$)**: Replaces tool outputs in L7 older than 6 steps (`> 1,024` tokens) with a 150-token stub + `spill_read` hash (`0` LLM calls; BP1 & BP2 untouched).
- **L2 Turn Compaction ($N_{\text{prompt}} \ge 0.80 \cdot W_{\text{eff}}$)**: Summarizes oldest 50% of L7 into a bounded Checkpoint Summary (`L2_turn_compactor.md.tera`) with `archived_range_json = [msg_A, msg_B]` pointers (BP1 & BP2 untouched; raw `messages` untouched per `INV-014`).
- **L3 Memory Flush + Deep Trim ($N_{\text{prompt}} \ge 0.88 \cdot W_{\text{eff}}$)**: Flushes durable facts to `memory_items`, advances `memory_snapshot_seq`, and compacts all but the last 4 steps.
- **L4 Emergency Deterministic Truncation ($N_{\text{prompt}} \ge 0.94 \cdot W_{\text{eff}}$)**: Drops oldest L7 items down to $0.50 \cdot W_{\text{eff}}$ and injects a `<kin-reminder type="truncation_notice">` with `recall` instructions (`0` LLM calls).
