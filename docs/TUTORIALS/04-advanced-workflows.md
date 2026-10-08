# Compound commands and architecture decisions

The server has handlers for individual and compound slash-command inputs. Compound input processing is a sequence of actions, not an atomic transaction. Inspect what was created before relying on it.

## Suggested sequence

1. Start with a bounded objective in a test project.
2. Use `/goal` or `/plan` and inspect the created goal, tasks, and dependencies.
3. Use `/teamwork-preview` to inspect available agents and model status.
4. Record consequential choices through the decision workflow and confirm the saved rationale.
5. Inspect the run, files, test output, and evidence before calling the work complete.

The UI may suggest compound inputs such as `/plan /boost /teamwork-preview`. Each part can have side effects, and a later failure does not automatically roll back earlier actions.
