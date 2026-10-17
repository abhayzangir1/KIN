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
