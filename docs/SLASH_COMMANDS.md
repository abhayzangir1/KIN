# Slash command reference

The core parses these command inputs in `core/src/server/core_server.ts`. This table describes source-level intent; execution and model-backed outcomes depend on current project state and configuration.

| Input | Source-level purpose |
|---|---|
| `/goal` | Create or inspect a project goal; goal fields can be separated with `|`. |
| `/plan` | Request a goal and task breakdown. |
| `/teamwork`, `/teamwork-preview` | Show a workforce/readiness summary. |
| `/boost` | Start the boost workflow with a verification-oriented directive. |
| `/schedule`, `/timer` | Create a one-shot scheduled wake-up. |
| `/routine` | Create a recurring schedule using an interval or five-field cron expression. |
| `/skills`, `/skill` | List skills; subcommands include create and import. |
| `/btw` | Ask a side-channel question. |
| `/grill-me` | Start an architecture-question workflow. |
| `/decision`, `/decisions`, `/adr` | List or manage architecture decisions. |
| `/hire` | Create or configure a specialist. |
| `/assign` | Route work to a named specialist. |

The server also has a compound handler for combinations of `/plan`, `/boost`, `/teamwork-preview`, `/goal`, `/schedule`, and `/routine`. Compound handling is not an all-or-nothing transaction; inspect each resulting object and event.

Some commands create persistent records or start model-backed work. Confirm the active project/channel, selected agent, model availability, and the resulting state. A reply message alone does not establish that downstream work completed.
