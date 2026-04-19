---
name: code-review-labotech
description: Reviews Labotech backend and frontend changes for streaming correctness, process safety, and API/UI contract risks. Use when the user asks for a review, audit, or risk assessment.
---

# Code Review Labotech

## Focus Areas

1. Verify stream path compatibility across encoder, transcoder, and forwarder stages.
2. Check process lifecycle safety (start/stop, rollback, orphan prevention).
3. Check shell/process security (`spawn`/`execFile`, no unsafe interpolation).
4. Validate API and frontend endpoint/proxy consistency.
5. Confirm tests cover changed logic and do not hide failures.

## Output Format

- List findings first, ordered by severity.
- Include file paths and clear impact for each finding.
- Add suggested fix per finding.
- If no issues found, state that explicitly and note residual risk or testing gaps.
