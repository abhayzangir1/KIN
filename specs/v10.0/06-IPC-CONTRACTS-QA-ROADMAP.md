# DOC-06: Complete Typed IPC Contracts, Rust Reference Implementations, QA/Chaos Harness & 6-Engineer Roadmap

| Field | Value |
| :--- | :--- |
| **Document ID** | KIN-DOC-06 (`06-IPC-CONTRACTS-QA-ROADMAP.md`) |
| **Suite Version** | `10.0.0-PRODUCTION` |
| **Status** | **Canonical Specification & Reference Contract Bundle** |
| **Scope** | Complete `specta` IPC Wire Contracts including `ProjectSnapshot`, Slash-Command & MCP/Extension Variants (`ST-27`, `RT4-23`, `RT4-24`, `RT10-08`), Closed 54-Code `KinError` Enum (`RT9-12`, `RT10-08`), Production Rust Reference Code (Zero `unwrap`/`expect`, Batch Pre-Marking `RT4-16`, Universal `KIN-POL-0009` Guard `RT4-18`, 3-Strike Completion Gate `ST-13`/`RT4-20`/`RT9-08`, 4-Tier `fs_patch` `RT6-10`, and `KinDnsResolver` + Adversarial IPv4/IPv6 SSRF Filter `RT4-17`/`RT9-09`), 200-Test Verification & VCR QA Pyramid (`ST-37`, `RT11-10`), and 6-Engineer 24-Week Roadmap (`M0`–`M12`) |

## 1. Complete Strongly Typed IPC Contracts & Error Taxonomy (`crates/kin-proto` & `crates/kin-error`)

### 1.1 Strongly Typed IPC Wire Envelopes & Commands (`crates/kin-proto/src/lib.rs`, Fixing `ST-27`, `RT4-23`, `RT4-24` & `RT10-08`)

All IPC frames use UTF-8 JSON inside the 16-byte `KIN8` binary header (DOC-02 §1.3). Every type below derives `Serialize`, `Deserialize`, and `specta::Type`:

```rust
// crates/kin-proto/src/lib.rs
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ClientKind { DesktopShell, HeadlessCli, IntegrationTest }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TrustState { Untrusted, Trusted, Restricted }

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutonomyMode { ReadOnly, WorktreeAuto, Auto, FullAccess }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum SandboxLevel { S0, S1, S2, S3 }

// Fixed RT12-05: Canonical 15-state RunStatus enum matching Build Rule 1, runs.status CHECK, and DOC-03 §2.1
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Preparing,
    StreamingModel,
    EvaluatingPolicy,
    WaitingApproval,
    WaitingTakeover,
    WaitingSubagent,
    WaitingRecovery,
    ExecutingTools,
    VerifyingCompletion,
    Compacting,
    Completed,
    Cancelled,
    Failed,
    BudgetExceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MeetingMode { Moderated, RoundRobin, Debate, DesignReview }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision { ApproveOnce, ApproveSession, ApproveRule, Deny }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TakeoverAction { HandBackToAgent, AbortRun }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum McpAccessMode { ReadOnly, WriteEnabled }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionCategory { Integration, Plugin, Skill, WorkflowPack }

// Fixed Cross-Doc Audit Finding 15: Closed strongly-typed enums for all IPC mutation ops, triggers, transports, memory tiers/banks, privacy kinds, and crash recovery resolutions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum GoalMutateOp { Create, Update, Activate, Complete, Pause, Cancel, MeetingStart, MeetingConclude }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleMutateOp { Create, Update, Enable, Disable, TriggerNow, Delete }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleTriggerKind { Cron, Interval, Event }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MemoryTier { T1, T2, T3, T4 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MemoryBank { World, Experience, Opinion, Procedure }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyEntityKind { Message, Run, RunStep, ToolCall, MemoryItem }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryResolution { Retry, MarkSucceeded, Abort }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum McpMutateOp { Register, Update, Enable, Disable, ApproveSchema, Quarantine, Revoke, Remove }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum McpTransport { Stdio, StreamableHttp }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionMutateOp { Install, Enable, Disable, Uninstall }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TaskVerificationMode { None, SelfAttested, Checks, Reviewer, Human }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum TaskMutation {
    Create { title: String, description_md: String, goal_id: Option<String>, depends_on: Vec<String>, verification_mode: TaskVerificationMode },
    Claim { run_id: String },
    Checkpoint { result_summary_md: String },
    Complete { result_summary_md: String },
    ReviewApprove { reviewer_agent_id: String },
    Fail { blocker_reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum ClientEnvelope {
    Authenticate {
        protocol_version: u16,
        client_nonce_hex: String,
        client_kind: ClientKind,
        client_hmac_sha256_hex: String,
    },
    Command { request_id: String, project_id: Option<String>, cmd: EngineCommand },
    Subscribe { project_id: String, last_seen_seq: u64 },
    CancelRun { project_id: String, run_id: String, reason: String },
    PanicStopAll { reason: String },
}

// Fixed RT4-24 & Audit Findings 14, 15, 16: Complete strongly-typed EngineCommand variants covering all UI slash commands and Runbook CLI commands
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "cmd", content = "args", rename_all = "snake_case")]
pub enum EngineCommand {
    ProjectOpen { root_path: String },
    ProjectSetTrust { trust_state: TrustState, trusted_config_hash: Option<String> },
    ProjectUpdateSettings {
        autonomy_ceiling: Option<AutonomyMode>,
        model_slot_overrides_json: Option<String>,
        budget_daily_micro_usd: Option<i64>,
        budget_monthly_micro_usd: Option<i64>,
    },
    ProjectExportArchive { dest_path: String },
    ProjectCryptoShred { confirm_slug: String },
    ProjectGarbageCollect { prune_worktrees: bool },
    MessagePost {
        channel_id: Option<String>,
        thread_id: Option<String>,
        dm_id: Option<String>,
        content_md: String,
        mentions: Vec<String>,
        autonomy_override: Option<AutonomyMode>,
        model_override: Option<String>,
    },
    MeetingStart { channel_id: String, agenda: String, participants: Vec<String>, mode: MeetingMode, max_rounds: u8 },
    GoalMutate {
        op: GoalMutateOp,
        goal_id: Option<String>,
        parent_goal_id: Option<String>,
        title: Option<String>,
        description_md: Option<String>,
        budget_micro_usd_max: Option<i64>,
        meeting_id: Option<String>,
        decision_record_md: Option<String>,
    },
    AgentHire {
        template_slug: String,
        slug: String,
        purpose: String,
        custom_charter_md: Option<String>,
        owned_globs: Vec<String>,
    },
    ScheduleMutate {
        op: ScheduleMutateOp,
        schedule_id: Option<String>,
        name: Option<String>,
        trigger_kind: Option<ScheduleTriggerKind>,
        cron_expr: Option<String>,
        target_agent_id: Option<String>,
        target_channel_id: Option<String>,
        enabled: Option<bool>,
    },
    ContextCompact { context_key: String, target_level: u8 },
    MemoryWrite {
        tier: MemoryTier,
        scope_id: String,
        bank: MemoryBank,
        subject_key: String,
        claim_text: String,
    },
    PtyControl { pty_id: String, input: Option<String>, kill: bool },
    ApprovalResolve { approval_id: String, decision: ApprovalDecision, remember_rule_glob: Option<String> },
    BrowserTakeoverResolve { run_id: String, action: TakeoverAction },
    RecoveryResolve { run_id: String, tool_call_id: String, resolution: RecoveryResolution },
    LaneEnqueueMerge { lane_id: String, priority: u8 },
    LaneRevertApply { apply_journal_id: String },
    LaneUnfreeze { lane_id: String, expected_mutation_epoch: u64, reason: String },
    TaskMutate { task_id: String, expected_epoch: u64, mutation: TaskMutation },
    MemoryReviewResolve { memory_id: String, approve: bool },
    PrivacyPurgeEntity { entity_kind: PrivacyEntityKind, entity_id: String },
    LedgerVerifyChain { from_seq: u64, to_seq: Option<u64> },
    McpIntegrationMutate {
        op: McpMutateOp,
        integration_id: Option<String>,
        slug: String,
        preset_slug: Option<String>,
        transport: Option<McpTransport>,
        access_mode: Option<McpAccessMode>,
        enabled: Option<bool>,
        pinned_schema_sha256: Option<String>,
    },
    McpInspectSchema { slug: String },
    ExtensionPackageMutate {
        op: ExtensionMutateOp,
        package_id: Option<String>,
        category: ExtensionCategory,
        slug: String,
        version_semver: Option<String>,
        enabled: Option<bool>,
    },
    WorkflowPackStart {
        workflow_slug: String,
        channel_id: String,
        input_params_json: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "ack_kind", content = "data", rename_all = "snake_case")]
pub enum CommandAck {
    Accepted { entity_id: String, seq: u64 },
    LedgerVerified { verified_events: u64, head_blake3: String },
    GarbageCollected { pruned_worktrees: u32, unlinked_blobs: u32, wal_truncated_bytes: u64 },
    McpSchemaInspection { slug: String, pinned_schema_sha256: Option<String>, live_schema_sha256: String, schema_diff_json: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProjectEvent {
    pub seq: u64,
    pub id: String,
    pub ts_us: i64,
    pub event_kind: String,
    pub entity_id: String,
    pub payload_json: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory { Auth, Policy, Storage, Git, Sandbox, Gateway, Validation, Conflict }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct KinWireError {
    pub code: String,
    pub category: ErrorCategory,
    pub message: String,
    pub retryable: bool,
}

// Fixed RT4-23: Includes ProjectSnapshot for < 150ms project switching (INV-009, PRD-PRJ-003)
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ServerFrame {
    HelloChallenge {
        protocol_version: u16,
        server_nonce_hex: String,
        challenge_issued_at_us: i64,
        engine_instance_ulid: String,
    },
    AuthenticatedAck {
        engine_version: String,
        sandbox_level: SandboxLevel,
        server_hmac_sha256_hex: String,
    },
    ProjectSnapshot {
        project_id: String,
        snapshot_seq: u64,
        state_json: String,
    },
    CommandResult { request_id: String, result: Result<CommandAck, KinWireError> },
    EventBatch {
        project_id: String,
        first_seq: u64,
        last_seq: u64,
        events: Vec<ProjectEvent>,
    },
    StreamCoalesced {
        project_id: String,
        run_id: String,
        step_id: String,
        text_delta: String,
        thinking_delta: String,
        resync_required: bool,
    },
}
```

### 1.2 Canonical Closed `KinError` Taxonomy (`crates/kin-error/src/lib.rs`, Fixing `RT9-12`)

```rust
// crates/kin-error/src/lib.rs — Closed Error Taxonomy (Build Rule 4, matching DOC-00 §5 1-to-1)
use kin_proto::{ErrorCategory, KinWireError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KinError {
    AgentHierarchyInvalid,               // KIN-AGT-0001
    BlobReferencedCannotDelete,          // KIN-BLB-0001
    DmParticipantOrTaskInvalid,          // KIN-COM-0001
    AgentReferencedByDmCannotDelete,     // KIN-COM-0002
    TaskReferencedByDmCannotDelete,      // KIN-COM-0003
    SsrfBlockedIpRange,                  // KIN-EGR-0004
    RedirectTargetForbidden,             // KIN-EGR-0005
    ProxyAuthInvalid,                    // KIN-EGR-0006
    IntegrationWriteBlockedInReadOnlyMode, // KIN-EXT-0001
    ExtensionPrivilegeEscalationDenied,  // KIN-EXT-0002
    ExtensionRevokedOrSecurityFlagged,   // KIN-EXT-0003
    McpIntegrationQuarantinedOrRevoked,  // KIN-EXT-0004
    ProjectEventsImmutable,              // KIN-EVT-0001
    ProjectEventsAppendOnly,             // KIN-EVT-0002
    MessagesArchiveAppendOnly,           // KIN-HIS-0001
    MessagesColumnsImmutable,            // KIN-HIS-0002
    RunStepsArchiveAppendOnly,           // KIN-HIS-0003
    RunStepsFinalizedImmutable,          // KIN-HIS-0004
    ToolCallsArchiveAppendOnly,          // KIN-HIS-0005
    ToolCallsIntentImmutable,            // KIN-HIS-0006
    DuplicateToolCallBlocked,            // KIN-HRN-0008
    LoopCircuitBreakerTripped,           // KIN-HRN-0009
    ParentRunTerminated,                 // KIN-HRN-0010
    BudgetExceeded,                      // KIN-HRN-0011
    MaxStepsReached,                     // KIN-HRN-0012
    LedgerEventsAppendOnly,              // KIN-LDG-0001
    LedgerEventsEnvelopeImmutable,       // KIN-LDG-0002
    LedgerPayloadsContentImmutable,      // KIN-LDG-0003
    LedgerCheckpointsImmutable,          // KIN-LDG-0004
    LedgerCheckpointsAppendOnly,         // KIN-LDG-0005
    LedgerChainDiscontinuity,            // KIN-LDG-0006
    LedgerPurgeReceiptMissing,           // KIN-LDG-0007
    LiteralVaultSecretInToolArgs,        // KIN-POL-0009
    ApprovalRequestAlreadyResolved,      // KIN-POL-0010
    PatchEmptySearchBlock,               // KIN-PTC-0001
    PatchAmbiguousMatch { tier: u8 },    // KIN-PTC-0002
    PatchNoMatchFound,                   // KIN-PTC-0003
    TaintedRunMessageMustSetTaint,       // KIN-SEC-0010
    TaintedSourceWakeMustSetTaint,       // KIN-SEC-0011
    TaintedParentOrWakeRunMustSetTaint,  // KIN-SEC-0012
    RunsMonotonicAndLineageImmutable,    // KIN-SEC-0013
    TaintedRunTaskMustSetTaint,          // KIN-SEC-0014
    TasksTaintMonotonic,                 // KIN-SEC-0015
    WakeQueueTaintMonotonic,             // KIN-SEC-0016
    TaintedMemoryWriteMustQuarantine,    // KIN-SEC-0017
    QuarantinedMemoryRequiresHumanTrust, // KIN-SEC-0018
    DiskSpaceLow,                        // KIN-STR-0008
    TaskDagCycleDetected,                // KIN-TSK-0001
    TaskDependenciesImmutable,           // KIN-TSK-0002
    TaskLeaseEpochMonotonic,             // KIN-TSK-0004
    TaskInvalidStateTransition,          // KIN-TSK-0005
    TaskUnfinishedDependency,            // KIN-TSK-0006
    WorktreeLaneFrozenOrTerminal,        // KIN-WKT-0001
    ApplyJournalInvalidTransition,       // KIN-WKT-0003
}

impl KinError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::AgentHierarchyInvalid => "KIN-AGT-0001",
            Self::BlobReferencedCannotDelete => "KIN-BLB-0001",
            Self::DmParticipantOrTaskInvalid => "KIN-COM-0001",
            Self::AgentReferencedByDmCannotDelete => "KIN-COM-0002",
            Self::TaskReferencedByDmCannotDelete => "KIN-COM-0003",
            Self::SsrfBlockedIpRange => "KIN-EGR-0004",
            Self::RedirectTargetForbidden => "KIN-EGR-0005",
            Self::ProxyAuthInvalid => "KIN-EGR-0006",
            Self::IntegrationWriteBlockedInReadOnlyMode => "KIN-EXT-0001",
            Self::ExtensionPrivilegeEscalationDenied => "KIN-EXT-0002",
            Self::ExtensionRevokedOrSecurityFlagged => "KIN-EXT-0003",
            Self::McpIntegrationQuarantinedOrRevoked => "KIN-EXT-0004",
            Self::ProjectEventsImmutable => "KIN-EVT-0001",
            Self::ProjectEventsAppendOnly => "KIN-EVT-0002",
            Self::MessagesArchiveAppendOnly => "KIN-HIS-0001",
            Self::MessagesColumnsImmutable => "KIN-HIS-0002",
            Self::RunStepsArchiveAppendOnly => "KIN-HIS-0003",
            Self::RunStepsFinalizedImmutable => "KIN-HIS-0004",
            Self::ToolCallsArchiveAppendOnly => "KIN-HIS-0005",
            Self::ToolCallsIntentImmutable => "KIN-HIS-0006",
            Self::DuplicateToolCallBlocked => "KIN-HRN-0008",
            Self::LoopCircuitBreakerTripped => "KIN-HRN-0009",
            Self::ParentRunTerminated => "KIN-HRN-0010",
            Self::BudgetExceeded => "KIN-HRN-0011",
            Self::MaxStepsReached => "KIN-HRN-0012",
            Self::LedgerEventsAppendOnly => "KIN-LDG-0001",
            Self::LedgerEventsEnvelopeImmutable => "KIN-LDG-0002",
            Self::LedgerPayloadsContentImmutable => "KIN-LDG-0003",
            Self::LedgerCheckpointsImmutable => "KIN-LDG-0004",
            Self::LedgerCheckpointsAppendOnly => "KIN-LDG-0005",
            Self::LedgerChainDiscontinuity => "KIN-LDG-0006",
            Self::LedgerPurgeReceiptMissing => "KIN-LDG-0007",
            Self::LiteralVaultSecretInToolArgs => "KIN-POL-0009",
            Self::ApprovalRequestAlreadyResolved => "KIN-POL-0010",
            Self::PatchEmptySearchBlock => "KIN-PTC-0001",
            Self::PatchAmbiguousMatch { .. } => "KIN-PTC-0002",
            Self::PatchNoMatchFound => "KIN-PTC-0003",
            Self::TaintedRunMessageMustSetTaint => "KIN-SEC-0010",
            Self::TaintedSourceWakeMustSetTaint => "KIN-SEC-0011",
            Self::TaintedParentOrWakeRunMustSetTaint => "KIN-SEC-0012",
            Self::RunsMonotonicAndLineageImmutable => "KIN-SEC-0013",
            Self::TaintedRunTaskMustSetTaint => "KIN-SEC-0014",
            Self::TasksTaintMonotonic => "KIN-SEC-0015",
            Self::WakeQueueTaintMonotonic => "KIN-SEC-0016",
            Self::TaintedMemoryWriteMustQuarantine => "KIN-SEC-0017",
            Self::QuarantinedMemoryRequiresHumanTrust => "KIN-SEC-0018",
            Self::DiskSpaceLow => "KIN-STR-0008",
            Self::TaskDagCycleDetected => "KIN-TSK-0001",
            Self::TaskDependenciesImmutable => "KIN-TSK-0002",
            Self::TaskLeaseEpochMonotonic => "KIN-TSK-0004",
            Self::TaskInvalidStateTransition => "KIN-TSK-0005",
            Self::TaskUnfinishedDependency => "KIN-TSK-0006",
            Self::WorktreeLaneFrozenOrTerminal => "KIN-WKT-0001",
            Self::ApplyJournalInvalidTransition => "KIN-WKT-0003",
        }
    }

    pub const fn category(&self) -> ErrorCategory {
        match self {
            Self::ProxyAuthInvalid => ErrorCategory::Auth,
            Self::SsrfBlockedIpRange
            | Self::RedirectTargetForbidden
            | Self::IntegrationWriteBlockedInReadOnlyMode
            | Self::ExtensionPrivilegeEscalationDenied
            | Self::ExtensionRevokedOrSecurityFlagged
            | Self::McpIntegrationQuarantinedOrRevoked
            | Self::BudgetExceeded
            | Self::MaxStepsReached
            | Self::LedgerPurgeReceiptMissing
            | Self::LiteralVaultSecretInToolArgs
            | Self::ApprovalRequestAlreadyResolved
            | Self::TaintedRunMessageMustSetTaint
            | Self::TaintedSourceWakeMustSetTaint
            | Self::TaintedParentOrWakeRunMustSetTaint
            | Self::RunsMonotonicAndLineageImmutable
            | Self::TaintedRunTaskMustSetTaint
            | Self::TasksTaintMonotonic
            | Self::WakeQueueTaintMonotonic
            | Self::TaintedMemoryWriteMustQuarantine
            | Self::QuarantinedMemoryRequiresHumanTrust => ErrorCategory::Policy,
            Self::BlobReferencedCannotDelete
            | Self::ProjectEventsImmutable
            | Self::ProjectEventsAppendOnly
            | Self::MessagesArchiveAppendOnly
            | Self::MessagesColumnsImmutable
            | Self::RunStepsArchiveAppendOnly
            | Self::RunStepsFinalizedImmutable
            | Self::ToolCallsArchiveAppendOnly
            | Self::ToolCallsIntentImmutable
            | Self::LedgerEventsAppendOnly
            | Self::LedgerEventsEnvelopeImmutable
            | Self::LedgerPayloadsContentImmutable
            | Self::LedgerCheckpointsImmutable
            | Self::LedgerCheckpointsAppendOnly
            | Self::LedgerChainDiscontinuity
            | Self::DiskSpaceLow => ErrorCategory::Storage,
            Self::AgentHierarchyInvalid
            | Self::DmParticipantOrTaskInvalid
            | Self::PatchEmptySearchBlock
            | Self::PatchNoMatchFound
            | Self::TaskDagCycleDetected
            | Self::TaskDependenciesImmutable => ErrorCategory::Validation,
            Self::AgentReferencedByDmCannotDelete
            | Self::TaskReferencedByDmCannotDelete
            | Self::DuplicateToolCallBlocked
            | Self::LoopCircuitBreakerTripped
            | Self::ParentRunTerminated
            | Self::PatchAmbiguousMatch { .. }
            | Self::TaskLeaseEpochMonotonic
            | Self::TaskInvalidStateTransition
            | Self::TaskUnfinishedDependency
            | Self::WorktreeLaneFrozenOrTerminal
            | Self::ApplyJournalInvalidTransition => ErrorCategory::Conflict,
        }
    }

    pub const fn is_retryable(&self) -> bool {
        matches!(self, Self::DiskSpaceLow)
    }

    pub fn to_wire_error(&self, message: impl Into<String>) -> KinWireError {
        KinWireError {
            code: self.code().to_string(),
            category: self.category(),
            message: message.into(),
            retryable: self.is_retryable(),
        }
    }
}
```

## 2. Production Rust Reference Implementations (Zero `unwrap`/`expect`)

### 2.1 Reference Implementation: Batch Pre-Marking & Dual-AST Tool Dispatch (`crates/kin-harness/src/step_runner.rs`, Fixing `ST-13`, `ST-14`, `RT4-16` & `RT4-18`)

```rust
// Enforces INV-002 (Secret Handle Substitution), INV-004 (Two-Phase Ledger),
// INV-010 (Dual-AST Prose-Blind Policy), ST-13 (Async RwLock Read Permit),
// RT4-16 (Batch Pre-Marking of tainted & has_private_context), and RT4-18 (Universal KIN-POL-0009 Guard).

pub async fn evaluate_and_execute_step_batch(
    ctx: &RunExecutionContext,
    step_id: &StepId,
    proposed_calls: &[ProposedToolCall],
) -> Result<Vec<ToolStepOutcome>, KinError> {
    // Pre-Step Max-Steps Guard (HRN-STP-001, Fixing RT9-15): prevent SQLite CHECK(step_count <= max_steps) abort
    if ctx.step_count() >= ctx.max_steps() {
        ctx.store.mark_run_failed(&ctx.run_id, "KIN-HRN-0012", "Maximum run steps reached").await?;
        return Err(KinError::MaxStepsReached);
    }
    // Stage 0 (Fixing RT4-16): Compute batch_will_taint and batch_will_read_private_context
    // across ALL proposed tool calls in the batch BEFORE evaluating Stages 1-9 on any call.
    let batch_will_taint = proposed_calls.iter().any(|c| {
        matches!(c.name.as_str(), "web_search" | "web_fetch" | "browser_act") || c.is_untrusted_mcp()
    });
    let batch_will_read_private_context = proposed_calls.iter().any(|c| {
        matches!(
            c.name.as_str(),
            "fs_read" | "code_search" | "ast_symbols" | "memory_query" | "recall" | "spill_read" | "pty_read_ring"
        ) || c.has_secret_env_handles()
    });

    if batch_will_taint && !ctx.is_tainted() {
        ctx.store.mark_run_tainted(&ctx.run_id).await?;
        ctx.set_tainted_in_memory(true);
    }
    if batch_will_read_private_context && !ctx.has_private_context() {
        ctx.store.mark_run_has_private_context(&ctx.run_id).await?;
        ctx.set_has_private_context_in_memory(true);
    }

    let mut outcomes = Vec::with_capacity(proposed_calls.len());
    for raw_call in proposed_calls {
        let outcome = evaluate_and_execute_tool_call(ctx, step_id, raw_call).await?;
        outcomes.push(outcome);
    }
    Ok(outcomes)
}

pub async fn evaluate_and_execute_tool_call(
    ctx: &RunExecutionContext,
    step_id: &StepId,
    raw_call: &ProposedToolCall,
) -> Result<ToolStepOutcome, KinError> {
    // 1. Canonicalize raw arguments in zeroized memory and run SecretRedactor BEFORE any DB write (ST-14)
    let raw_jcs_secret = secrecy::SecretString::new(kin_crypto::jcs_canonicalize(&raw_call.arguments)?);
    let redaction_scan = ctx.secret_redactor.redact_jcs_str(&raw_jcs_secret)?;
    let args_redacted_jcs = redaction_scan.redacted_json;
    let args_blake3 = kin_crypto::blake3_hex(args_redacted_jcs.as_bytes());

    // 2. Evaluate 9-Stage Dual-AST Policy Pipeline (evaluates max(Risk(raw), Risk(redacted)))
    // Stage 1 inside policy_engine.evaluate enforces KIN-POL-0009 (DenyHardStop) whenever
    // contains_literal_vault_secret == true on ANY tool (including fs_write & fs_patch, Fixing RT4-18).
    let policy_input = PolicyEvaluationInput {
        project_id: ctx.project_id.clone(),
        agent_id: ctx.agent_id.clone(),
        run_id: ctx.run_id.clone(),
        tool_name: raw_call.name.as_str(),
        raw_args_jcs: &raw_jcs_secret,
        redacted_args_json: &args_redacted_jcs,
        contains_literal_vault_secret: redaction_scan.had_vault_secret,
        autonomy_effective: ctx.autonomy_effective,
        sandbox_level: ctx.sandbox_level,
        run_tainted: ctx.is_tainted(),
        has_private_context: ctx.has_private_context(),
    };
    let mut verdict = ctx.policy_engine.evaluate(&policy_input).await?;
    if redaction_scan.had_vault_secret {
        verdict.decision = PolicyDecision::DenyHardStop;
        verdict.risk_class = RiskClass::R5;
        verdict.rule_id = "KIN-POL-0009".to_string();
        verdict.explanation = "Literal vault secret detected in tool arguments; use secret_env_handles instead of writing or transmitting literal secrets.".to_string();
    }

    // 3. Persist ONLY redacted arguments in tool_calls + ledger_payloads BEFORE execution (INV-002, INV-004)
    let intent_record = ctx.store.record_tool_intent_atomic(RecordToolIntentCmd {
        run_id: ctx.run_id.clone(),
        step_id: step_id.clone(),
        provider_call_id: raw_call.provider_call_id.clone(),
        tool_name: raw_call.name.clone(),
        args_redacted_jcs_json: args_redacted_jcs.clone(),
        args_blake3,
        mutability: verdict.mutability,
        risk_class: verdict.risk_class,
        policy_decision: verdict.decision,
        policy_rule_id: verdict.rule_id.clone(),
    }).await?;

    match verdict.decision {
        PolicyDecision::DenyHardStop | PolicyDecision::DenyPolicy => {
            ctx.store.record_tool_denied(&intent_record.tool_call_id, &verdict).await?;
            return Ok(ToolStepOutcome::Denied { rule_id: verdict.rule_id, message: verdict.explanation });
        }
        PolicyDecision::AskHuman => {
            let approval_id = ctx.store.create_approval_request(&intent_record, &verdict).await?;
            let resolution = ctx.approval_gate.wait_for_resolution(approval_id, ctx.cancel.clone()).await?;
            if !resolution.is_approved() {
                ctx.store.record_tool_denied(&intent_record.tool_call_id, &verdict).await?;
                return Ok(ToolStepOutcome::DeniedByHuman { note: resolution.note });
            }
        }
        PolicyDecision::Allow | PolicyDecision::AllowSandboxed => {}
    }

    // 4. Acquire async RwLock read permit on Lane for the entire tool execution (Fixing ST-13 lock gap)
    let _lane_read_permit = if verdict.mutability != ToolMutability::ReadOnly {
        Some(ctx.lane_exec_lock.acquire_mutation_permit(ctx.lane_id.as_ref()).await?)
    } else {
        None
    };

    // 5. Safe to execute args_redacted_jcs because had_vault_secret == false is guaranteed here (RT4-18)
    let cap_token = ctx.capability_minter.mint_single_use(&intent_record, &verdict)?;
    let raw_output = ctx.tool_dispatcher.execute_with_token(cap_token, &raw_call.name, &args_redacted_jcs).await;

    if verdict.mutability != ToolMutability::ReadOnly {
        if let Some(lane_id) = ctx.lane_id.as_ref() {
            ctx.store.increment_lane_mutation_epoch(lane_id).await?;
        }
    }

    // 6. Redact output secrets, spill > 16 KiB to XChaCha20-Poly1305 blobs, and log tool.outcome
    let redacted_and_spilled = ctx.spill_pipeline.redact_and_spill(raw_output).await?;
    ctx.store.record_tool_outcome_atomic(&intent_record.tool_call_id, &redacted_and_spilled).await?;
    Ok(ToolStepOutcome::Executed(redacted_and_spilled))
}
```

### 2.2 Reference Implementation: Epoch-Locked Pre-Completion Gate with Persisted `gate_fail_attempts` (`crates/kin-harness/src/completion_gate.rs`, Fixing `ST-13` & `RT4-20`)

```rust
// Enforces INV-017, ST-13 (Async RwLock Write Permit + Mutation Epoch + Honest Unconfigured Gate + Formatter Cap),
// and RT4-20 (SQLite-persisted worktree_lanes.gate_fail_attempts surviving daemon crashes).
pub async fn verify_before_run_completion(
    ctx: &RunExecutionContext,
    lane_id: &LaneId,
) -> Result<CompletionGateDecision, KinError> {
    // 1. Acquire exclusive async RwLock write permit on the lane (waits for active tool permits, ST-13)
    let _exclusive_permit = ctx.lane_exec_lock.acquire_verification_freeze(lane_id).await?;
    ctx.pty_manager.ensure_all_quiescent_or_exited(lane_id).await?;

    let lane = ctx.store.get_worktree_lane(lane_id).await?;
    if lane.changed_files_count == 0 {
        return Ok(CompletionGateDecision::AllowCompletion);
    }

    // 2. If no fast_check is configured, mark 'unverified_no_gate' honestly (NEVER falsifying last_verified_tree_sha, ST-13)
    let Some(gate_cmd) = ctx.project_config.fast_check_command_for_lane(&lane) else {
        ctx.store.set_lane_verification_state(lane_id, VerificationState::UnverifiedNoGate, None).await?;
        return Ok(CompletionGateDecision::AllowCompletion);
    };

    let epoch_before = lane.mutation_epoch;
    let pre_tree_sha = ctx.lane_git.compute_worktree_tree_sha(lane_id).await?;
    if lane.verification_state == VerificationState::Verified
        && lane.last_verified_tree_sha.as_deref() == Some(pre_tree_sha.as_str())
    {
        return Ok(CompletionGateDecision::AllowCompletion);
    }

    // 3. Run fast_check using configured timeout_seconds (180s default, Fixing ST-13)
    let timeout = Duration::from_secs(ctx.project_config.gates.timeout_seconds);
    let exec_res = ctx.sandbox_runner.run_gate_command(lane_id, &gate_cmd, timeout).await?;

    let lane_after = ctx.store.get_worktree_lane(lane_id).await?;
    let post_tree_sha = ctx.lane_git.compute_worktree_tree_sha(lane_id).await?;

    // 4. Detect tree mutation during verification and cap formatter loops at 2 attempts (Fixing ST-13)
    if post_tree_sha != pre_tree_sha || lane_after.mutation_epoch != epoch_before {
        let attempts = ctx.store.increment_lane_tree_mutate_attempts(lane_id, &post_tree_sha).await?;
        if attempts > 2 {
            return Ok(CompletionGateDecision::EscalateToBoss {
                reason: format!("Verification command `{}` mutated worktree files {} times consecutively", gate_cmd, attempts),
                stderr_tail: exec_res.redacted_tail,
            });
        }
        return Ok(CompletionGateDecision::InjectSelfHealStep {
            next_attempt: attempts,
            reminder_xml: format!(
                "<kin-reminder type=\"pre_completion_tree_mutated\" attempt=\"{}/2\">\n\
                 Command `{}` modified tracked/untracked files during verification. Inspect `git diff` and re-verify.\n\
                 </kin-reminder>",
                attempts, gate_cmd
            ),
        });
    }

    if exec_res.exit_code == 0 {
        // Resets both tree_mutate_attempts = 0 and gate_fail_attempts = 0 in SQLite (Fixing RT4-20)
        ctx.store.set_lane_verification_state(lane_id, VerificationState::Verified, Some(&post_tree_sha)).await?;
        return Ok(CompletionGateDecision::AllowCompletion);
    }

    // 5. Persist gate_fail_attempts (1..=3) in worktree_lanes FIRST (Fixing RT4-20 & RT9-08 off-by-one):
    //    fail_attempt 1 and 2 (< 3) inject self-heal; fail_attempt 3 (>= 3) transitions to failed and escalates to @boss.
    ctx.store.set_lane_verification_state(lane_id, VerificationState::Failed, None).await?;
    let fail_attempt = ctx.store.increment_lane_gate_fail_attempts(lane_id).await?;
    if fail_attempt >= 3 {
        return Ok(CompletionGateDecision::EscalateToBoss {
            reason: format!("Pre-completion gate `{}` failed 3 times consecutively (attempt {}/3)", gate_cmd, fail_attempt),
            stderr_tail: exec_res.redacted_tail,
        });
    }
    Ok(CompletionGateDecision::InjectSelfHealStep {
        next_attempt: fail_attempt,
        reminder_xml: format!(
            "<kin-reminder type=\"pre_completion_verification_failed\" attempt=\"{}/3\">\n\
             Command `{}` failed (exit {}). Fix the errors below before completing:\n{}\n\
             </kin-reminder>",
            fail_attempt, gate_cmd, exec_res.exit_code, exec_res.redacted_tail
        ),
    })
}
```

### 2.3 Reference Implementation: 4-Tier Cascade Fuzzy + AST-Anchored `fs_patch` (`crates/kin-lanes/src/patch_engine.rs`, Fixing `RT6-10`)

```rust
// Enforces AUD-20 (4-Tier Cascade fs_patch) and INV-018 (< 80ms Inline Diagnostics) with zero unwrap/expect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatchTierUsed {
    Tier1Exact = 1,
    Tier2WhitespaceNormalized = 2,
    Tier3AstSymbolScoped = 3,
    Tier4FuzzyLevenshteinAnchor = 4,
}

pub fn apply_four_tier_fs_patch(
    original_src: &str,
    search_block: &str,
    replace_block: &str,
    symbol_hint: Option<&str>,
) -> Result<(String, PatchTierUsed), KinError> {
    if search_block.is_empty() {
        return Err(KinError::PatchEmptySearchBlock);
    }
    // Tier 1: Exact byte-for-byte substring match (uniqueness required)
    let mut exact_matches = original_src.match_indices(search_block);
    if let Some((idx, _)) = exact_matches.next() {
        if exact_matches.next().is_none() {
            let mut out = String::with_capacity(original_src.len() + replace_block.len());
            out.push_str(&original_src[..idx]);
            out.push_str(replace_block);
            out.push_str(&original_src[idx + search_block.len()..]);
            return Ok((out, PatchTierUsed::Tier1Exact));
        }
        return Err(KinError::PatchAmbiguousMatch { tier: 1 });
    }

    // Tier 2: Line-trimmed & CRLF-normalized match preserving target file line endings
    if let Some(patched) = try_line_trimmed_match(original_src, search_block, replace_block)? {
        return Ok((patched, PatchTierUsed::Tier2WhitespaceNormalized));
    }

    // Tier 3: Tree-sitter AST-Symbol-Scoped & Re-indented match (anchored to symbol_hint span)
    if let Some(sym) = symbol_hint {
        if let Some(patched) = try_ast_symbol_scoped_match(original_src, sym, search_block, replace_block)? {
            return Ok((patched, PatchTierUsed::Tier3AstSymbolScoped));
        }
    }

    // Tier 4: Levenshtein Fuzzy Anchor Block Match (Similarity >= 0.92 and top-2 margin >= 0.08)
    if let Some(patched) = try_levenshtein_anchor_match(original_src, search_block, replace_block, 0.92, 0.08)? {
        return Ok((patched, PatchTierUsed::Tier4FuzzyLevenshteinAnchor));
    }

    Err(KinError::PatchNoMatchFound)
}
```

### 2.4 Reference Implementation: DNS-Pinned SSRF Guard & Per-Hop Redirect Policy (`crates/kin-egress/src/resolver.rs`, Fixing `RT4-17` & `RT6-10`)

```rust
// Enforces INV-015, ST-36, and RT4-17 (blocks IPv6 [::] ::/128, NAT64 64:ff9b::/96, 198.18.0.0/15,
// multicast ff00::/8, AWS IMDSv2 fd00:ec2::254, and re-validates every HTTP 3xx redirect hop).
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

pub fn is_ssrf_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            o[0] == 0                                            // 0.0.0.0/8 ("This network", including 0.0.0.1, Fixing RT9-09)
                || o[0] == 127                                   // 127.0.0.0/8 (Loopback)
                || v4.is_private()                               // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                || v4.is_link_local()                            // 169.254.0.0/16 (Link-Local & Cloud IMDS)
                || (o[0] == 100 && (o[1] & 0b1100_0000) == 64)   // 100.64.0.0/10 (Shared CGNAT)
                || (o[0] == 192 && o[1] == 0 && (o[2] == 0 || o[2] == 2)) // 192.0.0.0/24 (IETF) & 192.0.2.0/24 (TEST-NET-1)
                || (o[0] == 192 && o[1] == 88 && o[2] == 99)     // 192.88.99.0/24 (6to4 Relay Anycast)
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))   // 198.18.0.0/15 (Benchmarking, RT4-17)
                || (o[0] == 198 && o[1] == 51 && o[2] == 100)    // 198.51.100.0/24 (TEST-NET-2)
                || (o[0] == 203 && o[1] == 0 && o[2] == 113)     // 203.0.113.0/24 (TEST-NET-3)
                || v4.is_multicast()                             // 224.0.0.0/4
                || o[0] >= 240                                   // 240.0.0.0/4 (Reserved & 255.255.255.255 Broadcast)
        }
        IpAddr::V6(v6) => {
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                return is_ssrf_forbidden_ip(IpAddr::V4(mapped_v4));
            }
            let s = v6.segments();
            // Block all non-Global-Unicast prefixes outside 2000::/3 (blocks ::/128, ::1, ::127.0.0.1 IPv4-compatible,
            // 64:ff9b::/96 NAT64, 100::/64 Discard-Only, fc00::/7 ULA, fd00:ec2::254 IMDSv2, fe80::/10 Link-Local,
            // fec0::/10 Deprecated Site-Local, and ff00::/8 Multicast, Fixing RT9-09):
            if (s[0] & 0xe000) != 0x2000 {
                return true;
            }
            // Inside 2000::/3, block special/transition/non-public IANA allocations (Fixing RT9-09):
            (s[0] == 0x2001 && s[1] == 0x0000)                   // 2001:0000::/32 (Teredo tunneling)
                || (s[0] == 0x2001 && s[1] == 0x0002 && s[2] == 0) // 2001:0002::/48 (Benchmarking)
                || (s[0] == 0x2001 && (s[1] & 0xfff0) == 0x0010) // 2001:10::/28 (ORCHIDv1)
                || (s[0] == 0x2001 && (s[1] & 0xfff0) == 0x0020) // 2001:20::/28 (ORCHIDv2)
                || (s[0] == 0x2001 && s[1] == 0x0db8)            // 2001:db8::/32 (Documentation)
                || (s[0] == 0x2002)                              // 2002::/16 (6to4 tunneling embedding IPv4)
        }
    }
}

#[inline]
pub fn is_publicly_routable_ip(ip: IpAddr) -> bool {
    // Stable Rust 1.82 MSRV replacement for experimental nightly-only IpAddr::is_global() (Audit Finding 10)
    !is_ssrf_forbidden_ip(ip)
}

pub struct KinDnsResolver {
    pinned_addrs: std::sync::Mutex<std::collections::HashMap<(String, u16), std::net::SocketAddr>>,
}

impl KinDnsResolver {
    pub fn new() -> Self {
        Self {
            pinned_addrs: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    /// Resolves `host:port` once via the system resolver, validates that the resolved list is non-empty
    /// and that EVERY returned IP satisfies `is_publicly_routable_ip(ip)` (`!is_ssrf_forbidden_ip(ip)`),
    /// and pins the first verified `SocketAddr` for the outgoing connection or redirect hop (Audit Finding 5).
    pub fn resolve_and_pin_host(&self, host: &str, port: u16) -> Result<std::net::SocketAddr, &'static str> {
        use std::net::ToSocketAddrs;
        if let Ok(literal_ip) = host.parse::<IpAddr>() {
            if is_ssrf_forbidden_ip(literal_ip) {
                return Err("KIN-EGR-0004: target literal IP is forbidden by SSRF policy");
            }
            return Ok(std::net::SocketAddr::new(literal_ip, port));
        }
        let resolved: Vec<std::net::SocketAddr> = (host, port)
            .to_socket_addrs()
            .map_err(|_| "KIN-EGR-0004: DNS resolution failed for target host")?
            .collect();
        if resolved.is_empty() {
            return Err("KIN-EGR-0004: DNS resolution returned zero addresses");
        }
        for addr in &resolved {
            if is_ssrf_forbidden_ip(addr.ip()) {
                return Err("KIN-EGR-0004: hostname resolved to SSRF-forbidden non-public IP range");
            }
        }
        let first_verified = resolved[0];
        if let Ok(mut guard) = self.pinned_addrs.lock() {
            guard.insert((host.to_ascii_lowercase(), port), first_verified);
        }
        Ok(first_verified)
    }
}

pub fn build_egress_redirect_policy(
    allowed_hosts: std::sync::Arc<Vec<String>>,
    allow_insecure_http: bool,
    resolver: std::sync::Arc<KinDnsResolver>,
) -> reqwest::redirect::Policy {
    // Fixing RT4-17.3 & Cross-Doc Audit Finding 5:
    // Re-validate every HTTP 301/302/303/307/308 redirect hop for scheme, EffectiveAllowedHosts,
    // and full DNS resolution + IP pinning via KinDnsResolver::resolve_and_pin_host.
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("KIN-EGR-0005: maximum 5 redirect hops exceeded");
        }
        let scheme = attempt.url().scheme();
        let scheme_ok = scheme == "https" || (scheme == "http" && allow_insecure_http);
        if !scheme_ok {
            return attempt.error("KIN-EGR-0005: redirect target URL scheme is forbidden");
        }
        let Some(host) = attempt.url().host_str() else {
            return attempt.error("KIN-EGR-0005: redirect URL missing host");
        };
        let host_allowed = allowed_hosts.iter().any(|h| h.eq_ignore_ascii_case(host));
        if !host_allowed {
            return attempt.error("KIN-EGR-0005: redirect target host is not in EffectiveAllowedHosts");
        }
        let port = attempt.url().port_or_known_default().unwrap_or(443);
        if let Err(err_msg) = resolver.resolve_and_pin_host(host, port) {
            return attempt.error(err_msg);
        }
        attempt.follow()
    })
}
```

## 3. Tiered QA, VCR-Recorded Golden Journeys & Chaos Pyramid (`QA-*`, Fixing `ST-37` & `RT4-28`)

| Gate Tier | Trigger | Execution Strategy & Hard Pass Criteria | Budget |
| :--- | :--- | :--- | :--- |
| **Tier 1: PR Gate** | Every PR | `python3 verify_kin_v10_0_suite.py` (200 tests: standalone specification & contract verifier) + implementation-repo `cargo test --workspace --locked` + `pnpm --dir apps/desktop run build` + 1,000-case `proptest` + 100-cycle fast `SIGKILL` recovery test | `< 90 seconds` |
| **Tier 2: Nightly Matrix** | Daily 02:00 UTC | **4 parallel CI matrix shards** (`kin-policy`, `kin-ledger`, `kin-memory`, `kin-lanes`) running `cargo-mutants` (`>= 85%` kill score) + 1,000-cycle `SIGKILL`/`ENOSPC` test | `< 30 minutes` wall-clock |
| **Tier 3: Release Soak (M11)** | Pre-GA Release | **10,000-cycle multi-OS chaos soak** + all 14 Golden Journeys (`G1`–`G14`) replayed against deterministic **`kin-bench-vcr` recorded LLM cassettes** + live provider smoke suite | `< 4 hours` |

## 4. Phased Implementation Roadmap & 6-Engineer Staffing Plan (`M0`–`M12`, Fixing `ST-37` & `RT4-28`)

**Core Engineering Team Staffing (6 Engineers)**:

- **2 Staff Systems / Rust Backend Engineers** (`kin-engine`, `kin-store`, `kin-ledger`, `kin-lanes`, `kin-sandbox`)
- **2 Principal AI Runtime / Context Engineers** (`kin-harness`, `kin-orch`, `kin-memory`, `kin-gateway`, `kin-index`)
- **1 Staff Frontend / Tauri v2 Engineer** (`kin-shell`, React 19 4-Zone Workbench, Monaco/`xyflow` inspectors)
- **1 Staff Security & QA Chaos Engineer** (`kin-policy`, OS sandbox profiles, `kin-bench`, fuzzing & notarized release pipelines)

| Milestone | Weeks | Key Work Packages (`WP-*`) | Hard Exit Gate |
| :--- | :--- | :--- | :--- |
| **M0: Contracts & Types** | 1–2 | `WP-001..005`: 6-layer workspace, 30-character prefixed IDs (26-char Crockford ULIDs), 26-tool registry, `specta` codegen | `verify_kin_v10_0_suite.py` (200 tests) & `codegen --check` green |
| **M1: SQLCipher, Vault & Ledger** | 3–4 | `WP-006..012`: SQLCipher `project.db` + `index.db` (`ST-15`), OS Keychain `PMK_prj`, `SecretRedactor`, immutable ledger & history triggers (`ST-18`, `RT4-10`–`RT4-15`, `RT7-04`–`RT7-06`) | All 200 invariant/regression tests & 10,000-op `proptest` green |
| **M2: Mutual IPC & Minimal Debug Shell** | 5–6 | `WP-013..017`: `$KIN_RUN_DIR/e.sock` (`ST-08`), mutual 3-step HMAC handshake (`ST-15`), `ProjectSnapshot` (`RT4-23`) + `project_events` replay, 1-pane debug shell | Mutual handshake & rogue-server rejection tests green |
| **M3: Model Gateway & Prompt Compiler** | 7–8 | `WP-018..023`: Provider adapters, 429 full-jitter backoff + failover (`ST-30`), DeepSeek replay policy, 9-layer BP1–BP2 static + BP3 append-only compiler (L8 Repo-Map `ST-39`) | 100% byte-identical L1–L6 prefix across 20 steps |
| **M4: Dual-AST Policy, Sandboxes & Egress** | 9–10 | `WP-024..030`: 9-stage Dual-AST policy + batch pre-marking (`RT4-16`, `RT4-18`), Seatbelt (`RT4-03`), Linux `CLONE_NEWNET` + `lo` UP + `SCM_RIGHTS` FD 3 + PID 1 `/proc` + 29-rule seccomp (`RT4-01`, `RT4-02`, `RT7-01`), Win32 Job+Low-IL (`RT4-04`), DNS-pinned & redirect-validated `kin-egress` (`RT4-17`) | 250-case red-team, SSRF DNS-rebinding/redirect & sandbox escape tests green |
| **M5: 15-State Harness & Compaction** | 11–12 | `WP-031..038`: 15-state machine (`ST-29`), epoch-locked completion gate with persisted `gate_fail_attempts` (`ST-13`, `RT4-20`), `HRN-LOOP-001` (`RT6-09`), `agent_map_reduce`, L1–L4 compactor | 1,000-cycle `SIGKILL` recovery across all 11 non-terminal states green |
| **M6: Self-Contained `repo.git`, Patch & PTY** | 13–14 | `WP-039..047`: `S2-Root-Snapshot` pack fetch (`ST-09`, `RT4-06`), unborn `HEAD` & tracked/untracked `.env`/`.kinignore` filter (`RT4-07`, `RT4-08`, `RT6-02`), sanitized `.gitattributes` (`ST-12`), 4-tier `fs_patch`, warm LSP (`RT7-07`), Bash-AST `pty_write`, subdir/delete-safe `apply_journals` & worktree prune (`RT4-09`, `RT4-27`) | Live Git `gc`, CRLF, `.git` file, unborn `HEAD`, and apply crash tests green |
| **M7: Stage 0–3 DTA Router & 4-Zone UI Stage** | 15–16 | `WP-048..053`: Stage-0 Pre-Gate + 3-Stage DTA (`Stage 0–3 DTA`, `ST-38`), Channels/Threads/DMs (`RT4-22`)/Meetings (`RT4-21`), Zone 1–3 React 19 virtualized UI | Stages 0–2 Router `< 15ms` p95 (`>= 95%` turns), Stage 3 `< 800ms` p95 (`<= 1,500ms` timeout, `< 5%` turns) & 60 FPS UI stream tests green |
| **M8: Graph Memory & `scope_key` `vec0`** | 17–18 | `WP-054..059`: `scope_key`-partitioned `memory_vec` (`ST-23`), Matryoshka truncation (`RT4-26`), same-scope bi-temporal graph, ordinal-rank RRF, PageRank Repo-Map | `< 45ms` search on 100k chunks & zero cross-agent T3 leak green |
| **M9–M10: DAG, Browser, 5-Phase MCP/Extensions & Zone 4** | 19–22 | `WP-060..068`: Cycle-checked Task DAG (`ST-20`, `RT4-14`), `jiff` scheduler, CDP browser takeover, Step 1 MCP Integration Manager UI + Step 2 First-Party Presets (`github`, `filesystem`, `browser`, `google_workspace` with `read_only`/`write_enabled`) + Step 3 Skills & Workflow Marketplace (`issue-to-pr`) + Step 4 Native Plugin SDK (`kin-plugin-sdk`) | G1–G14 VCR E2E suite & extension security gates green |
| **M11–M12: Public Marketplace, Chaos Soak, Signing & GA** | 23–24 | `WP-069..072`: Step 5 Public Marketplace (verified publishers, static/AST scan, compatibility check, cryptographic revocation `KIN-EXT-0003`), 10,000-crash soak, WCAG 2.2 AA audit, signed updater & notarized `.dmg`/`.msi`/`.deb` installers (`ST-33`) | Zero P0/P1 defects across all 18 Invariants |
