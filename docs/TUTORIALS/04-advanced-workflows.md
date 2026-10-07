# Compound commands and architecture decisions: workflow sketch

The CoreServer contains handlers for several slash commands and combinations of them. This guide is a way to explore those inputs; it is not a claim that a compound request is atomic or that every generated task will complete.

## Try a small request

1. Start in a disposable project with a working model.
2. Use /goal to state one bounded objective.
3. Use /plan to request a small task breakdown.
4. Inspect the created goal, tasks, dependencies, and agent assignments before allowing execution.
5. If a decision is needed, record the options and rationale, then ask a human to choose.
6. After execution, inspect the changed files, logs, and task evidence instead of relying on a generated summary.

The UI also suggests compound inputs such as /plan /boost /teamwork-preview. Treat each component as a separate action and confirm its result. The presence of a compound handler does not provide rollback or all-or-nothing behavior if a step fails.

Architecture decision records preserve a chosen rationale. They do not automatically make every agent follow that decision in every later run; inspect the context and task state where the decision matters.

## Review checklist

- Did every requested command produce a distinct result?
- Were unexpected tasks or schedules created?
- Is task completion backed by evidence that matches the acceptance criteria?
- Does the saved decision accurately capture the human's choice?
- Can the work be safely cancelled or retried?

See the [current audit](../../KIN_AUDIT_2026-10-07.md) for current state and verification limits.
