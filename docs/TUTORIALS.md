# KIN Tutorials & Practical Guides

This directory contains practical, step-by-step guides for orchestrating autonomous workforce operations, managing background routines, parallelizing development with Git worktrees, and executing high-autonomy compound workflows.

---

## Available Tutorials

1. **[Tutorial 1: Orchestrating an Autonomous Research Swarm](TUTORIALS/01-research-swarm.md)**  
   Learn how to convene specialist agents (`@Boss`, `@Researcher`, `@Synthesizer`), run parallel web and document investigations, produce cited markdown artifacts, and compact channel memory.

2. **[Tutorial 2: Configuring Timers and Proactive Background Routines](TUTORIALS/02-daily-routines.md)**  
   Step-by-step guide to setting one-shot wake-up timers, configuring five-field recurring cron schedules, authoring daily morning standup bots, and monitoring schedule attempt logs in SQLite.

3. **[Tutorial 3: Parallel Coding with Git Worktree Isolation](TUTORIALS/03-parallel-coding.md)**  
   How KIN provisions isolated Git worktrees (`.kin/worktrees/`) for parallel coding tasks, executes automated test suites in temporary branches, serializes filesystem operations, and merges verified diffs cleanly.

4. **[Tutorial 4: Compound Workflows, Architectural Decisions, and Quota Guard](TUTORIALS/04-advanced-workflows.md)**  
   Advanced patterns: chaining compound slash commands (`/plan /boost /teamwork-preview /goal`), capturing Architectural Decision Records (ADRs) with automatic memory propagation, 1-click Ollama failover under provider quota limits, and recovering from unexpected daemon crashes.

---

## Prerequisites & Operational Setup
Before executing these workflows, ensure your local environment is configured:
- KIN Core Daemon running on `http://127.0.0.1:54321` (`npm run daemon --workspace=core`).
- KIN React UI running on `http://127.0.0.1:5173` (`npm run dev --workspace=ui`) or launched via the Tauri desktop app.
- For local offline inference, start Ollama (`ollama serve`) and pull a recommended coding model (`ollama pull qwen2.5-coder:7b`).
- For cloud inference, configure your API keys in **Settings & Credentials** (stored in encrypted SQLite vault).
