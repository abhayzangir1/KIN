# Contributing to KIN

KIN is an open-source, local-first workspace for AI chats and agent workflows. It is under active development; some reliability, security, and desktop behaviors remain incomplete.

## Contribution principles

1. **Local-first data handling:** keep application state on the user's machine by default. Make hosted model, browser, and MCP data flows explicit; do not claim data remains local when an integration sends it elsewhere.
2. **Durability as an engineering goal:** persist important state and add recovery coverage for changes to SQLite, runs, tasks, or checkpoints. Describe recovery guarantees only when they have been demonstrated.
3. **Bounded execution:** document the actual limits of concurrency, worktree separation, and desktop control. A worktree or Node VM is not an operating-system sandbox.
4. **Evidence-based communication:** separate source presence from tested behavior and avoid unsupported claims in product copy and documentation.

## Development setup

### Requirements

- Node.js 20 or later
- npm
- Rust and Cargo only when building the Tauri shell
- Ollama only when testing local inference

### Install, build, and run

~~~sh
git clone https://github.com/abhayzangir1/KIN.git
cd KIN
npm install
npm run build
~~~

Start the core daemon and UI in separate terminals:

~~~sh
npm run daemon --workspace=core
~~~

~~~sh
npm run dev --workspace=ui
~~~

The core binds to 127.0.0.1 by default. Do not expose it to a network without reviewing the authentication and origin policy.

## Reporting issues

Before filing, search existing issues. Include:

- A concise summary and reproducible steps
- Expected and actual behavior
- Operating system, Node version, and relevant app commit
- Whether inference used Ollama or a hosted provider
- Relevant logs with API keys, bearer tokens, private URLs, and workspace secrets removed

## Pull requests

- Keep changes focused and explain the user problem they address.
- Include tests for changed behavior where practical; do not remove or skip tests to make a change pass.
- Describe exactly what you ran and what remains unverified.
- For documentation, distinguish product requirements from implemented behavior.
- For security-sensitive changes, trace the full path from UI/API input through authorization, execution, persistence, and events.

## Engineering expectations

- Preserve strict TypeScript checking and use explicit types where practical.
- Use parameterized database operations and backward-compatible migrations.
- Route tool actions through the intended authorization boundary and make empty capabilities deny access.
- Treat skill, MCP, browser, and shell inputs as untrusted; do not describe them as sandboxed unless a real isolation boundary exists.
- Do not claim an operation succeeded based only on a UI event or generated evidence row.

## Useful commands

~~~sh
npm run build
npm test --workspace=core
~~~

Report test results from the exact checkout and environment used. A successful type check or unit test suite does not by itself establish a provider call, desktop interaction, recovery flow, or packaged installation.
