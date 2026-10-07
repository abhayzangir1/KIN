# Timers and recurring routines: workflow sketch

This page describes a way to explore the schedule features. It has not been verified end to end against the current checkout. In particular, persistence does not by itself prove that a due run will be dispatched after a restart.

## Try a one-time schedule

1. Start the core and UI.
2. In a test project, enter a harmless request such as:

~~~text
/schedule 1m Report whether the test reminder fired
~~~

3. Check the response and the automation/schedule view for a created record.
4. Leave the application running and check whether the trigger is delivered to the expected channel.
5. Repeat with a controlled restart before relying on schedules across restarts.

The command handler supports duration-style inputs. Check the current slash-command handler for accepted syntax rather than assuming every natural-language duration works.

## Try a recurring routine

Use a harmless task and a short interval in a test project. Confirm the created routine, target channel, target agent, and next-run time. Verify that repeated triggers do not create unintended duplicate work.

## Check before relying on it

- Confirm the target agent has a usable model and required tools.
- Check the schedule's persisted status after creation and after restart.
- Confirm what happens when a run is already active or the provider is unavailable.
- Cancel the test schedule and verify that it no longer fires.

The scheduler and schedule records exist in source. This page does not promise quiescent run suspension, exact restart recovery, or successful delivery under every condition.
