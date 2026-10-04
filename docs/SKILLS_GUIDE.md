# KIN Skills & Capabilities Guide

Skills in KIN provide structured procedural knowledge, workflow guidelines, and tool extensions that equip autonomous agents to execute complex tasks predictably. Skills persist across application restarts in both local SQLite storage and human-readable files in the `.kin/skills/` directory.

---

## 1. Skill Architecture & Storage

Every skill in KIN is defined with metadata, trigger patterns, required tool dependencies, and procedural instructions or executable code.

### Persistence Mechanism
1. **SQLite Database**: The authoritative `skills` table maintains indexed records for rapid query matching during context compilation.
2. **Local Workstation Filesystem (`.kin/skills/`)**: Each skill is persisted as a dedicated directory:
   ```
   .kin/skills/
   └── <skill-name>/
       ├── SKILL.md             # Metadata (YAML frontmatter) + procedural instructions
       ├── implementation.ts    # Optional TypeScript executable handler logic
       └── skill.json           # Machine-readable portable specification
   ```

On daemon startup, KIN automatically scans `.kin/skills/` and synchronizes any discovered skill files with SQLite.

---

## 2. Anatomy of a `SKILL.md` File

`SKILL.md` files use YAML frontmatter followed by markdown instructions:

```markdown
---
name: research-analyzer
version: 1.0.0
description: >
  Analyzes research papers and extracts structured findings, methodology, and citations.
skill_type: prompt_instruction
enabled: true
required_tools: ["readFile", "executeShell"]
trigger_patterns: ["research", "paper", "literature", "citations"]
parameters: {"maxTokens": 4000, "extractBibtex": true}
---

### Procedural Guidelines:
1. **Source Ingestion**: Read the provided paper text or document via `readFile`.
2. **Methodology Extraction**: Identify the core hypothesis, dataset, and testing methodology.
3. **Quantitative Metrics**: Extract numerical results, benchmarks, and comparison tables.
4. **Executive Synthesis**: Output findings in structured bullet points with source citations.
```

### Frontmatter Attributes
| Attribute | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique identifier for the skill (e.g. `research-analyzer`). |
| `version` | string | Semantic version string (e.g. `1.0.0`). |
| `description` | string | Concise explanation of what the skill accomplishes. |
| `skill_type` | string | Category: `prompt_instruction`, `tool_extension`, or `workflow`. |
| `enabled` | boolean | Whether the skill is active for automatic runtime matching. |
| `required_tools` | array | Names of tools required to execute this skill (YAML bullet list or JSON array: `["readFile", "executeShell"]`; `requiredTools` alias supported). |
| `trigger_patterns` | array | Keywords and phrases that trigger this skill during context matching (YAML bullet list or JSON array; `triggerPatterns` / `tags` aliases supported). |
| `parameters` | object | Configurable parameters passed to the skill. |

---

## 3. Creating Skills

### Method A: Agents Dynamically Creating Skills (`create_skill` Tool)
Swarmed agents can create and persist skills for their team during active execution:
```json
{
  "name": "create_skill",
  "params": {
    "name": "api-contract-tester",
    "description": "Validates REST API schemas against OpenAPI contracts",
    "instructions": "1. Fetch endpoint response. 2. Verify status codes. 3. Check JSON schema fields.",
    "requiredTools": ["executeShell"],
    "triggerPatterns": ["api", "contract", "openapi"]
  }
}
```

### Method B: Slash Command in Workbench (`/skills create`)
Operators can define skills directly from the chat interface:
```
/skills create api-tester | Test REST endpoints against schemas | 1. Query endpoint 2. Validate payload | executeShell | api,test
```

### Method C: REST API
```bash
curl -X POST http://127.0.0.1:54321/api/skills \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sql-optimizer",
    "description": "Optimizes queries for SQLite WAL mode",
    "instructions": "Always use indexed filters and avoid exclusive locks.",
    "triggerPatterns": ["sql", "sqlite", "query"],
    "requiredTools": ["readFile"]
  }'
```

### Method D: Graphical User Interface
Open the **Skills & Tool Catalog** from the Workbench header bar, click **Create Skill**, complete the form, and save.

---

## 4. Importing Skills & External Bundles

### Importing from a Directory
Place a skill folder containing `SKILL.md` inside `.kin/skills/` or import from any directory path:
```
/skills import ./my-external-skills
```
Or via the REST endpoint:
```bash
curl -X POST http://127.0.0.1:54321/api/skills/import \
  -H "Content-Type: application/json" \
  -d '{"directoryPath": "./my-external-skills"}'
```

### Importing a Unified JSON Bundle
```bash
curl -X POST http://127.0.0.1:54321/api/skills/import \
  -H "Content-Type: application/json" \
  -d '{
    "skills": [
      {
        "name": "git-release-manager",
        "description": "Automates semver tag generation and changelogs",
        "instructions": "Inspect git log since last tag and format markdown changelog.",
        "requiredTools": ["executeShell"],
        "triggerPatterns": ["release", "tag", "changelog"]
      }
    ]
  }'
```

---

## 5. Runtime Skill Matching & Context Injection

During every reasoning turn, the `SkillEngine` evaluates the user's prompt and agent role against active skills:
1. **Trigger Keyword Matching**: Matches prompt tokens against `trigger_patterns`.
2. **Tool Compatibility**: Checks that the executing agent has access to all `required_tools`.
3. **Empirical Win-Rate Boost**: Boosts skills that have higher historical success records in `skill_experiences`.
4. **Token Budgeting**: Injects the highest-ranking active skills into **Block 2 (Skills & Specialized Capabilities)** of the agent's context prompt within token budgets.

*Important Boundary*: Candidate lessons are never injected into runtime execution prompts until they have passed the validation gate.

---

## 6. Continuous Learning & Self-Improvement Pipeline

KIN captures execution telemetry to iteratively improve platform performance:
1. **Experience Logging**: Every tool outcome is recorded via `recordExperience` with objectives, failure reasons, and repair strategies.
2. **Candidate Lesson Harvesting**: The system periodically analyzes failure clusters (e.g. DOM selector drift, modal overlays) and generates candidate lessons in status `candidate`.
3. **Validation & Promotion Gate**: Human operators or designated review agents inspect candidates in the **Skills Modal > Candidates** tab to promote them to `active` or deprecate them.
4. **Version Snapshots & Rollback**: Any edit or promotion automatically archives the previous version in `skill_versions`. If a modified skill regresses, use `POST /api/skills/:id/rollback` to restore the previous snapshot.
