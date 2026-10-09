# KIN FAQ

## Does KIN run locally?

The core service, UI, and SQLite application database run on the same machine by default. This does not mean every operation is offline. Hosted inference sends prompts and context to the selected provider; browser navigation and configured MCP tools can also use the network.

## Can I use a local model?

The source includes an Ollama integration. Ollama must be installed and running, and the selected model must be available. A catalog entry alone does not verify inference. Send a real request to confirm access.

## Which model providers can I configure?

The model gateway contains adapters and discovery paths for Ollama and several hosted providers, including OpenAI, Anthropic, OpenRouter, Gemini, DeepSeek, and Groq. A provider without a configured credential is not required to use a different provider. Model catalogs may include fallback entries; confirm the provider, model ID, and real request outcome before relying on an entry. Pricing, access, quotas, and availability are provider-controlled.

## Does KIN have a plugin marketplace?

The source includes MCP server configuration and tool integration, plus a skills system. That is not a general marketplace with centralized discovery, publisher verification, compatibility assurances, or managed updates.

## Are agents and computer actions sandboxed?

Application capability checks, approvals, filesystem path handling, and Git worktrees are present. These are not equivalent to host-level process, network, or credential isolation. Review tools, skills, MCP servers, and project permissions before use.

## What happens if a run or schedule fails?

The source has run recovery, schedule attempt records, and explicit retry paths. Their availability does not ensure that a particular interrupted task resumes or that a scheduled agent completes its work. Inspect the run, task, and schedule records.

## Can I use the desktop installer on another machine?

The repository contains a Tauri shell and Windows release assets. Check the release notes for artifact-specific caveats. Do not assume a binary is portable or that all Node/core dependencies are bundled unless that has been tested on the target machine.

## Where are implementation details?

See [Current implementation notes](PROJECT_STATUS.md), [Architecture](ARCHITECTURE.md), and [Operations](OPERATIONS.md). Product and technical requirements are future-facing specifications, not a feature verification report.
