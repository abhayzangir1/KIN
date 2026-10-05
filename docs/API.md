# KIN Core IPC REST & SSE Protocol Reference

KIN operates a local core daemon on `http://127.0.0.1:54321`. This authoritative local server manages SQLite persistence, hardware governors, agent execution loops, and desktop automation primitives.

---

## 1. General Conventions

- **Base URL**: `http://127.0.0.1:54321`
- **Content-Type**: `application/json` (for all JSON request/response payloads)
- **Authentication**: When IPC token authentication is enforced, requests must supply `Authorization: Bearer <token>`, where the token is read from `.kin/ipc_auth.token`.
- **Local Sovereignty**: All endpoints listen strictly on loopback (`127.0.0.1`). External network connections to these ports are rejected by default.
- **Event Streaming**: Real-time event notifications stream over Server-Sent Events (`GET /api/events`).

---

## 2. System State & Diagnostics Endpoints

### `GET /api/state`
Returns the authoritative system state snapshot, including workspace metadata, active project, registered agents, channels, and active autonomy mode.

**Response `200 OK`**:
```json
{
  "workspace": {
    "id": "ws-default",
    "name": "Default Workspace",
    "rootPath": "D:/KIN",
    "defaultAutonomyMode": "AUTO"
  },
  "activeProject": {
    "id": "proj-kin",
    "name": "KIN",
    "repoPath": "D:/KIN"
  },
  "autonomyMode": "AUTO",
  "agents": [
    {
      "id": "agent-boss",
      "displayName": "@Boss",
      "role": "Lead Sovereign Orchestrator",
      "isOrchestrator": true,
      "activeModelId": "llama3.2"
    }
  ],
  "channels": [
    {
      "id": "chan-default",
      "name": "general",
      "topic": "General team coordination"
    }
  ]
}
```

### `GET /api/system/health`
Performs comprehensive operational diagnostics across SQLite WAL mode, available memory, disk space, and daemon uptime.

**Response `200 OK`**:
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "ok", "journalMode": "wal", "integrity": "ok" },
    "memory": { "status": "ok", "freeMb": 8192, "minThresholdMb": 256 },
    "ollama": { "status": "ok", "online": true, "installedModels": ["llama3.2"] }
  },
  "timestamp": 1728020000000
}
```

### `GET /api/system/governor`
Queries the active hardware memory governor thresholds and real-time host RAM measurements.

---

## 3. Persistent Skills Endpoints

### `GET /api/skills`
Lists all installed skills.
- **Query Parameters**:
  - `status` (optional): `active` (default), `candidate`, `deprecated`, `disabled`, or `all`.

**Response `200 OK`**:
```json
{
  "skills": [
    {
      "id": "skill-sqlite-optimization",
      "name": "sqlite-optimization",
      "version": "1.0.0",
      "description": "Best practices for SQLite WAL querying",
      "instructions": "Always use WAL journal mode and parameterized statements.",
      "requiredTools": ["readFile", "executeShell"],
      "triggerPatterns": ["sqlite", "database", "wal"],
      "isBuiltIn": true,
      "status": "active",
      "enabled": true
    }
  ]
}
```

### `POST /api/skills`
Creates and persists a custom skill to both SQLite and `.kin/skills/<name>/SKILL.md`.

**Request Body**:
```json
{
  "name": "api-schema-validator",
  "description": "Validates API endpoint responses against JSON schemas",
  "instructions": "1. Fetch schema. 2. Verify payload properties. 3. Report violations.",
  "parameters": { "strict": true },
  "requiredTools": ["readFile"],
  "triggerPatterns": ["schema", "validate", "api"],
  "skillType": "tool_extension",
  "enabled": true
}
```

**Response `201 Created`**:
```json
{
  "skill": {
    "id": "skill-api-schema-validator",
    "name": "api-schema-validator",
    "version": "1.0.0",
    "status": "active",
    "enabled": true
  }
}
```

### `DELETE /api/skills/:id`
Deletes a custom skill from SQLite and removes its directory from `.kin/skills/`.

**Response `200 OK`**:
```json
{
  "success": true,
  "skillId": "skill-api-schema-validator"
}
```

### `POST /api/skills/import`
Imports a skill bundle or an external directory into persistent storage.

**Request Body (Option A - Directory Path)**:
```json
{
  "directoryPath": "./external-skills-bundle"
}
```

**Request Body (Option B - JSON Package)**:
```json
{
  "skills": [
    {
      "name": "markdown-formatter",
      "description": "Lints and formats markdown documents",
      "instructions": "Enforce header hierarchies and table spacing.",
      "requiredTools": ["writeFile"]
    }
  ]
}
```

**Response `201 Created`**:
```json
{
  "success": true,
  "imported": 1,
  "skills": [ ... ]
}
```

### `GET /api/skills/export-all`
Exports all active skills as a unified portable JSON bundle.

---

## 4. Goals & Origin-Aware Replanning Endpoints

### `GET /api/projects/:id/goals`
Lists all goals associated with a project, including enriched lifecycle metadata.

**Response `200 OK`**:
```json
{
  "goals": [
    {
      "id": "goal-123",
      "projectId": "proj-kin",
      "title": "Shift from REST to GraphQL",
      "description": "Unify API query surface with schema federation",
      "acceptanceCriteria": ["Generate GraphQL schema", "Pass backward-compat tests"],
      "status": "active",
      "deadline": 1728050000000,
      "checkInPolicy": "daily_evening",
      "progressSummary": "Schema generated, verifying resolvers",
      "blockedState": null,
      "proposedReplanning": null,
      "originChannelId": "chan-general",
      "createdAt": 1728020000000,
      "updatedAt": 1728025000000
    }
  ]
}
```

### `POST /api/projects/:id/goals`
Declares a persistent top-level project goal.

---

## 5. Architectural Decisions (ADR) & Tie-Breaker Endpoints

### `GET /api/projects/:id/decisions`
Lists authoritative and proposed Architectural Decision Records (ADRs).

**Response `200 OK`**:
```json
{
  "decisions": [
    {
      "id": "dec-choice-1791161845397",
      "projectId": "proj-kin",
      "decidedById": "agent-boss",
      "title": "Plan Decision: Option A",
      "rationale": "Selected by operator via DecisionCard: Option A: Shift from REST to GraphQL",
      "alternativesConsidered": [],
      "status": "authoritative",
      "createdAt": 1791161845397
    }
  ]
}
```

### `POST /api/projects/:id/decisions`
Records an Architecture Decision Record directly.

### `PATCH /api/decisions/:id/status`
Updates an ADR status (`proposed`, `authoritative`, `superseded`, `rejected`).

---

## 6. Agent Runs & Execution Control

### `POST /api/runs`
Spawns an agent execution run.

**Request Body**:
```json
{
  "agentId": "agent-boss",
  "projectId": "proj-kin",
  "channelId": "chan-default",
  "prompt": "Analyze repository architecture and summarize key modules",
  "autonomyMode": "AUTO"
}
```

**Response `201 Created`**:
```json
{
  "runId": "run-f1e2d3c4",
  "state": "running",
  "createdAt": 1728020000000
}
```

### `POST /api/runs/abort`
Immediately aborts an active agent run via its associated `AbortSignal`.

**Request Body**:
```json
{
  "runId": "run-f1e2d3c4"
}
```

---

## 7. Channel Messaging & Slash Commands

### `GET /api/channels/:id/messages`
Retrieves timestamped message history for a channel.

### `POST /api/channels/:id/messages`
Dispatches a message from the operator or an agent. Supports slash commands (`/plan`, `/goal`, `/schedule`, `/skills`, `/btw`, `/grill-me`, `/hire`, `/decisions`).

**Request Body**:
```json
{
  "content": "/skills create benchmark-runner | Run vitest benchmark suites | Run tests and measure ms | executeShell | benchmark,perf",
  "senderId": "user-operator"
}
```

**Response `201 Created`**:
```json
{
  "message": {
    "id": "msg-1234",
    "channelId": "chan-default",
    "senderName": "Human",
    "content": "/skills create ...",
    "createdAt": 1728020000000
  }
}
```

---

## 8. Desktop & Browser Control Endpoints

### `GET /api/system/apps`
Discovers installed desktop applications across standard system paths.

### `GET /api/system/windows`
Lists active top-level GUI windows with titles, bounds, and process identifiers.

### `POST /api/system/desktop/screenshot`
Captures screen display coordinates into base64 PNG data.

### `GET /api/browser/status`
Returns persistent Chromium session details, active target URLs, and web step trajectories.

---

## 9. Real-Time Event Stream (`GET /api/events`)

The daemon exposes a Server-Sent Events (SSE) stream on `/api/events` for real-time frontend synchronization:

**Connection**:
```bash
curl -N http://127.0.0.1:54321/api/events
```

**Event Types**:
| Event Name | Description |
|------------|-------------|
| `message:created` | New message posted to a channel. |
| `run:state_changed` | Agent execution state mutation (`queued`, `running`, `completed`, `failed`). |
| `action:recorded` | Tool invocation logged with status and duration. |
| `skill:created` | New persistent skill added. |
| `skill:imported` | Skills imported into storage. |
| `skill:deleted` | Skill removed from storage. |
| `approval:created` | Consequential action paused awaiting human review. |
| `quota:paused` | HTTP 429 quota guard activated. |
