# KIN API and Typed IPC Contracts

**Document ID:** `KIN-API-10.0-PROD`  
**System Name:** KIN — Sovereign Local-First Autonomous Multi-Agent AI Workforce & Harness  
**Version:** `10.0.0-PRODUCTION`  
**Status:** Canonical IPC Wire Protocol, Command Envelopes, Server Frames & Error Taxonomy  

---

## 1. Wire Protocol & Framing Specification (`KIN8`)

All communication between the frontend client (Tauri / CLI) and the native core engine (`kin-engine`) occurs over a bidirectional, stream-multiplexed local transport (Unix Domain Socket or Windows Named Pipe) using the **KIN8** 16-byte binary framing protocol.

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Magic: 0x4B494E38 ("KIN8")                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Flags (u16)          |        Stream ID (u16)        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Payload Length (u32)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     CRC-32C Checksum (u32)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Payload Data (UTF-8 JSON)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### 1.1 Header Fields
- `magic`: Constant `0x4B494E38` (ASCII `"KIN8"`). Reject immediately if mismatched.
- `flags`:
  - `0x0001`: Payload is compressed with Zstandard (`zstd`).
  - `0x0002`: Heartbeat ping frame (no payload).
  - `0x0004`: Resync required (client must clear cached state and request `ProjectSnapshot`).
- `stream_id`: Identifies the logical stream (e.g., `0` for control plane, `1..N` for active agent token generation streams).
- `payload_len`: Size of the following JSON payload in bytes (enforced maximum: 16 MiB).
- `crc32c`: Hardware-accelerated Castagnoli CRC-32C calculated over the payload bytes.

---

## 2. Client Envelope (`ClientEnvelope`)

Every message sent from client to server is encapsulated in a strongly typed `ClientEnvelope`:

```typescript
type ClientEnvelope =
  | { type: "authenticate"; payload: AuthenticatePayload }
  | { type: "command"; payload: CommandPayload }
  | { type: "subscribe"; payload: SubscribePayload }
  | { type: "cancel_run"; payload: CancelRunPayload }
  | { type: "panic_stop_all"; payload: PanicStopAllPayload };

interface AuthenticatePayload {
  protocol_version: 8;
  client_nonce_hex: string;
  client_kind: "desktop_shell" | "headless_cli" | "integration_test";
  client_hmac_sha256_hex: string;
}

interface CommandPayload {
  request_id: string; // Client-generated ULID for idempotency
  project_id?: string;
  cmd: EngineCommand;
}

interface SubscribePayload {
  project_id: string;
  last_seen_seq: number; // For monotonic event playback
}

interface CancelRunPayload {
  project_id: string;
  run_id: string;
  reason: string;
}

interface PanicStopAllPayload {
  reason: string;
}
```

---

## 3. The 37 Canonical `EngineCommand` Variants

```typescript
type EngineCommand =
  // 1. Project Lifecycle & Management
  | { cmd: "project_open"; args: { root_path: string } }
  | { cmd: "project_set_trust"; args: { trust_state: "trusted" | "restricted"; trusted_config_hash?: string } }
  | { cmd: "project_update_settings"; args: { autonomy_ceiling?: AutonomyMode; model_slot_overrides_json?: string; budget_daily_micro_usd?: number; budget_monthly_micro_usd?: number } }
  | { cmd: "project_export_archive"; args: { dest_path: string } }
  | { cmd: "project_crypto_shred"; args: { confirm_slug: string } }
  | { cmd: "project_garbage_collect"; args: { prune_worktrees: boolean } }

  // 2. Messaging & Communication
  | { cmd: "message_post"; args: { channel_id?: string; thread_id?: string; dm_id?: string; content_md: string; mentions: string[]; autonomy_override?: AutonomyMode; model_override?: string } }
  | { cmd: "channel_create"; args: { slug: string; name: string; topic: string } }
  | { cmd: "channel_archive"; args: { channel_id: string } }
  | { cmd: "direct_message_open"; args: { target_agent_id: string } }

  // 3. Autonomous Meetings
  | { cmd: "meeting_start"; args: { channel_id: string; agenda: string; participants: string[]; mode: "moderated" | "round_robin" | "debate" | "design_review"; max_rounds: number } }

  // 4. Goals & Tasks DAG
  | { cmd: "goal_mutate"; args: { op: GoalMutateOp; goal_id?: string; parent_goal_id?: string; title?: string; description_md?: string; budget_micro_usd_max?: number; decision_record_md?: string } }
  | { cmd: "task_mutate"; args: { task_id: string; expected_epoch: number; mutation: TaskMutation } }

  // 5. Workforce & Recruitment
  | { cmd: "agent_hire"; args: { template_slug: string; slug: string; purpose: string; custom_charter_md?: string; owned_globs: string[] } }
  | { cmd: "agent_update_contract"; args: { agent_id: string; system_prompt?: string; model_override?: string; owned_globs?: string[] } }

  // 6. Scheduling & Automations
  | { cmd: "schedule_mutate"; args: { op: ScheduleMutateOp; schedule_id?: string; name?: string; trigger_kind?: "cron" | "interval" | "event"; cron_expr?: string; target_agent_id?: string; target_channel_id?: string; enabled?: boolean } }

  // 7. Context & Cognitive Memory
  | { cmd: "context_compact"; args: { context_key: string; target_level: number } }
  | { cmd: "memory_write"; args: { tier: "T1" | "T2" | "T3" | "T4"; scope_id: string; bank: "world" | "experience" | "opinion" | "procedure"; subject_key: string; claim_text: string } }
  | { cmd: "memory_review_resolve"; args: { memory_id: string; approve: boolean } }
  | { cmd: "privacy_purge_entity"; args: { entity_kind: "message" | "run" | "run_step" | "tool_call" | "memory_item"; entity_id: string } }

  // 8. Interactive Process & Browser Takeover
  | { cmd: "pty_control"; args: { pty_id: string; input?: string; kill: boolean } }
  | { cmd: "browser_takeover_resolve"; args: { run_id: string; action: "hand_back_to_agent" | "abort_run" } }

  // 9. Governance, Approvals & Recovery
  | { cmd: "approval_resolve"; args: { approval_id: string; decision: "approve_once" | "approve_session" | "approve_rule" | "deny"; remember_rule_glob?: string } }
  | { cmd: "recovery_resolve"; args: { run_id: string; tool_call_id: string; resolution: "retry" | "mark_succeeded" | "abort" } }

  // 10. Worktrees & Code Review
  | { cmd: "worktree_create"; args: { base_ref: string } }
  | { cmd: "worktree_discard"; args: { worktree_id: string } }
  | { cmd: "lane_enqueue_merge"; args: { lane_id: string; priority: number } }
  | { cmd: "lane_revert_apply"; args: { apply_journal_id: string } }
  | { cmd: "lane_unfreeze"; args: { lane_id: string; expected_mutation_epoch: number; reason: string } }
  | { cmd: "diff_inspect"; args: { worktree_id: string } }

  // 11. Cryptographic Audit Ledger
  | { cmd: "ledger_verify_chain"; args: { from_seq: number; to_seq?: number } }

  // 12. Extensibility, MCP & Skills
  | { cmd: "mcp_integration_mutate"; args: { op: McpMutateOp; integration_id?: string; slug: string; preset_slug?: string; transport?: "stdio" | "streamable_http"; access_mode?: "read_only" | "write_enabled"; enabled?: boolean; pinned_schema_sha256?: string } }
  | { cmd: "mcp_inspect_schema"; args: { slug: string } }
  | { cmd: "extension_package_mutate"; args: { op: "install" | "enable" | "disable" | "uninstall"; package_id?: string; category: "integration" | "plugin" | "skill" | "workflow_pack"; slug: string; version_semver?: string; enabled?: boolean } }
  | { cmd: "workflow_pack_start"; args: { workflow_slug: string; channel_id: string; input_params_json: string } }
  | { cmd: "skill_benchmark_run"; args: { skill_slug: string } }

  // 13. System Telemetry & Status
  | { cmd: "system_status_get"; args: {} };
```

---

## 4. Server Frame (`ServerFrame`) & Event Stream

Responses and streaming updates from server to client use the `ServerFrame` structure:

```typescript
type ServerFrame =
  | { kind: "hello_challenge"; data: HelloChallengeData }
  | { kind: "authenticated_ack"; data: AuthenticatedAckData }
  | { kind: "project_snapshot"; data: ProjectSnapshotData }
  | { kind: "command_result"; data: CommandResultData }
  | { kind: "event_batch"; data: EventBatchData }
  | { kind: "stream_coalesced"; data: StreamCoalescedData };

interface HelloChallengeData {
  protocol_version: 8;
  server_nonce_hex: string;
  challenge_issued_at_us: number;
  engine_instance_ulid: string;
}

interface AuthenticatedAckData {
  engine_version: string;
  sandbox_level: "S0" | "S1" | "S2" | "S3";
  server_hmac_sha256_hex: string;
}

interface ProjectSnapshotData {
  project_id: string;
  snapshot_seq: number;
  state_json: string; // Instant UI hydration payload (<150ms switch)
}

interface CommandResultData {
  request_id: string;
  result:
    | { ok: true; ack_kind: string; data?: any }
    | { ok: false; error: KinWireError };
}

interface EventBatchData {
  project_id: string;
  first_seq: number;
  last_seq: number;
  events: ProjectEvent[];
}

interface StreamCoalescedData {
  project_id: string;
  run_id: string;
  step_id: string;
  text_delta: string;
  thinking_delta: string;
  resync_required: boolean;
}
```

### 4.1 The 17 Canonical `ProjectEvent` Variants
1. `agent_hired`: New specialist coworker registered.
2. `channel_created`: New communication channel opened.
3. `message_posted`: New chat, DM, or announcement message delivered.
4. `run_started`: Agent execution run launched in a worktree lane.
5. `run_step_advanced`: Agent completed a reasoning step and generated tokens.
6. `tool_call_emitted`: Agent initiated a tool execution.
7. `tool_call_completed`: Tool returned execution results.
8. `approval_requested`: High-risk tool paused for operator consent.
9. `approval_resolved`: Operator approved or denied an approval request.
10. `takeover_requested`: Browser tool surfaced a human takeover banner.
11. `task_mutated`: DAG task changed state, claimed, or completed.
12. `goal_mutated`: High-level goal updated or completed.
13. `meeting_started`: Multi-agent conference convened.
14. `meeting_concluded`: Conference concluded with binding Decision Record.
15. `schedule_triggered`: Recurring cron or timer awakened an agent.
16. `memory_written`: New Tier 1-4 knowledge claim persisted.
17. `lane_merged`: Worktree diff verified and applied to main project root.

---

## 5. Closed 63-Code Error Taxonomy (`KinError`)

Every error returned over IPC adheres strictly to this closed taxonomy, categorized by subsystem, with explicit retry semantics:

| Error Code | Canonical Identifier | Category | Retryable | User-Facing Explanation |
| :--- | :--- | :--- | :---: | :--- |
| **KIN-AGT-0001** | `AgentHierarchyInvalid` | Validation | No | Parent agent cycle or spawn depth exceeded (>2). |
| **KIN-AGT-0002** | `AgentNotFound` | Storage | No | Target agent does not exist in this project. |
| **KIN-AGT-0003** | `AgentCapExceeded` | Conflict | No | Project workforce cap (24 agents) has been reached. |
| **KIN-BLB-0001** | `BlobReferencedCannotDelete` | Storage | No | Content-addressed blob is still referenced by tool logs. |
| **KIN-COM-0001** | `DmParticipantOrTaskInvalid` | Validation | No | DM participants must be distinct and follow canonical ordering. |
| **KIN-COM-0002** | `AgentReferencedByDmCannotDelete` | Conflict | No | Agent cannot be uninstalled while active DM history exists. |
| **KIN-COM-0003** | `TaskReferencedByDmCannotDelete` | Conflict | No | Task cannot be purged while referenced in active threads. |
| **KIN-COM-0004** | `PingPongCircuitBreakerTripped` | Policy | No | 4 consecutive agent DM turns without file/task progress. Escalated to @boss. |
| **KIN-EGR-0001** | `EgressHostNotAllowed` | Policy | No | Target host is not on the project-approved egress allowlist. |
| **KIN-EGR-0002** | `DnsResolutionFailed` | Gateway | Yes | Outbound hostname could not be resolved by local DNS resolver. |
| **KIN-EGR-0003** | `DnsRebindingDetected` | Policy | No | DNS resolved to public IP on first query, private IP on second. |
| **KIN-EGR-0004** | `SsrfBlockedIpRange` | Policy | No | Egress blocked: target IP belongs to RFC 1918 or link-local range. |
| **KIN-EGR-0005** | `RedirectTargetForbidden` | Policy | No | HTTP 3xx redirect targeted an unapproved or internal endpoint. |
| **KIN-EGR-0006** | `ProxyAuthInvalid` | Auth | No | Corporate HTTP proxy rejected credentials. |
| **KIN-EXT-0001** | `IntegrationWriteBlockedInReadOnlyMode` | Policy | No | MCP tool attempted write operation while configured in read-only mode. |
| **KIN-EXT-0002** | `ExtensionPrivilegeEscalationDenied` | Policy | No | Extension requested permissions exceeding its declared manifest. |
| **KIN-EXT-0003** | `ExtensionRevokedOrSecurityFlagged` | Policy | No | Extension has been quarantined or cryptographically revoked. |
| **KIN-EXT-0004** | `McpIntegrationQuarantinedOrRevoked` | Policy | No | MCP server has an unverified schema modification. |
| **KIN-EVT-0001** | `ProjectEventsImmutable` | Storage | No | Attempted mutation of append-only event stream. |
| **KIN-EVT-0002** | `ProjectEventsAppendOnly` | Storage | No | Out-of-order sequence insertion in event journal. |
| **KIN-HIS-0001** | `MessagesArchiveAppendOnly` | Storage | No | Messages archive cannot be modified out-of-order. |
| **KIN-HIS-0002** | `MessagesColumnsImmutable` | Storage | No | Sent message content cannot be modified or tampered with. |
| **KIN-HIS-0003** | `RunStepsArchiveAppendOnly` | Storage | No | Run step journal must advance monotonically. |
| **KIN-HIS-0004** | `RunStepsFinalizedImmutable` | Storage | No | Finalized reasoning step tokens cannot be altered. |
| **KIN-HIS-0005** | `ToolCallsArchiveAppendOnly` | Storage | No | Tool calls cannot be inserted retroactively. |
| **KIN-HIS-0006** | `ToolCallsIntentImmutable` | Storage | No | Tool input arguments cannot be changed after invocation. |
| **KIN-HRN-0001** | `ModelProviderTimeout` | Gateway | Yes | Upstream LLM gateway failed to respond within configured timeout. |
| **KIN-HRN-0002** | `ModelRateLimitExceeded` | Gateway | Yes | Upstream LLM provider returned HTTP 429 rate limit. |
| **KIN-HRN-0003** | `ModelContextWindowExceeded` | Gateway | No | Combined prompt and completion exceeded provider context limit. |
| **KIN-HRN-0004** | `ModelInvalidResponseJson` | Gateway | Yes | Model output was expected to be JSON but failed parsing. |
| **KIN-HRN-0008** | `DuplicateToolCallBlocked` | Policy | No | Agent attempted identical tool call arguments in the same step. |
| **KIN-HRN-0009** | `LoopCircuitBreakerTripped` | Policy | No | Agent repeated identical actions 3 times without progress. |
| **KIN-HRN-0010** | `ParentRunTerminated` | Policy | No | Operation aborted because the parent agent run was cancelled. |
| **KIN-HRN-0011** | `BudgetExceeded` | Policy | No | Project daily or monthly spend limit reached. |
| **KIN-HRN-0012** | `MaxStepsReached` | Policy | No | Run reached the maximum allowable step count (default: 30). |
| **KIN-LDG-0001** | `LedgerEventsAppendOnly` | Storage | No | Immutable audit ledger cannot accept backdated events. |
| **KIN-LDG-0002** | `LedgerEventsEnvelopeImmutable` | Storage | No | Audit ledger envelope fields cannot be updated. |
| **KIN-LDG-0003** | `LedgerPayloadsContentImmutable` | Storage | No | Audit ledger payloads cannot be modified. |
| **KIN-LDG-0004** | `LedgerCheckpointsImmutable` | Storage | No | Cryptographic checkpoints cannot be updated. |
| **KIN-LDG-0005** | `LedgerCheckpointsAppendOnly` | Storage | No | Checkpoints must follow sequential sequence numbers. |
| **KIN-LDG-0006** | `LedgerChainDiscontinuity` | Storage | No | Cryptographic chain verification failed: BLAKE3 hash mismatch. |
| **KIN-LDG-0007** | `LedgerPurgeReceiptMissing` | Storage | No | GDPR/privacy purge failed to produce a signed audit receipt. |
| **KIN-POL-0001** | `AutonomyCeilingBlocked` | Policy | No | Action requires higher autonomy mode than current project setting. |
| **KIN-POL-0002** | `UntrustedWorkspaceBlocked` | Policy | No | Tool execution blocked: project is in untrusted restricted mode. |
| **KIN-POL-0009** | `LiteralVaultSecretInToolArgs` | Policy | No | Literal API key detected in tool arguments. Use handle instead. |
| **KIN-POL-0010** | `ApprovalRequestAlreadyResolved` | Conflict | No | Approval request has already been approved or denied. |
| **KIN-PTC-0001** | `PatchEmptySearchBlock` | Validation | No | Patch search block cannot be empty. |
| **KIN-PTC-0002** | `PatchAmbiguousMatch` | Validation | No | Patch search block matches multiple locations in the file. |
| **KIN-PTC-0003** | `PatchNoMatchFound` | Validation | No | Search block does not match file contents across all 4 tiers. |
| **KIN-SEC-0010** | `TaintedRunMessageMustSetTaint` | Policy | No | Message from tainted run failed to propagate taint flag. |
| **KIN-SEC-0011** | `TaintedSourceWakeMustSetTaint` | Policy | No | Wake event originating from tainted data must inherit taint. |
| **KIN-SEC-0012** | `TaintedParentOrWakeRunMustSetTaint`| Policy | No | Run spawned by tainted parent must inherit taint. |
| **KIN-SEC-0013** | `RunsMonotonicAndLineageImmutable` | Storage | No | Run lineage and parent links cannot be reassigned. |
| **KIN-SEC-0014** | `TaintedRunTaskMustSetTaint` | Policy | No | Task mutated by tainted agent must inherit taint. |
| **KIN-SEC-0015** | `TasksTaintMonotonic` | Storage | No | Taint flag on a task cannot be cleared once set. |
| **KIN-SEC-0016** | `WakeQueueTaintMonotonic` | Storage | No | Coalesced wake events must preserve taint flag. |
| **KIN-SEC-0017** | `TaintedMemoryWriteMustQuarantine`| Policy | No | Knowledge extracted from tainted sources must be quarantined. |
| **KIN-SEC-0018** | `QuarantinedMemoryRequiresHumanTrust`| Policy | No | Quarantined memory cannot be unquarantined without human review. |
| **KIN-STR-0001** | `DatabaseLocked` | Storage | Yes | SQLite database busy timeout exceeded (5000ms). |
| **KIN-STR-0008** | `DiskSpaceLow` | Storage | No | Available disk space is below safety threshold (<256 MiB). |
| **KIN-TSK-0001** | `TaskDagCycleDetected` | Validation | No | Dependency addition would introduce a circular cycle into the DAG. |
| **KIN-TSK-0002** | `TaskDependenciesImmutable` | Storage | No | Task dependencies cannot be modified while task is in progress. |
| **KIN-TSK-0004** | `TaskLeaseEpochMonotonic` | Conflict | Yes | Lease epoch outdated: another agent updated this task. |
| **KIN-TSK-0005** | `TaskInvalidStateTransition` | Validation | No | Illegal state transition (e.g., pending directly to completed). |
| **KIN-TSK-0006** | `TaskUnfinishedDependency` | Conflict | No | Task cannot be claimed while prerequisite tasks remain incomplete. |
| **KIN-WKT-0001** | `WorktreeLaneFrozenOrTerminal` | Git | No | Worktree is frozen pending operator conflict resolution. |
| **KIN-WKT-0003** | `ApplyJournalInvalidTransition` | Git | No | Apply record cannot be reverted because it was already reverted. |
