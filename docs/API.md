# Core API overview

KIN's TypeScript core exposes a local HTTP API and Server-Sent Events (SSE) stream for the UI. The handlers are implemented in [`core_server.ts`](../core/src/server/core_server.ts). This page is an orientation, not a complete OpenAPI contract; the source is authoritative and route payloads may change.

## Local address and authentication

The default base URL is `http://127.0.0.1:54321`. The daemon binds to loopback by default. When IPC authentication is enabled, send the bearer token stored in the active runtime's `.kin/ipc_auth.token` file:

```sh
curl -H "Authorization: Bearer <token>" http://127.0.0.1:54321/api/state
```

Do not expose the daemon to a network or publish the token. Authentication and origin behavior are enforced in the core request handler and can depend on its runtime configuration.

## API areas

The current core source contains route handlers for these areas:

| Area | Examples of route families |
|---|---|
| State and diagnostics | `/api/state`, `/api/system/*` |
| Projects and workspace | `/api/projects`, project activation and project-scoped resources |
| Agents and runs | `/api/agents/*`, `/api/runs/*` |
| Channels and messages | `/api/channels/*/messages`, channel membership and direct-message operations |
| Goals, tasks, and decisions | project-scoped goal/task routes and decision routes |
| Models and credentials | `/api/models*`, `/api/settings/credentials*` |
| Skills and learning | `/api/skills*`, `/api/learning/*` |
| Schedules and routines | `/api/projects/:id/schedules`, `/api/schedules/:id/*`, routine routes |
| MCP and external control | `/api/mcp/tools`, `/api/mcp/reload`, `/api/browser/*`, `/api/system/apps/*`, `/api/system/windows/*`, `/api/system/desktop/*` |

Not every route is intended as a stable public API. Inspect the handler and its caller before relying on a route for automation or compatibility.

## Events

`GET /api/events` opens an SSE connection used by the UI for messages, run/task updates, approvals, models, schedules, skills, and system events. Event names and payloads are emitted throughout `core_server.ts` and related services. Consumers should tolerate reconnects and refresh state from the API when needed; an SSE event is a notification, not by itself proof that a downstream action completed.

## Data handling

The API runs locally by default, but calls made through it can initiate hosted model requests, browser navigation, or MCP tool execution. Those integrations may send request data off-device. See [Current implementation notes](PROJECT_STATUS.md) for the main trust boundaries.
