# KIN Frequently Asked Questions (FAQ)

---

### Q: Does KIN work completely offline without an internet connection?
**A**: Yes. When configured with local **Ollama** models (such as `llama3.2`, `qwen2.5-coder`, or `mistral`), all reasoning, context compilation, tool execution, and SQLite state persistence execute entirely on your local workstation. Zero network requests or telemetry packets are sent to external servers. If you choose to connect cloud providers (OpenRouter, Anthropic, OpenAI, Gemini), an internet connection and your own API keys are used.

---

### Q: How many agents can I spawn concurrently?
**A**: You can register an unlimited number of agent definitions and team identities. By default, KIN coordinates up to 8 active concurrent execution loops. In higher-capacity workstation environments, this limit can be tuned in `core/src/kernel/agent_kernel.ts` (`maxActiveConcurrentRuns`). Atomic task leases and dependency DAGs ensure agents never conflict or execute duplicate tasks.

---

### Q: Can I run KIN on a headless workstation or server?
**A**: Yes. KIN supports fully headless operation. Run `npm run daemon --workspace=core` to start the core IPC server on port `54321`. You can automate runs via REST API endpoints (documented in [docs/API.md](docs/API.md)) or access the web interface from any browser on your local network.

---

### Q: Can I use Claude, GPT, or DeepSeek models instead of Ollama?
**A**: Yes. In the **Settings & Credential Vault** modal, you can configure personal API keys (BYOK) for OpenRouter, Anthropic, OpenAI, and Gemini. KIN tracks token spend against configured limits and provides automatic HTTP 429 quota protection with graceful failover to local Ollama models.

---

### Q: What is the SQLite WAL file (`kin_storage.sqlite-wal`), and can I delete it?
**A**: The `-wal` file is SQLite's Write-Ahead Log. It provides high-concurrency read and write operations by staging committed transactions before folding them into `kin_storage.sqlite`. Never delete this file while KIN is running. When KIN shuts down cleanly or runs a checkpoint, WAL pages are folded into the main database.

---

### Q: What happens during a sudden workstation crash or power loss?
**A**: KIN writes atomic checkpoints after every single reasoning turn and tool execution. Following an unexpected restart, KIN's startup supervisor runs a recovery sweep. Interrupted runs are recovered to their exact turn state and displayed in the Docked Crash Recovery Banner with 1-click **Resume All** or **Inspect State** options.

---

### Q: How do custom skills persist across app restarts?
**A**: Custom skills created by operators (via `/skills create`) or swarmed agents (via the `create_skill` tool) are dual-persisted:
1. Recorded in the SQLite `skills` table with version metadata and tool dependencies.
2. Written to disk in `.kin/skills/<skill-name>/SKILL.md` (and `implementation.ts` for tool extensions).
On daemon startup, KIN automatically scans `.kin/skills/` to synchronize any disk modifications.

---

### Q: What prevents agents from interfering with my mouse and keyboard during desktop control?
**A**: KIN uses an internal serialized single-flight execution queue with native window focus management. When an agent requests mouse movements or keyboard input, it must acquire execution access, execute its action, observe the display mutation, and immediately release access. Furthermore, the **Instant Human Takeover** banner allows operators to pause or abort automated desktop actions at any moment.

---

### Q: Can I share a KIN workspace across multiple machines?
**A**: For project code and files, use standard Git repositories and worktrees. Do not share the active SQLite database file concurrently across network shares (SMB/NFS), as network file locking can conflict with SQLite WAL mode.

---

### Q: How does KIN enforce security between different agent roles?
**A**: KIN implements a strict **Sentinel Security Boundary** with hierarchical capability attenuation. While the lead orchestrator (`@Boss`) holds platform authority (`*`), specialist agents (`@Frontend`, `@Backend`, `@Researcher`) are strictly confined to their declared capabilities (such as `['fs:read', 'fs:write']` or `['web:browse']`). If a specialist attempts an unauthorized tool invocation (e.g. arbitrary shell execution), Sentinel fails closed with a `403 Security Denial`. Additionally, subprocesses spawned by MCP clients run in sanitized environments stripped of host API keys, and browser controllers disallow `file:` and `data:` traversals.

---

### Q: What happens when an agent hits an obstacle or proposes an architectural change?
**A**: When an agent detects blocked states or proposes an architectural pivot, it invokes `proposePlanAdjustment`. KIN captures the proposal into the goal's `proposed_replanning_json` and renders an interactive **Decision Card** (`[DECISION_CARD]`) in the channel. The operator can click **Choose Option A**, **Choose Option B**, or **Apply Compromise**. The choice is recorded as an authoritative ADR in the `decisions` table and adopted across active goals without loss of context.
