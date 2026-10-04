# Contributing to KIN

Thank you for your interest in contributing to KIN. KIN is an open-source, local-first multi-agent workforce coordination platform designed for local sovereignty, crash resilience, and desktop automation.

This guide outlines our development workflow, coding standards, testing requirements, and contribution process.

---

## Code of Conduct & Core Philosophy

When contributing to KIN, adhere to the platform's core architectural tenets:
1. **Local Sovereignty First**: All state, credentials, memories, goals, and tasks remain strictly on the user's local workstation. Never transmit telemetry or user workspace files to external cloud servers.
2. **Crash Resilience Without Data Loss**: Every significant turn, message, and action record must persist to SQLite in Write-Ahead Logging (`WAL`) mode with atomic checkpoints.
3. **Hardware-Aware Safety**: Concurrency and heavy tasks must honor memory governors (`os.freemem()`), and desktop interactions must be serialized through mutex locks to prevent collision.
4. **Transparent Communication**: Do not use misleading claims or exaggerated terms (such as "guarantee", "100%", or "bulletproof"). Be accurate and verifiable in documentation.

---

## Development Setup

### Prerequisites
- **Node.js**: v20.x or higher
- **npm**: v10.x or higher
- **Rust & Cargo**: (Only required if building Tauri desktop binaries)
- **Ollama**: (Optional for local offline LLM testing)

### Initial Setup
```bash
# 1. Clone repository
git clone https://github.com/abhayzangir1/KIN.git
cd KIN

# 2. Install workspace dependencies
npm install

# 3. Verify the core test suite
npm test --workspace=core

# 4. Start the development environment (two terminals)
# Terminal 1: Core Daemon
npm run dev:daemon

# Terminal 2: Vite User Interface
npm run dev:ui
```

---

## Branching & Commit Guidelines

### Branch Naming Conventions
- `feature/<short-description>`: New capabilities or platform enhancements.
- `fix/<issue-number>-<short-description>`: Bug repairs and regressions.
- `docs/<short-description>`: Documentation additions and audits.
- `test/<short-description>`: New test suites or benchmarking additions.

### Conventional Commit Format
All commit messages must adhere to conventional commit formatting:
```
<type>(<scope>): <concise description in imperative tense>
```

**Common Types**:
- `feat`: A new user-facing or agent-facing feature
- `fix`: A bug fix
- `docs`: Documentation updates
- `test`: Adding or refactoring tests
- `refactor`: Code restructure without behavioral alterations
- `perf`: Performance or memory governor optimizations

**Examples**:
- `feat(skills): add dynamic skill creation and import with disk persistence`
- `fix(daemon): release desktop mutex lock upon process abort`
- `docs(api): document REST endpoints and SSE event schema`

---

## Code Style & Engineering Standards

1. **TypeScript Strict Mode**:
   - All code in `core/` and `ui/` is compiled with strict TypeScript checking.
   - Avoid `any` whenever possible; prefer explicit types and descriptive interfaces.

2. **No Stubs or Mocked Placeholders**:
   - Implement functional logic for all exported methods. Do not commit empty stubs or placeholder functions.

3. **Storage & Database Migrations**:
   - Database operations use parameterized queries to prevent injection.
   - When modifying schema in `core/src/storage/schema.sql`, add backward-compatible pre-migration checks in `core/src/storage/migration_runner.ts` using `ALTER TABLE ... ADD COLUMN`.

4. **Security Boundaries**:
   - File access must be confined to the project worktree root.
   - Commands executed through `ToolGateway` must pass through capability checks and autonomy gates (`AUTO`, `ALWAYS_ASK`, `FULL_ACCESS`).
   - Financial transactions and destructive actions must escalate to interactive human review.

---

## Testing Expectations

All pull requests must pass the existing test suite without regressions.

### Running Tests
```bash
# Run entire core test suite
npm test --workspace=core

# Run specific test file
npx vitest run test/learning_pipeline.test.ts --workspace=core
```

### Adding New Tests
- When introducing new capabilities (e.g. tools, endpoints, slash commands), add corresponding test cases in `core/test/`.
- Ensure tests clean up temporary files and ephemeral SQLite database files in `afterEach` or `afterAll` hooks.
- Avoid weakening, skipping, or removing existing tests to force a build to pass.

---

## Submitting Pull Requests

1. **Verify Formatting & Tests**:
   Ensure `npm test --workspace=core` passes cleanly before pushing.
2. **Push to Your Fork**:
   Push your branch and open a PR against the `main` branch of `abhayzangir1/KIN`.
3. **PR Description**:
   Provide a clear summary of what was changed, why the change was made, and the test commands executed to verify the behavior.
