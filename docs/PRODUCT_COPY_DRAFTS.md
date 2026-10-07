# KIN Product Copy Drafts

The X, LinkedIn, and release copy below are local drafts and have not been published. GitHub About text is a separate repository setting. The signed-in browser session was unavailable during this audit, so no social account was opened.

The copy describes KIN as an early-stage local-first workspace. It avoids claims of complete privacy, guaranteed model availability, exact recovery, cost guarantees, or production readiness.

## Short description

Local-first workspace for AI chats, projects, and agent workflows.

## GitHub repository description

Local-first workspace for AI chats, projects, and agent workflows. Includes local application state and optional model providers; some integrations and reliability paths remain unverified.

## Expanded product description

KIN is an early-stage local-first workspace for working with AI chats, projects, agents, tasks, and automations. The repository includes a TypeScript core, React workbench, SQLite-backed application state, model-provider adapters, and a Tauri/Rust desktop shell.

KIN can be configured with local Ollama or hosted model providers. Hosted inference sends prompts and related context to the selected provider. Browser and MCP integrations can also communicate with external services. Several reliability, model-readiness, security, and packaging paths remain under active development.

## X post draft

Building KIN: a local-first workspace for AI chats, projects, and agent workflows. It brings model settings, tasks, schedules, skills, and tools into one app. Early project; model discovery, task verification, and packaging still need work.
https://github.com/abhayzangir1/KIN

## LinkedIn post draft

I’ve been working on KIN, a local-first workspace for AI chats and agent workflows.

The project brings together conversations, projects, agent definitions, tasks, model settings, schedules, skills, and tool integrations in one workbench. The codebase uses a TypeScript core, React UI, SQLite for local application state, and a Tauri/Rust desktop shell.

KIN is still in active development. Provider discovery and readiness need improvement, some task-completion paths need stronger evidence checks, and clean-machine desktop packaging has not been verified. Local storage also does not mean all activity stays on-device: hosted model calls, websites, and connected MCP tools can receive data.

I’m sharing the current state openly and continuing to improve the reliability and model-selection experience. If you explore the repository, the README and dated audit explain what is present and what still needs work:

https://github.com/abhayzangir1/KIN

## GitHub release draft

**Use after the release version and downloadable assets have been checked. Do not reuse the old hard-coded v0.1.0 installer names without verifying them.**

KIN is an early-stage local-first workspace for AI chats, projects, and agent workflows. This release contains the source snapshot identified by the release tag.

The README covers source setup and current limitations. Review the audit before relying on task verification, provider readiness, browser/computer isolation, recovery, or packaged installation. If this release includes desktop artifacts, use only the files listed in the release assets and follow their platform-specific instructions.

## Suggested repository topics

local-first, ai-workspace, agents, multi-agent, ollama, sqlite, tauri, react, typescript

## Copy guidance

- Say “local-first” to describe where application state is stored; do not imply that hosted model, browser, or MCP traffic stays local.
- Say “provider adapters/model discovery are present” rather than promising that every provider or model works.
- Do not describe an OpenRouter model as free or quota-free without current provider metadata and a clear qualification.
- Do not say “secure sandbox,” “exact crash recovery,” “zero telemetry,” or “production-ready” without specific current evidence.
- Keep product inspiration references separate from feature claims. KIN is not OpenCode and has not been verified for feature parity.
