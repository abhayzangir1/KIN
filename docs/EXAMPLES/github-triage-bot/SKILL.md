---
name: github-triage-bot
version: 1.0.0
description: >
  Example scaffold; its included handler returns a fixed approval-style result and does not inspect a GitHub pull request.
skill_type: tool_extension
enabled: true
required_tools:
  - readFile
  - executeShell
trigger_patterns:
  - triage
  - review
  - pr
  - diff
  - github
  - pull-request
parameters:
  strictMode: true
  maxDiffLines: 1000
---

# GitHub Triage Bot Skill

> Example only. The included implementation returns a fixed approval verdict and claims checks passed without inspecting a diff or running tests. Do not use its output as a code review.

This skill guides automated agents through evaluating pull requests, reviewing git diffs, and checking architectural regressions.

## When to Use
Activate this skill whenever:
- Reviewing incoming pull requests or unmerged feature branches.
- Inspecting git diffs for breaking changes or missing unit tests.
- Auditing filesystem boundaries and input validation before merging.

## Step-by-Step Procedure

1. **Extract Changed Files**:
   - Query git status or diff files using `git diff --name-status main`.
   - Separate documentation/asset changes from core logic and API controllers.

2. **Inspect Diff Chunks**:
   - Verify that all newly introduced parameters are validated.
   - Confirm that external input paths honor strict filesystem jail boundaries.
   - Submit files to AI review via `POST /api/projects/:id/git/review`.

3. **Verify Test Suites**:
   - Run affected test suites via `executeShell`.
   - Ensure all existing and new test suites pass without skips or weakening.

4. **Construct Triage Report**:
   - Format results into a clear review comment:
     - **Change Classification**: Feature, bugfix, refactor, or documentation.
     - **Risk Assessment**: Low, medium, or high based on affected subsystems.
     - **Test Results**: Exact test suites executed and status.
     - **Recommendation**: Approve, request changes, or escalate for human review.
