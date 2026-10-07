# Slash command reference

This page lists command inputs found in the current CoreServer/UI source. It is not an end-to-end test report. Some commands create persistent state or start model-backed work, so results depend on the selected project, agent configuration, provider availability, and current implementation status. See the [current audit](../KIN_AUDIT_2026-10-07.md).

## Command inputs

| Input | Example | Source-level purpose |
|---|---|---|
| /goal | /goal Prepare a migration plan | Create a project goal. The handler also accepts optional description and criteria fields separated by vertical bars. |
| /plan | /plan Review the authentication flow | Request a goal/task breakdown and DAG setup. |
| /teamwork-preview or /teamwork | /teamwork-preview | Show a project workforce/readiness view. |
| /boost | /boost Review the deployment plan | Start the boost workflow and its verification-oriented prompt. |
| /schedule or /timer | /schedule 10m Check the build result | Register a one-time scheduled wake-up. |
| /routine | /routine 3600s Review open tasks | Register a recurring schedule using the supported interval or cron syntax. |
| /skills or /skill | /skills | List skill records. Subcommands include create and import. |
| /btw | /btw Which model is assigned to this agent? | Ask a side-channel question without creating a normal task DAG. |
| /grill-me | /grill-me Review the storage design | Start an architecture-question workflow. |
| /decision, /decisions, or /adr | /decision | List or manage architecture decisions. |
| /hire | /hire @Researcher Summarize technical documentation | Create or configure a specialist definition. |
| /assign | /assign @Researcher Review the open issue | Route an assignment to a named specialist. |

## Compound inputs

The server has a compound handler for combinations of /plan, /boost, /teamwork-preview, /goal, /schedule, and /routine. The UI also offers compound-command suggestions. This confirms that handlers exist in source; it does not establish atomicity, successful agent execution, or recovery if one step fails.

## Important limits

- Command suggestions in the chat composer are not proof that every suggested workflow completes.
- Model-backed commands require an available selected model.
- Scheduled work depends on the scheduler, project/channel state, and an available target agent.
- Startup actively admits and dispatches queued runs across platform restarts; verify task evidence and provider readiness when evaluating command outcomes.
- This list is based on source inspection on 2026-10-07 and may change with later commits.

For command-specific API behavior, see [API documentation](API.md). For unverified walkthroughs, see the [tutorial index](TUTORIALS.md).
