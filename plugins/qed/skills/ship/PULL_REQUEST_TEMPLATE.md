## Why
One or two sentences. Problem and link to the plan or issue.

## What changed
- User-visible first, then internal. Flag anything surprising.

## How to review
Suggested file order. What needs thought, what is mechanical.

## Verification
- Checks: command and result
- Evidence: before-and-after screenshots or a short video for visible UI changes,
  accessible to reviewers; output for command/API changes, or why none
- Before: link and base revision
- After: link and feature revision
- Viewport, sample data, actions and outcomes; local stand-ins or live services
- Blocker or not applicable: reason and missing evidence
- Artifact retention / expiry: run URL, tested commit and expiration, or durable PR attachment
- Generated evidence is not committed; intentional fixtures and visual-regression baselines may be
- Break-verification: which guard was broken, the failure it printed

## Reviews
- Mode: combined | separate, and the one-line reason. Say if a sensitive category escalated it.
- Correctness (reviewer and model): N findings, fixed / logged
- Security: in a combined gate, the areas the one review checked and found clean; in a separate
  gate, the audit's own findings and clean areas
- Pre-existing: file, line, severity and type of findings in code this branch did not change; logged, not blocking
<details><summary>Full findings</summary>

</details>

## Risk
Low | Medium | High, one-line rationale. Backwards compatibility, deploy ordering, deferred follow-ups.
