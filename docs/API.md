# KIN Core REST & IPC API Reference

The KIN Core Daemon runs locally on `http://127.0.0.1:54321` and provides a comprehensive REST API and Server-Sent Events (SSE) stream for desktop shells, web interfaces, and automated clients.

All handlers are implemented in [`core/src/server/core_server.ts`](../core/src/server/core_server.ts) and backed by SQLite WAL storage in `kin_storage.sqlite`.

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
Public health probe (exempt from token authentication).
- **Response `200`**:
  ```json
  { "status": "ok", "timestamp": 1792216868000, "service": "kin-core" }
  ```

### `GET /api/state`
Returns the complete operational state of the active workspace, projects, channels, coworkers, private DMs, goals, tasks, and system flags.
- **Response `200`**:
  ```json
  {
    "workspace": { "id": "ws-default", "name": "Default Workspace", "autonomyMode": "AUTO" },
    "activeProjectId": "proj-kin",
    "projects": [{ "id": "proj-kin", "name": "KIN", "rootPath": "D:/kin_sandbox_workspace" }],
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
  { "name": "Backend API", "rootPath": "D:/projects/backend_api" }
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
- **Responses**:
  - `200 OK`: Approval state successfully transitioned to `approved` or `rejected`.
  - `409 Conflict`: `{ "error": "Approval was already resolved by another request." }` returned when concurrent resolution attempts are made.

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
Create a task node in the goal's Directed Acyclic Graph (DAG) with dependency ordering.
- **Request Body**:
  ```json
  {
    "title": "Implement SQLite WAL stress test runner",
    "description": "Verify concurrent write throughput under multi-agent load",
    "assignedAgentId": "agent-orchestrator",
    "dependsOnTaskIds": ["task-1", "task-2"]
  }
  ```
- **Validation**:
  - Ensures all `dependsOnTaskIds` exist in the database.
  - Cycle detection prevents circular dependencies (`wouldCreateCycle`).
  - Tasks remain in `backlog` until all prerequisite tasks reach `completed` status.

### `PATCH /api/tasks/:id/status`
Update task progress (`pending`, `running`, `completed`, `failed`).

### `POST /api/tasks/:id/sign-off`
Operator manual sign-off for completed deliverables.

### `GET /api/projects/:id/decisions`
List Architectural Decision Records (ADRs).

### `POST /api/projects/:id/decisions`
Submit a new architectural proposal for workforce voting.

### `POST /api/decisions/:id/vote`
Record an agent or human vote on a decision record.

---

## ⏰ 8. Proactive Routines & Automations

### `GET /api/projects/:id/schedules`
List configured background schedules.

### `POST /api/projects/:id/schedules`
Register a proactive background automation.
- **Request Body**:
  ```json
  {
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
Resume all interrupted runs from their latest SQLite checkpoints.

### `POST /api/system/recovery/resume-run/:runId`
Resume a specific interrupted run.

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
