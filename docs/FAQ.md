# KIN FAQ

This FAQ describes the current source at a high level. KIN is under active development; source presence does not mean each workflow has been tested end to end. See the [current audit](../KIN_AUDIT_2026-10-07.md) for evidence and open issues.

### Can KIN work without a cloud model?

KIN includes a local Ollama path. It requires Ollama to be installed and running, with a compatible model available. The current model readiness UI can show fallback local models even when Ollama is offline, so confirm the runtime and send a real request before relying on it.

Local SQLite storage does not mean every network request is local. Hosted model calls send prompts and context to the chosen provider; browser navigation contacts the sites you visit; MCP tools can send data to their connected servers. No blanket offline or zero-network promise is made here.

### Do I need to configure every model provider?

No. KIN has credential settings for individual providers, and providers without a key should not be needed for an unrelated provider. The current discovery/readiness implementation is incomplete: catalog fallbacks can appear, key presence can be mistaken for validation, and an invalid key may not be clearly distinguished from a working one. Verify a provider with a real model request.

### Do OpenRouter free models have billing certainty?

No. KIN currently exposes free-model metadata and a curated list, but it does not provide a complete dynamic free/paid filter or ensure billing, account quotas, availability, rate limits, or provider data-handling terms. Treat any “free” label as provider metadata, not a promise.

### How many agents can run at once?

The kernel has a default limit of eight active runs. The run queue is persisted, and startup actively admits and dispatches queued runs across platform restarts. Channel and agent work queues also use in-memory coordination. Do not treat concurrency limits or queue recovery as fully verified.

### Can I access the core server from another computer on my network?

The core binds to 127.0.0.1 by default, so it is available to the local machine and is not exposed as a LAN server by default. The UI can call the local core from the same machine.

### What happens after a crash or power loss?

The source includes checkpoints and stale-run recovery. This audit did not verify exact-turn recovery, lossless restoration, or restart handling for every approval and queued-run state. Do not assume an interrupted run resumes exactly where it stopped.

### How are skills and examples handled?

KIN has skill creation, import, persistence, and execution paths. A timeout can stop waiting for an async skill result, but it does not necessarily cancel work that the skill already started; Node's VM is not a host-level sandbox. The example handlers in docs/EXAMPLES include canned output and are illustrative scaffolds, not live integrations.

### Does KIN have a plugin system?

KIN includes MCP client and tool support. MCP support is not the same as a general plugin registry with discovery, permission review, version management, enable/disable lifecycle, updates, and rollback.

### How does KIN store application data?

KIN uses SQLite and local files for application state and project data. Do not delete a SQLite WAL file while the database is running. Back up the database and project files together using a shutdown-aware procedure.

### Are agent tools and computer actions fully sandboxed?

No such claim is made. The source includes capability checks, approval paths, and project worktrees. Worktrees separate working directories, not host-level processes, network access, or credentials. Chromium is currently launched without host sandbox flags. The current audit identifies additional differences between direct HTTP routes and the agent-tool authorization path.

### Can I build a desktop installer?

The repository includes a Tauri/Rust shell and build configuration. A clean-machine installation with the core distribution and Node runtime bundled was not demonstrated in the current audit. Check the release notes and assets for the specific build you intend to use.

### Where can I find current limitations?

Read the [fresh audit](../KIN_AUDIT_2026-10-07.md) and the [previous comprehensive audit](../KIN_COMPREHENSIVE_AUDIT_AND_FIX_PLAN.md). The PRD and TRD describe target requirements; they are not a verified runtime feature list.
