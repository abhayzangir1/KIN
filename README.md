# KIN

**A local-first workspace for AI chats and agent workflows.**

KIN brings conversations, projects, agent definitions, tasks, model settings, and automation controls into one desktop-oriented workbench. The repository contains a TypeScript core, a React interface, a Tauri/Rust desktop shell, and SQLite-backed local state.

KIN is under active development. Some paths are connected in source but have not been validated end to end. This README describes the current project without treating planned behavior as a certainty.

[Audit and current limitations](KIN_AUDIT_2026-10-07.md) · [Architecture notes](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Product Copy & Launch Kit](docs/PRODUCT_COPY_DRAFTS.md) · [Skills](docs/SKILLS_GUIDE.md) · [Slash commands](docs/SLASH_COMMANDS.md) · [FAQ](docs/FAQ.md) · [Contributing](docs/CONTRIBUTING.md) · [License](LICENSE)

## What KIN includes

- **Chat and workspace concepts:** projects, channels, direct messages, and project-scoped agent identities.
- **Agent workflows:** default orchestrator (`@Boss`), autonomous workforce recruitment tool (`hireSpecialist`), specialist definitions, goals, tasks, and dependency relationships.
- **Model connections & Universal BYOK:** centralized BYOK key vault in Settings (`Settings → BYOK & Credentials`) for hosted providers (OpenAI, Anthropic, OpenRouter, Google Gemini, Groq, DeepSeek) with dynamic model auto-discovery, local Ollama integration, and simplified model selection in the Agent Inspector.
- **Swarm Map & Hierarchy Navigation:** interactive workforce hierarchy and topology map accessible directly via the top application header bar.
- **Minimalist Dual Themes:** complete Dark and Light theme styling with clean surfaces and smooth hover shadow highlights instead of harsh outlines.
- **Model Context Protocol (MCP) & Extensions:** native stdio JSON-RPC 2.0 client execution for community MCP servers (configured via `.kin/mcp.json`), procedural skills, recurring schedules, and automation routines.
- **Local application state:** SQLite (WAL mode) and project files stored locally on the machine running KIN.
- **Desktop and browser integration:** source paths exist for browser and computer-control actions; their security and packaged runtime behavior still need further validation.

These are product areas present in the codebase, not a claim that every flow is complete or production-ready. See the [dated audit](KIN_AUDIT_2026-10-07.md) for confirmed gaps and what has or has not been demonstrated.

## Run from source

### Requirements

- Node.js 20 or later
- npm
- Rust and the platform build tools only if you are working on the Tauri desktop shell
- Ollama only if you want to try a local model

### Install and build

~~~sh
git clone https://github.com/abhayzangir1/KIN.git
cd KIN
npm install
npm run build
~~~

Start the core daemon in one terminal:

~~~sh
npm run daemon --workspace=core
~~~

Start the web workbench in another terminal:

~~~sh
npm run dev --workspace=ui
~~~

Open http://localhost:5173. The core listens on 127.0.0.1:54321; it is bound to loopback and is not exposed as a LAN server by default.

On Windows, start.bat and on macOS/Linux, start.sh are convenience development launchers. They require a working Node installation and repository dependencies; they are not self-contained installers.

To run the core test suite yourself:

~~~sh
npm test --workspace=core
~~~

No test count or passing status is stated here because results depend on the checkout and environment.

## Models and credentials

KIN features a Universal BYOK (Bring Your Own Key) vault in Settings (`Settings → BYOK & Credentials`) for provider credentials, model discovery, and workforce model assignment. API keys for providers such as OpenAI, Anthropic, OpenRouter, Google Gemini, Groq, and DeepSeek are saved securely in SQLite WAL with HMAC and AES-256 encryption. Once added, keys are available workspace-wide across all projects and agents without per-agent setup. Adding or updating a credential automatically triggers model discovery to register available models in the system catalog.

The current catalog still contains fallback entries, and readiness indicators do not reliably prove that a key is valid or that a model can be called. OpenRouter free/paid filtering and price information should be treated as incomplete. Verify a provider with an actual request before relying on it.

If you configure a hosted provider, prompts and related context sent for inference leave your machine and are handled by that provider under its own terms. Browser actions send requests to the websites you visit. MCP servers receive the data passed to their tools. Ollama can run local inference when it is installed, running, and has the selected model; this does not by itself prove that every part of the application is offline.

## Data and security

KIN stores application state in a local SQLite database and uses the local filesystem for project data. Local storage does not mean every operation stays on-device: hosted model calls, browser navigation, and connected MCP tools can communicate with external services.

The source includes capability checks, approval flows, secret handling, task leases, and event recording. These controls have gaps documented in the current audit. In particular, task evidence can be accepted without verification, the manual task-status endpoint can synthesize a verified sign-off, and some browser/computer execution is not isolated by a host process sandbox. Do not interpret the presence of these controls as a security certification.

## Current limitations

- A current runtime pass with a signed-in browser and real provider keys has not been completed.
- Model readiness can be overstated when Ollama is unavailable or a hosted API key is invalid.
- Some task-completion paths can report completion without valid acceptance evidence.
- Startup actively admits and dispatches queued runs across platform restarts.
- Git worktrees provide separate working directories; they are not system-level process or network sandboxes.
- Clean-machine desktop packaging has not been demonstrated in this audit.

The [audit report](KIN_AUDIT_2026-10-07.md) distinguishes source findings, historical runtime observations, and unverified behavior. Product and technical specifications in docs/PRD.md and docs/TRD.md describe target requirements, not an immediate production feature promise.

## Screenshots

The images below show interface views included in the repository. They are visual references and do not demonstrate that the associated workflow is currently verified.

![KIN workbench](docs/assets/screenshots/01_app_interface_workbench.png)

![KIN agent topology view](docs/assets/screenshots/02_swarm_map_topology.png)

![KIN settings and credentials view](docs/assets/screenshots/03_settings_and_credentials.png)

![KIN agent inspector](docs/assets/screenshots/04_agent_inspector_teamwork.png)

## Releases

See [GitHub Releases](https://github.com/abhayzangir1/KIN/releases) for any published artifacts. Available files and supported platforms are release-specific. A clean-machine installation and bundled Node/core runtime were not verified for this audit.

## Project documents

- [Current audit and product-copy review](KIN_AUDIT_2026-10-07.md)
- [Previous comprehensive audit and fix-plan review](KIN_COMPREHENSIVE_AUDIT_AND_FIX_PLAN.md)
- [Product requirements](docs/PRD.md)
- [Technical requirements](docs/TRD.md)
- [Architecture notes](docs/ARCHITECTURE.md)
- [Tutorial index](docs/TUTORIALS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

The tutorials and example skills are workflow sketches. Their presence does not establish that each example is a live integration or verified end-to-end recipe.

## License

KIN is distributed under the [MIT License](LICENSE).
