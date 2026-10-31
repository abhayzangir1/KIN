# KIN Core REST & IPC API Reference

The KIN Core Daemon runs locally on `http://127.0.0.1:54321` and provides a comprehensive REST API and Server-Sent Events (SSE) stream for desktop shells, web interfaces, and automated clients.

Route handlers are organized into domain controllers under [`core/src/server/controllers/`](../core/src/server/controllers/) (`base_controller.ts`, `workspace_controller.ts`, `channel_controller.ts`, `agent_controller.ts`, `task_controller.ts`, `mcp_controller.ts`, `system_controller.ts`) orchestrated by [`core/src/server/router.ts`](../core/src/server/router.ts) and [`core/src/server/core_server.ts`](../core/src/server/core_server.ts) and backed by SQLite WAL storage in `kin_storage.sqlite`.

---

## 🔐 Authentication & Security

When loopback IPC authentication is active (`requireIpcAuth = true`), all HTTP requests (except `/api/health`) must provide the bearer authorization token generated in `.kin/ipc_auth.token`.

```http
Authorization: Bearer <token>
```
Alternatively, clients can pass `X-IPC-Token: <token>` or `X-KIN-Auth: <token>`.

---

## 📡 1. System & Health

### `GET /api/health`
Public health probe (exempt from token authentication). Returns comprehensive system and storage status.
- **Response `200`**:
  ```json
  {
    "status": "ok",
    "uptime": 42.5,
    "timestamp": 1792900000000,
    "version": "0.1.4",
    "database": { "connected": true, "integrity": "ok", "path": "..." },
    "activeProject": { "id": "proj-kin", "name": "KIN" },
    "autonomyMode": "AUTO",
    "configuredProviders": ["ollama", "openrouter"],
    "activeCredsCount": 2,
    "memory": { "rssMb": 115, "heapUsedMb": 64 }
  }
  ```

### `GET /api/state`
Returns the complete operational state of the active workspace, projects, channels, coworkers, private DMs, goals, tasks, and system flags.
- **Response `200`**:
  ```json
  {
    "workspace": { "id": "ws-default", "name": "Default Workspace", "autonomyMode": "AUTO" },
    "activeProjectId": "proj-kin",
    "projects": [{ "id": "proj-kin", "name": "KIN", "rootPath": "/workspace/projects/kin" }],
    "channels": [...],
    "agents": [...],
    "goals": [...],
    "decisions": [...],
    "schedules": [...],
    "pendingRecoveries": []
  }
  ```

### `GET /api/events`
Opens a persistent Server-Sent Events (SSE) stream for real-time reactive updates.
- **Event types emitted**:
  - `message:created`: New timeline message authored by human or agent.
  - `message:token`: Streaming LLM response token.
  - `message:queued`: Background message queued during active turn.
  - `queue:dequeued`: Message promoted from queue to execution.
  - `agent:state`: Agent status change (`idle`, `thinking`, `working`).
  - `agent:updated`: Agent model or contract update.
  - `quota:paused`: Quota Guard rate-limit pause triggered.
  - `system:recovery-state`: Crash recovery queue status update.
  - `approval:requested` / `approval:resolved`: Action gate events.

### `GET /api/system/governor`
Returns host dynamic memory, CPU utilization, and worker pool capacity.

### `GET /api/system/actions`
Returns audit ledger entries recorded by the security sentinel.

---

## 📁 2. Projects & Workspace Confinement

### `GET /api/projects`
List all registered organizational projects.

### `POST /api/projects`
Create a new project container.
- **Request Body**:
  ```json
  { "name": "Backend API", "rootPath": "/workspace/projects/backend_api" }
  ```

### `POST /api/projects/:id/activate`
Activates the target project. Automatically hot-reloads MCP servers, re-seeds the project-scoped `@Boss` orchestrator, and switches Git worktree confinement.

### `GET /api/projects/:id/git/status`
Returns modified, staged, untracked, added, and deleted files relative to `HEAD`.

### `GET /api/projects/:id/git/diff?file=<path>`
Computes a unified Git diff for a specified file.

### `POST /api/projects/:id/git/revert`
Reverts working tree modifications for a specified file path.
- **Request Body**:
  ```json
  { "filePath": "src/utils.ts" }
  ```

---

## 💬 3. Channels & Timeline Communication

### `GET /api/channels`
List all accessible channels and active 1-on-1 direct messages.

### `POST /api/channels`
Create a new departmental collaboration channel.
- **Request Body**:
  ```json
  { "name": "verification-suite", "description": "Automated test verification channel" }
  ```

### `GET /api/channels/:id/messages`
Retrieve timeline messages for a channel (supports `limit` and `before` pagination).

### `POST /api/channels/:id/messages`
Post a message to a channel or direct message thread. Triggers agent activation if an agent is mentioned (`@AgentName`) or directly messaged.
- **Request Body**:
  ```json
  {
    "content": "@Boss Please coordinate the documentation refactor.",
    "isSteer": false
  }
  ```
- **Response `200`**:
  ```json
  {
    "id": "msg-1792216850",
    "channelId": "chan-general",
    "senderId": "user-operator",
    "content": "...",
    "routing": { "matchedAgentId": "agent-boss", "matchReason": "DIRECT_MENTION" }
  }
  ```

### `GET /api/channels/:id/queue`
Retrieve currently queued messages awaiting turn admission.

### `POST /api/channels/:id/queue`
Enqueue a message during an active agent loop turn without race conditions.

### `DELETE /api/channels/:channelId/messages/:messageId`
Delete a message from the channel timeline.

---

## 🤖 4. Autonomous Workforce & Agents

### `GET /api/agents`
List all active agent identities across the active project.

### `POST /api/agents`
Recruit a new specialist coworker into the workforce.
- **Request Body**:
  ```json
  {
    "name": "SecurityAuditor",
    "role": "Application Security Specialist",
    "model": "ollama/qwen2.5-coder:3b",
    "systemPrompt": "You are a specialized application security auditor...",
    "channelId": "chan-general"
  }
  ```

### `PATCH /api/agents/:id/model`
Update an agent's active model assignment.
- **Request Body**:
  ```json
  {
    "activeModelId": "openrouter/liquid/lfm-2.5-2.6b:free",
    "fallbackModelId": "ollama/gemma4:e2b"
  }
  ```

### `PATCH /api/agents/:id/contract`
Update an agent's role title, active model, and custom specialist instructions.
- **Request Body**:
  ```json
  {
    "roleTitle": "Lead Documentation Engineer",
    "activeModelId": "ollama/gemma4:e2b",
    "systemPrompt": "Maintain strict documentation consistency..."
  }
  ```

### `DELETE /api/agents/:id`
Decommission an agent from the active workforce.

### `GET /api/agents/:id/execution-details`
Retrieve detailed telemetry for an agent (turn count, explored files, tool calls, thinking duration, and peer coordination logs).

### `GET /api/agents/:id/evaluations`
Fetch benchmark evaluation history for an agent.

### `POST /api/agents/:id/evaluate`
Trigger an autonomous benchmark evaluation evaluating tool accuracy and reasoning.

---

## 🧠 5. Model Gateway & Provider Credentials

### `GET /api/models` (or `GET /api/system/models`)
Retrieve the dynamic model catalog combining local Ollama models and discovered cloud models.
- **Query Parameters**:
  - `freeOnly=true`: Filter exclusively to verified unmetered and free-tier models.

### `GET /api/models/readiness`
Inspect provider configuration and validation states:
```json
{
  "ollama": { "configured": true, "validated": true, "modelCount": 3 },
  "openrouter": { "configured": true, "validated": true, "modelCount": 472 },
  "openai": { "configured": false, "validated": false },
  "anthropic": { "configured": false, "validated": false }
}
```

### `POST /api/models/discover`
Trigger live model discovery against a configured provider using API credentials.
- **Request Body**:
  ```json
  { "provider": "openrouter" }
  ```

### `POST /api/models/custom`
Register a user-defined model ID.
- **Request Body**:
  ```json
  { "modelId": "custom/my-fine-tune:7b", "provider": "custom" }
  ```

### `POST /api/system/model/invoke`
Direct test invocation probe verifying model responsiveness and latency.

### `GET /api/settings/credentials`
Retrieve masked credential records stored in the AES-256-GCM vault.

### `POST /api/settings/credentials`
Store or update an encrypted provider API key.
- **Request Body**:
  ```json
  { "provider": "openrouter", "keyAlias": "Production Key", "apiKey": "sk-or-..." }
  ```

### `DELETE /api/settings/credentials/:id`
Revoke and purge a credential from the vault.

---

## 🛡️ 6. Autonomy & Action Gates

### `PATCH /api/workspace/autonomy`
Set global autonomy policy:
- `AUTO`: Low and medium-risk tools execute autonomously; high-risk tools require operator approval.
- `ALWAYS_ASK`: All write, execute, or network operations prompt for approval.
- `FULL_ACCESS`: All verified tools execute without manual approval gates.

### `GET /api/approvals`
List pending action approvals.

### `POST /api/approvals/:id/resolve`
Approve or reject a gated tool invocation using atomic Compare-And-Swap (CAS) resolution.
- **Request Body**:
  ```json
  { "approved": true }
  ```
  *(Also accepts `{ "status": "approved" }` or `{ "decision": "approve" }`)*
- **Responses**:
  - `200 OK`:
    ```json
    {
      "success": true,
      "approvalId": "appr-1730000000",
      "status": "approved",
      "result": { ... }
    }
    ```
    Approval state successfully transitioned to `approved` or `rejected`. The gated tool execution proceeds only for the winning request.
  - `409 Conflict`:
    ```json
    { "error": "Approval was already resolved by another request." }
    ```
    Returned when concurrent or duplicate resolution attempts are received (`changes === 0`). Prevents double-execution of privileged tools under concurrent caller races.
  - `400 Bad Request`: Returned if the approval does not exist or has expired.

---

## 🎯 7. Goals, DAG Tasks & Decision Records

### `GET /api/projects/:id/goals`
List all goals and milestone tasks for a project. Goal status values: `draft`, `active`, `completed`, `failed`, `cancelled`.

### `POST /api/projects/:id/goals`
Create a high-level goal.
- **Request Body**:
  ```json
  {
    "title": "Migrate Database Schema",
    "description": "Refactor foreign key constraints",
    "successCriteria": ["All tests pass", "No data loss"]
  }
  ```

### `POST /api/goals/:id/tasks`
Create a task node in the goal's Directed Acyclic Graph (DAG) with prerequisite dependency ordering.
- **Request Body**:
  ```json
  {
    "title": "Implement SQLite WAL stress test runner",
    "description": "Verify concurrent write throughput under multi-agent load",
    "assignedAgentId": "agent-orchestrator",
    "dependsOnTaskIds": ["task-1", "task-2"],
    "status": "backlog",
    "verificationSpec": {}
  }
  ```
- **Parameters**:
  - `title` *(string, required)*: Task title.
  - `description` *(string, optional)*: Task description and instructions.
  - `assignedAgentId` *(string, optional)*: ID of assigned agent.
  - `dependsOnTaskIds` *(string[], optional)*: Array of prerequisite task IDs that must complete before this task can start.
  - `status` *(string, optional)*: Initial status (`backlog`, `ready`, etc.).
- **Backlog Initialization & DAG Semantics**:
  - If `dependsOnTaskIds` is provided and non-empty (or if `status === 'pending'`), the task automatically initializes in `'backlog'` status.
  - If no dependencies are specified, the task initializes in `'ready'` status.
  - Dependency existence is strictly validated: every task ID in `dependsOnTaskIds` must already exist in the database, or an error is thrown.
  - Depth-first cycle detection (`wouldCreateCycle`) prevents circular dependency deadlocks.
  - When prerequisite tasks reach `'completed'`, the orchestrator evaluates downstream dependencies and promotes eligible tasks from `'backlog'` to `'ready'`.
- **Response `201`**:
  ```json
  {
    "task": {
      "id": "task-1730000000",
      "goalId": "goal-1",
      "title": "Implement SQLite WAL stress test runner",
      "description": "...",
      "status": "backlog",
      "createdAt": 1730000000000,
      "updatedAt": 1730000000000
    },
    "dependsOnTaskIds": ["task-1", "task-2"]
  }
  ```

### `PATCH /api/tasks/:id/status`
Update task progress (`backlog`, `ready`, `running`, `completed`, `failed`, `blocked`).

### `POST /api/tasks/:id/sign-off`
Operator manual sign-off for completed deliverables. Verified via constant-time token comparison (`crypto.timingSafeEqual`).

### `GET /api/projects/:id/decisions`
List Architectural Decision Records (ADRs).

### `POST /api/projects/:id/decisions`
Submit a new architectural proposal for workforce voting.

### `POST /api/decisions/:id/vote`
Record an agent or human vote on a decision record.

---

## ⏰ 8. Proactive Routines & Automations

### `GET /api/projects/:id/schedules` (also `/api/schedules`, `/api/automations`, `/api/projects/:id/automations`)
Consolidated endpoint listing all proactive schedules and automations for the project (or across the workspace).
- **Response `200`**:
  ```json
  {
    "automations": [
      {
        "id": "sched-1730000000",
        "projectId": "proj-kin",
        "projectName": "KIN",
        "repoPath": "/workspace/projects/kin",
        "channelId": "chan-general",
        "channelName": "#general",
        "targetAgentId": "agent-orchestrator",
        "agentName": "@Boss",
        "type": "cron",
        "cronExpression": "0 9 * * 1-5",
        "prompt": "Daily triage bot",
        "status": "active",
        "createdAt": 1730000000000
      }
    ],
    "schedules": [
      {
        "id": "sched-1730000000",
        "projectId": "proj-kin",
        "channelId": "chan-general",
        "targetAgentId": "agent-orchestrator",
        "type": "cron",
        "cronExpression": "0 9 * * 1-5",
        "prompt": "Daily triage bot",
        "status": "active",
        "createdAt": 1730000000000
      }
    ]
  }
  ```

### `POST /api/projects/:id/schedules`
Register a proactive background automation.
- **Request Body**:
  ```json
  {
    "type": "cron",
    "name": "Morning Briefing",
    "cronExpression": "0 9 * * 1-5",
    "channelId": "chan-general",
    "prompt": "Summarize yesterday's project commits and open tasks."
  }
  ```

### `POST /api/schedules/:id/trigger`
Immediately trigger a scheduled routine out-of-band.

### `DELETE /api/schedules/:id`
Cancel and remove a schedule.

---

## 🖥️ 9. Desktop & Browser Control

### `GET /api/system/apps`
Enumerate discovered installed desktop applications.

### `POST /api/system/apps/launch`
Launch a discovered desktop application.
- **Request Body**:
  ```json
  { "appNameOrPath": "notepad.exe" }
  ```

### `GET /api/system/windows`
Enumerate active top-level GUI windows.

### `POST /api/system/desktop/screenshot`
Capture full desktop screen display.

### `POST /api/system/desktop/action`
Send simulated keystrokes or focus windows via SendKeys.

### `GET /api/browser/status`
Retrieve status of active Puppeteer browser session.

### `POST /api/browser/navigate`
Navigate headless browser to a specified URL.
- **Request Body**:
  ```json
  { "url": "https://example.com" }
  ```

### `POST /api/browser/screenshot`
Capture screenshot of current browser web page.

### `POST /api/browser/evaluate`
Execute JavaScript expression in the browser DOM.

---

## 🩹 10. Crash Recovery & Quota Guard

### `GET /api/system/recovery-state`
Inspect crash recovery queue and interrupted runs.

### `POST /api/system/recovery/resume-all`
Resume all interrupted runs from their latest SQLite checkpoints, optionally passing `{ "modelOverride": "..." }` in the JSON body to resume all runs on a specified model.

### `POST /api/system/recovery/resume-run/:runId`
Resume a specific interrupted run, optionally passing `{ "modelOverride": "..." }` in the JSON body to switch model upon resuming.

### `POST /api/system/recovery/switch-model/:runId`
Failover an interrupted or quota-paused run to any configured LLM (e.g. OpenRouter, Gemini, Anthropic, OpenAI, DeepSeek, Groq, Ollama) and resume execution from checkpoint.
- **Request Body**:
  ```json
  { "targetModelId": "openrouter/google/gemini-2.0-flash-001" }
  ```

### `POST /api/system/recovery/switch-to-ollama/:runId`
Failover an interrupted or quota-paused run to local unmetered Ollama and update the agent identity.

### `POST /api/system/recovery/discard`
Discard interrupted run checkpoints.

---

## 💻 11. Interactive Terminal & Files

### `POST /api/terminal/execute`
Execute a command in the project directory using the local PowerShell shell.
- **Request Body**:
  ```json
  { "command": "git status -s" }
  ```

### `GET /api/projects/:id/artifacts`
List project deliverables and generated artifact files.

### `GET /api/projects/:id/uploads`
List files uploaded to the project.

### `POST /api/projects/:id/uploads`
Upload a file attachment to the project.

---

## 🛠️ 12. Dynamic Tools & Custom Tools (`ToolEngine`)

### `GET /api/custom-tools`
List registered dynamic machine-executable tools for a project.
- **Query Parameters**:
  - `projectId` (string, required): Active project identifier.
  - `status` (string, optional): Filter by tool status (`'active'`, `'pending_approval'`, `'disabled'`).
- **Response `200`**:
  ```json
  {
    "tools": [
      {
        "id": "tool-uuid-1",
        "projectId": "proj-kin",
        "name": "parse_csv_columns",
        "description": "Extract column headers and row count from CSV files.",
        "parametersSchema": {
          "type": "object",
          "properties": { "path": { "type": "string" } },
          "required": ["path"]
        },
        "status": "active",
        "creatorAgentId": "agent-boss-proj-kin",
        "createdAt": 1792900000000,
        "updatedAt": 1792900000000
      }
    ]
  }
  ```

### `POST /api/custom-tools`
Register or synthesize a new dynamic machine-executable tool. Runs tokenized Jaccard similarity checks against existing tools.
- **Request Body**:
  ```json
  {
    "projectId": "proj-kin",
    "name": "parse_csv_columns",
    "description": "Extract column headers and row count from CSV files.",
    "parametersSchema": {
      "type": "object",
      "properties": { "path": { "type": "string" } },
      "required": ["path"]
    },
    "code": "module.exports = async function(args) { return { ok: true }; };",
    "creatorAgentId": "agent-boss-proj-kin",
    "forceCreation": false
  }
  ```
- **Response `200` (Direct Active in FULL_ACCESS)**:
  ```json
  {
    "tool": { "id": "tool-uuid-1", "name": "parse_csv_columns", "status": "active" },
    "status": "active"
  }
  ```
- **Response `200` (Duplicate Advisory if $\ge 75\%$ similarity)**:
  ```json
  {
    "status": "duplicate_advisory",
    "existingTool": "read_csv_header",
    "similarity": 0.82,
    "message": "Similar tool already registered. Invoke existing tool or pass forceCreation: true."
  }
  ```
- **Response `200` (Pending Approval in AUTO / Supervised)**:
  ```json
  {
    "tool": { "id": "tool-uuid-1", "name": "parse_csv_columns", "status": "pending_approval" },
    "status": "pending_approval",
    "approvalId": "appr-uuid-1"
  }
  ```

### `POST /api/custom-tools/:id/test`
Dry-run execute a dynamic tool in an isolated worker thread (128MB RAM limit, timeoutMs).
- **Request Body**:
  ```json
  {
    "parameters": { "path": "data/sample.csv" }
  }
  ```
- **Response `200`**:
  ```json
  {
    "success": true,
    "result": { "headers": ["id", "name", "email"], "rowCount": 42 },
    "executionTimeMs": 18
  }
  ```

### `DELETE /api/custom-tools/:id`
Deactivate and delete a custom tool. Emits SSE event `custom_tool:deleted`.
- **Response `200`**:
  ```json
  {
    "success": true,
    "deletedToolId": "tool-uuid-1"
  }
  ```

---

## 🧬 13. Harness² Domain Adaptations & Cross-Task Library

### `GET /api/harness-improvements`
List cross-task recursive adaptations and proven failure mitigations.
- **Query Parameters**:
  - `projectId` (string, required): Active project identifier.
  - `domain` (string, optional): Target problem domain filter (e.g. `sqlite_concurrency`, `network_timeout`).
- **Response `200`**:
  ```json
  {
    "improvements": [
      {
        "id": "imp-uuid-1",
        "projectId": "proj-kin",
        "domain": "sqlite_concurrency",
        "problemSignature": "database_is_locked",
        "improvementType": "retry_backoff",
        "patchDescription": "Apply exponential jitter retry on SQLITE_BUSY before re-querying.",
        "verified": true,
        "createdAt": 1792900000000
      }
    ]
  }
  ```

### `POST /api/harness-improvements`
Record a verified cross-task adaptation or domain lesson into the Harness² improvement library.
- **Request Body**:
  ```json
  {
    "projectId": "proj-kin",
    "domain": "sqlite_concurrency",
    "problemSignature": "database_is_locked",
    "improvementType": "retry_backoff",
    "patchDescription": "Apply exponential jitter retry on SQLITE_BUSY before re-querying.",
    "sourceTaskId": "task-uuid-42"
  }
  ```
- **Response `200`**:
  ```json
  {
    "success": true,
    "improvement": {
      "id": "imp-uuid-1",
      "problemSignature": "database_is_locked",
      "verified": true
    }
  }
  ```
