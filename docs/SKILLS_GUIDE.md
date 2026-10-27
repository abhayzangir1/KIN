# KIN Skills Engine: Architecture & Authoring Guide

KIN features an extensible skill system that allows agents to discover, learn, and execute specialized workflows, custom tool definitions, and domain-specific knowledge packages.

---

## 1. Skill Concepts & Lifecycle

In KIN, a **Skill** is a modular package that encapsulates:
- **Declarative Metadata**: Name, version, description, and required capability tags.
- **Trigger Patterns**: Keywords and regex patterns that activate the skill automatically during planning.
- **System Instructions**: Specialized prompt engineering guidelines injected into the Context Compiler's Skill block.
- **Executable Handlers (Optional)**: TypeScript / JavaScript tool implementations executed safely through `ToolGateway`.

```
[User Request in Channel]
           │
           ▼
 [Context Compiler] ──(Pattern Matcher)──► [Registered Skills in SQLite]
           │                                          │
           │◄────────(Injects Prompt & Tools)─────────┘
           ▼
     [Agent Loop] ──► Dispatches Tool Call ──► [ToolGateway / SkillEngine]
```

---

## 2. Skill Directory Structure

Skills can be placed in your project root under `skills/<skill-name>/` or imported into KIN's SQLite database. A standard skill contains:

```text
skills/my-custom-skill/
├── SKILL.md             # Authoritative metadata and prompt instructions
└── implementation.ts    # (Optional) Executable tool logic
```

### The `SKILL.md` Specification
Every skill must have a YAML frontmatter header followed by Markdown instructions:

```markdown
---
name: security-audit-scanner
version: 1.0.0
description: Automated security hygiene scanner for code repositories.
skill_type: workflow
enabled: true
required_tools:
  - readFile
  - executeShell
trigger_patterns:
  - security
  - audit
  - vulnerability
  - cve
  - secrets
parameters:
  severityThreshold: "high"
  scanDependencies: true
---

# Security Audit Scanner Skill

## Purpose
Use this skill when auditing a repository for plaintext credentials, hardcoded private keys, outdated dependencies, and unsafe shell interpolations.

## Step-by-Step Procedure
1. Scan for hardcoded credentials using regex patterns for API keys and secrets.
2. Check `package.json` or requirements files against known vulnerability databases.
3. Validate that file upload handlers enforce path sanitization.
4. Format all findings into a structured markdown report categorized by severity.
```

---

## 3. Creating Skills via Slash Commands

You can author new skills directly from any channel without touching the filesystem:

```text
/skills create data-cleaner | Automated tabular data hygiene scanner | Inspect CSV and JSON files for missing values, invalid date formats, and schema inconsistencies.
```

KIN validates the parameters, generates the schema definition, and saves the skill to SQLite (`skills` table).

---

## 4. Managing Registered Skills

### Listing Skills
```text
/skills list
```
Displays all registered skills, version numbers, required tool capabilities, and active statuses.

### Importing a Skill Package
To import a skill directory from local disk or repository:
```text
/skills import ./path/to/custom-skill-folder
```

### API Endpoints
You can manage skills programmatically via KIN's REST API:
- `GET /api/skills` — List all registered skills.
- `POST /api/skills` — Register a new skill.
- `GET /api/skills/:id` — Retrieve skill details and instruction prompt.
- `PUT /api/skills/:id` — Update or enable/disable a skill.
- `DELETE /api/skills/:id` — Remove a skill from the database.

---

## 5. Security & Isolation Considerations
- **Execution Trust**: Handlers execute with the same privileges as the KIN daemon. Never import untrusted skill bundles without reviewing their source code and tool requirements.
- **Capability Scoping**: Skills only gain access to tools explicitly declared in `required_tools` and permitted by the agent's definition and the active project security policy.

---

## 6. Procedural Skills vs. Dynamic Machine-Executable Tools (Clean-Break Architecture)

KIN maintains a strict architectural separation between **Procedural Skills** (human-readable natural language workflows) and **Dynamic Machine-Executable Tools** (sandboxed runtime code synthesized by agents):

| Attribute | Procedural Skills (`SkillEngine`) | Dynamic Machine Tools (`ToolEngine`) |
|---|---|---|
| **Primary File** | `core/src/skills/skill_engine.ts` | `core/src/execution/tool_engine.ts` |
| **SQLite Storage** | `skills` table | `custom_tools` table |
| **Purpose** | Domain recipes, guidelines, and prompt directives | Programmatic, high-throughput data processing & automation |
| **Format** | YAML frontmatter + Markdown (`SKILL.md`) | JavaScript / TypeScript executable functions |
| **Execution Realm** | Node.js `node:vm` context (numeric timer handles) | Node.js `worker_threads` (128MB RAM, configurable timeout) |
| **Prompt Injection** | Injected into ContextCompiler Block 5 (Guidance) | Injected into ContextCompiler Block 3 (Available Tools) |
| **Duplicate Prevention** | Keyword & regex trigger matching | Tokenized Jaccard similarity ($\ge 75\%$ duplicate advisory) |
| **Loop Mitigation** | Static trigger priority | `forceCreation: true` anti-loop bypass |
| **Approval Flow** | Static registration | Operator non-blocking pre-approval with graceful fallback |
| **Cross-Task Learning** | Lesson harvesting | Harness² adaptation library (`harness_improvements`) & `probeWorktree` |

### Authoring Dynamic Tools Programmatically
Agents invoke `create_tool` through `ToolGateway`:
```json
{
  "name": "calculate_hash",
  "description": "Calculate SHA-256 hash of a file or string buffer",
  "parametersSchema": {
    "type": "object",
    "properties": {
      "data": { "type": "string" }
    },
    "required": ["data"]
  },
  "code": "const crypto = require('crypto');\nmodule.exports = async function(args) {\n  return { hash: crypto.createHash('sha256').update(args.data).digest('hex') };\n};",
  "forceCreation": false
}
```
If an operator denies approval, the agent receives a non-fatal observation (`"Tool creation denied: ... Please use existing tools."`) and continues its task without interruption. Once approved, the tool is callable swarm-wide by all coworkers as `custom__calculate_hash`.
