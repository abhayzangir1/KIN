# Research workflow sketch

This is a suggested workflow, not a verified end-to-end tutorial. Model calls, browser access, and coordination depend on configuration. Review the [current audit](../../KIN_AUDIT_2026-10-07.md) before relying on the result.

## Before you start

- Select a project and confirm the agent identities and models you intend to use.
- Confirm a model can answer a simple prompt.
- If using browser tools, confirm the browser opens the intended destination and that the page content is observable.
- Do not send private or restricted material to a hosted model or external site unless you intend to share it with that provider.

## Suggested sequence

1. State the research question, source requirements, and what would count as a useful answer.
2. Use /goal to record the objective and /plan to request a task breakdown.
3. Review the proposed tasks and confirm which agent, model, and tools are appropriate.
4. Ask the research agent to inspect named primary sources. Record the page URL, relevant passage, and access date for each claim.
5. Ask a second agent or a human to check the evidence and distinguish direct source statements from interpretation.
6. Review the final summary yourself. Do not treat generated text or a “verified” label as proof that a source was checked.

## What to inspect

- Did the selected agent actually run?
- Did the browser reach the intended source?
- Are the cited pages represented in the saved result?
- Do important statements distinguish evidence from inference?
- Did the task finish with evidence that matches the acceptance criteria?

The workflow is useful for exploring the project, but this page does not guarantee a three-agent swarm, persistent browser login, or an authoritative research report.
