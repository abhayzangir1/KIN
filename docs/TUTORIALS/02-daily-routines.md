# Timers and recurring routines

KIN's source includes one-shot schedules and recurring five-field cron schedules. A schedule firing wakes an agent; it does not guarantee that the requested work finishes successfully.

## Try a one-time reminder

1. Use a disposable project and a harmless reminder.
2. Enter `/schedule 1m Report whether this reminder fired` in a channel.
3. Inspect the created schedule and its target channel/agent.
4. Confirm whether the wake-up message and agent run appear.
5. Cancel the schedule if it remains active.

## Try a recurring routine

Use a test project and a valid five-field cron expression, for example `*/15 * * * *`. Confirm the displayed next-run time and inspect schedule attempt state after a fire. Consider host local time and daylight-saving changes when using fixed calendar times.

## Before relying on a routine

Check that the target agent, model, tools, project, and channel are available. Inspect failure state and retry behavior. Do not treat a schedule record or `schedule:fired` UI event as proof the resulting task completed.
