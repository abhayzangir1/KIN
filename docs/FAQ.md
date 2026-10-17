# Frequently Asked Questions (FAQ)

---

### General & Architecture

#### What makes KIN different from other AI coding assistants?
Most AI assistants are single-turn chat interfaces or cloud-dependent copilots that run in a single process. KIN is designed as a **local-first autonomous workforce platform**. It gives you a team of specialized coworkers (`@Boss`, `@Coder`, `@Researcher`, `@Reviewer`) operating in shared channels, backed by persistent SQLite storage, four-tier memory scoping, and isolated Git worktrees.

#### Is KIN completely local and private?
Yes, by architecture. KIN's state, message histories, task trees, decision records, and configurations live entirely on your machine in `kin_storage.sqlite`. When using local inference with **Ollama**, zero tokens or prompts ever leave your workstation. If you choose to configure cloud providers (OpenAI, Anthropic, Gemini, OpenRouter), KIN transmits prompts directly to those providers via encrypted HTTPS using your own API keys. KIN maintains no telemetry servers, telemetry tracking, or external cloud accounts.

#### What platforms are supported?
KIN runs natively on:
- **Windows** 10 / 11 (x64)
- **macOS** 12+ (Apple Silicon M-series & Intel x86_64)
- **Linux** (Ubuntu 20.04+, Fedora, Arch)

---

### Models & Inference

#### Can I use KIN without paying for any cloud API keys?
**Absolutely.** KIN provides native integration with **Ollama**. You can run state-of-the-art open-weights models (such as `qwen2.5-coder`, `llama3.3`, `deepseek-r1-distill`, `mistral`, or `phi-4`) entirely on your CPU/GPU for free, with zero network egress.

#### How does BYOK (Bring Your Own Key) work?
You can enter API keys for any supported cloud provider in the **Settings & Credentials** modal. Keys are encrypted via AES-256-GCM and stored locally in your SQLite database. KIN never transmits your keys anywhere except directly to the designated provider's official API endpoint.

#### What happens if I hit a provider's rate limit or run out of quota?
KIN features an intelligent **Quota Guard** mechanism. When an API returns HTTP 429 (Rate Limit Exceeded) or insufficient quota, the active run is automatically paused without losing state. The UI displays an alert banner allowing you to either wait for quota reset or switch to local Ollama with a single click.

---

### Workforce & Agents

#### How do agents collaborate in KIN?
Agents communicate within project channels (like Slack or Discord channels) or via Direct Messages. A typical workflow begins with `@Boss` breaking a goal into tasks, delegating them to specialists (`@Coder`, `@Researcher`), and reviewing their deliverables before closing milestones.

#### How does 4-Tier Memory Scoping work?
To prevent context overflow and protect privacy, KIN partitions memory into four distinct tiers:
1. **Tier 1 (Project-Shared)**: High-level architectural decisions, project goals, and verified lessons accessible to all agents.
2. **Tier 2 (Conversation-Scoped)**: Channel message trajectories and channel context snapshots accessible only to enrolled members.
3. **Tier 3 (Agent-Private)**: Personal reflections, learned techniques, and scratchpads isolated to that specific agent.
4. **Tier 4 (Direct Message Privacy)**: 1-on-1 private conversations between the operator and an agent, or peer-to-peer between two coworkers.

#### Can I create custom specialist agents?
Yes. You can create custom agent definitions through the UI or using the `/hire` slash command (e.g. `/hire @SecurityAuditor OWASP and smart contract security auditor`). Custom agents can be configured with specific model assignments, temperature settings, and tool permissions.

---

### Development & Worktrees

#### How does KIN prevent parallel agents from conflicting in Git?
KIN uses **Ephemeral Git Worktrees**. When an agent begins a coding task, KIN provisions a separate working directory in `.kin/worktrees/<task-id>/` on a dedicated branch. Multiple agents can write code, install dependencies, and run unit tests concurrently without dirtying your main workspace branch. Once verified, changes are reviewed and merged cleanly.

#### Does KIN execute arbitrary terminal commands without permission?
By default, KIN's **Sentinel** security gateway intercepts high-risk commands (such as destructive filesystem modifications, external network calls, or desktop control actions) and presents an **Approval Card** in the UI. The command will not execute until you click **Approve**.

---

### Storage & Backups

#### Where is my data stored?
All data is stored locally in the KIN repository directory in:
- `kin_storage.sqlite` (and `-wal` / `-shm` sidecars)
- Local Git worktrees and project files

#### How do I back up my KIN workspace?
Stop the KIN Core Daemon and make a copy of `kin_storage.sqlite` along with its WAL files (`kin_storage.sqlite-wal` and `kin_storage.sqlite-shm`). Alternatively, use SQLite's native backup CLI command:
```bash
sqlite3 kin_storage.sqlite ".backup backup.sqlite"
```
