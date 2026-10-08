# KIN Product Copy & Social Media Launch Kit

This document provides ready-to-publish copy across developer platforms, social networks, and community channels. All copy accurately describes verified runtime capabilities in KIN, highlighting local-first application storage, dynamic specialist agent onboarding, universal BYOK credential management, and runtime Model Context Protocol (MCP) support.

---

## 1. GitHub Repository Metadata

### Short Description (350 characters max)
> Local-first workbench for AI chats, multi-agent workforces, and tool integrations. Features dynamic specialist hiring, universal BYOK vault, visual swarm hierarchy, and runtime Model Context Protocol (MCP) stdio execution backed by SQLite.

### Suggested Repository Topics
`local-first`, `ai-workbench`, `multi-agent`, `model-context-protocol`, `mcp`, `ollama`, `byok`, `sqlite`, `tauri`, `react`, `typescript`, `developer-tools`

---

## 2. X (Twitter) Launch Materials

### Option A: Standalone Launch Post (Single Tweet)
```text
Introducing KIN: an open-source, local-first workbench for multi-agent workflows.

• Autonomous specialist hiring & delegation
• Runtime Model Context Protocol (MCP) execution
• Universal BYOK vault (AES-256 in local SQLite)
• Live visual swarm hierarchy map
• Full local Ollama & hosted model support

MIT licensed: https://github.com/abhayzangir1/KIN
```

### Option B: Detailed Launch Thread (6-Tweet Breakdown)

#### Tweet 1: The Vision
```text
1/6 Most multi-agent frameworks are either cloud-locked black boxes or script-heavy terminal experiments.

We built KIN: an open-source, local-first desktop workbench where you can chat, organize projects into channels, and hire dynamic agent teams to build software together.

https://github.com/abhayzangir1/KIN
```

#### Tweet 2: Autonomous Specialist Recruitment
```text
2/6 Instead of hardcoding every agent persona up front, KIN allows orchestrators and specialists to hire new teammates on demand.

Tell your lead agent: "I want to build an Android app. Hire the required team."
KIN dynamically provisions specialists with scoped capabilities in your project.
```

#### Tweet 3: Universal BYOK & Zero Per-Agent Key Hassle
```text
3/6 No more pasting API keys into every individual prompt or subagent configuration.

KIN includes a centralized BYOK vault in Settings:
• Encrypted locally via AES-256-GCM in SQLite
• Discovers available models across Anthropic, OpenAI, Gemini, Groq, DeepSeek
• Supports 100% offline local Ollama models
```

#### Tweet 4: Runtime Model Context Protocol (MCP)
```text
4/6 External tools connect via standard Model Context Protocol (MCP).

Drop an mcp.json into your workspace, and KIN automatically spawns stdio subprocesses (e.g. @modelcontextprotocol/server-filesystem). Agents discover schemas, execute tool calls, and inspect observations live.
```

#### Tweet 5: Visual Swarm Map & Modern Dual Themes
```text
5/6 Keep total visibility over your agent workforce:
• One-click Swarm Map in the header bar visualizing hierarchy, domains, and active tasks
• Refined Dark & Light themes with clean borderless cards and subtle hover elevations
• Project-scoped channels ensuring agents never leak across projects
```

#### Tweet 6: Open Source & Getting Started
```text
6/6 KIN is open source under the MIT license.

Built with a TypeScript core, React workbench, local SQLite WAL state, and a Tauri desktop shell.

Clone the repository and run it locally:
https://github.com/abhayzangir1/KIN

Feedback, PRs, and community skills welcome!
```

---

## 3. LinkedIn Technical Announcement Post

```text
I'm excited to share KIN, an open-source, local-first workbench for multi-agent collaboration and developer workflows.

As AI models become more specialized, coordinating autonomous agents requires more than just prompt chaining. It requires real workforce structure: dedicated channels, verifiable tool execution, dynamic recruitment, and transparent supervision.

Here is what KIN brings to the table:

1. Dynamic Workforce Recruitment:
Users and orchestrator agents can dynamically recruit specialist agents (e.g., Android Engineers, QA Auditors, Researchers) directly inside project channels with scoped capabilities and role definitions.

2. Model Context Protocol (MCP) Integration:
KIN implements JSON-RPC 2.0 stdio client support matching the open Model Context Protocol specification. Standard community MCP servers (such as filesystem, memory, or custom developer tools) can be declared in workspace configuration and executed directly by agents at runtime.

3. Centralized BYOK & Local Model Privacy:
API credentials for hosted inference providers (OpenAI, Anthropic, Google Gemini, Groq, DeepSeek) are managed in a single encrypted settings vault (AES-256 in local SQLite WAL) and dynamically shared with project agents. When privacy is paramount, KIN connects seamlessly to local Ollama instances for completely offline inference.

4. Observable Swarm Topology:
A dedicated visual Swarm Map enables users to inspect agent hierarchies, domain authority assignments, task dependency DAGs, and real-time execution states at a glance.

5. Local-First Architecture:
All application state, channels, chat history, agent definitions, and task ledgers reside in your local SQLite database on your machine—not on a remote server.

KIN is open source under the MIT License and built with TypeScript, React, SQLite, and Tauri:
https://github.com/abhayzangir1/KIN

I would love your feedback and thoughts on local-first agentic architectures!

#AI #OpenSource #MultiAgent #LLM #SoftwareEngineering #TypeScript #ModelContextProtocol #LocalFirst
```

---

## 4. Reddit Community Posts

### Post A: r/LocalLLaMA
**Title**: KIN: An open-source, local-first workbench for multi-agent workflows (Ollama, dynamic specialist hiring, and MCP stdio support)

```markdown
Hey r/LocalLLaMA,

I wanted to share a project I've been developing: **KIN** (https://github.com/abhayzangir1/KIN).

It's a desktop-oriented, local-first multi-agent workbench designed to work with both local models (via Ollama) and external providers through a centralized BYOK key vault.

### Core Architecture:
- **Local State**: All project data, message logs, agent definitions, and task DAGs are stored in a local SQLite database (WAL mode).
- **Dynamic Specialist Hiring**: In any project channel, you or the orchestrator agent can recruit domain-specific subagents on the fly (`hireSpecialist`). Agents are strictly scoped to their project and channel.
- **Model Context Protocol (MCP)**: Native stdio JSON-RPC 2.0 client support. You can configure any standard MCP server in `.kin/mcp.json` (like `@modelcontextprotocol/server-filesystem`), and agents will automatically discover the tools and execute them during their reasoning loop.
- **Visual Swarm Map**: Top header button gives you an instant bird's-eye view of your agent hierarchy, dependencies, and active task status.
- **BYOK Vault**: API keys are stored locally with AES-256 encryption. Once added in Settings, any agent can use the model without re-entering credentials.

### Tech Stack:
- Core: Node.js / TypeScript daemon listening on loopback (127.0.0.1:54321)
- UI: React / Vite / Tailwind with borderless light & dark themes
- Desktop Shell: Tauri / Rust
- Local LLM: Tested with Ollama (qwen2.5-coder, gemma, etc.)

Check out the code, run it from source, and let me know your thoughts:
https://github.com/abhayzangir1/KIN
```

---

### Post B: r/selfhosted & r/ArtificialIntelligence
**Title**: KIN — Open-Source Local-First Multi-Agent Workbench with Native MCP Support

```markdown
Hi everyone,

If you're looking for an open-source, local-first alternative to cloud-hosted agent platforms, check out **KIN**:
https://github.com/abhayzangir1/KIN

### Why KIN?
Most agent frameworks either require running terminal CLI scripts or rely on proprietary cloud platforms where all your project context and logs leave your machine.

KIN is designed as a complete desktop workspace:
1. **Local-First Data Ownership**: Your channels, agent specs, task ledgers, and conversations live in local SQLite files.
2. **Dynamic Team Assembly**: Direct your lead agent to assemble a team for a goal (e.g. building an app or auditing code). It onboards specialists with defined role contracts and domain authority.
3. **Model Context Protocol (MCP)**: Supports the open MCP standard over stdio. Drop standard tool packages into `.kin/mcp.json` to equip agents with filesystem access, database queries, and custom APIs.
4. **Offline or Hybrid**: Run completely offline with Ollama, or connect API keys in the local BYOK vault for hosted models.

GitHub: https://github.com/abhayzangir1/KIN
License: MIT
```

---

## 5. Hacker News (Show HN) Submission

**Title**: Show HN: KIN – Open-source, local-first workbench for multi-agent workflows

```markdown
Hi HN,

I built KIN (https://github.com/abhayzangir1/KIN), an open-source, local-first workbench for coordinating autonomous AI agents.

### Why?
Many current agent tools are either CLI scripts with volatile terminal outputs or cloud SaaS products that store your codebase and conversational data on third-party servers. I wanted a desktop-class environment where:
- Application state and conversation logs remain strictly local (SQLite WAL on loopback).
- Agents organize around projects and channels rather than isolated single-shot chats.
- Teams can be dynamically recruited: an orchestrator can onboard specialist agents into a channel on demand with scoped capabilities.
- Tools use the open Model Context Protocol (MCP) standard over stdio subprocesses.

### How it works:
1. **Core Daemon**: A TypeScript service managing agent loops, memory repositories, Sentinel permission checking, and MCP process lifecycles.
2. **UI**: React workbench with visual swarm maps, message threads, dynamic model readiness catalogs, and a centralized BYOK settings vault.
3. **Execution**: The agent loop injects discovered MCP tool schemas and executes them via JSON-RPC 2.0 stdio pipes, returning structured observations to the model context.

Tested with local Ollama models (e.g. qwen2.5-coder, gemma) as well as hosted providers via the local encrypted key vault.

Repository: https://github.com/abhayzangir1/KIN

Looking forward to your feedback and technical questions!
```

---

## 6. Product Hunt Launch Copy

- **Product Name**: KIN
- **Tagline**: Local-first workbench for multi-agent workflows & MCP tools
- **Pricing**: Free & Open Source (MIT)

### Short Pitch (260 characters)
KIN is an open-source, local-first workbench for AI chats and multi-agent collaboration. Features dynamic specialist hiring, universal BYOK vault, visual swarm hierarchy, and runtime Model Context Protocol (MCP) execution backed by local SQLite.

### Maker Comment
```text
Hey Product Hunt community! 👋

We built KIN because coordinating AI agents should feel like collaborating with a real software engineering team—without sacrificing data privacy or getting locked into cloud platforms.

With KIN:
• You organize work into Projects and Channels.
• Lead agents can hire specialist subagents (e.g., Android Devs, QA Engineers) dynamically.
• External tools connect via standard Model Context Protocol (MCP) over stdio.
• All application state and conversation history are stored in a local SQLite database.
• You can run completely offline with Ollama or connect hosted models via an encrypted local BYOK vault.

Check out the GitHub repo, try running it locally, and let us know what you think! 🚀
https://github.com/abhayzangir1/KIN
```

---

## 7. GitHub Release Notes Draft (v0.1.0-alpha)

```markdown
## KIN v0.1.0-alpha — Multi-Agent Workforce & MCP Runtime Release

This release introduces dynamic workforce recruitment, universal BYOK credential management, and runtime Model Context Protocol (MCP) execution.

### Key Highlights

- **Model Context Protocol (MCP) Runtime Integration**:
  - Full JSON-RPC 2.0 stdio client execution supporting standard community MCP servers.
  - Automatic tool discovery from `.kin/mcp.json` or `.kin/mcp_servers.json`.
  - Dynamic schema injection into agent reasoning loops.
  - Verified runtime execution with official packages including `@modelcontextprotocol/server-filesystem`.

- **Autonomous Workforce & Specialist Recruitment**:
  - Added `hireSpecialist` tool allowing orchestrators and specialists to onboard new teammates dynamically into project channels.
  - Scoped capability management (`mcp:call`, `fs:read`, `shell:exec`) enforced by the Sentinel security shield.
  - Interactive Swarm Map accessible directly from the application header.

- **Universal BYOK Settings Vault**:
  - Centralized credential manager in Settings with local AES-256-GCM encryption.
  - Automated model discovery for Anthropic, OpenAI, Google Gemini, Groq, and DeepSeek.
  - Simplified Agent Inspector model picker without repetitive per-agent API key prompts.

- **Refined Dual Themes & UI Polish**:
  - Modernized Dark and Light themes.
  - Clean card layouts with subtle hover elevations instead of heavy borders.
  - Cross-project channel scoping ensuring hired agents remain strictly within their assigned project environments.

### Quick Start

```bash
git clone https://github.com/abhayzangir1/KIN.git
cd KIN
npm install
npm run build
npm run daemon --workspace=core    # Terminal 1
npm run dev --workspace=ui       # Terminal 2
```
Access the workbench at `http://localhost:5173`.
```
