# Before-and-after evidence in ship

Requested on 2026-10-29: make browser proof of visible changes a permanent part
of ship and its PR template. Step 5 now asks for matching before-and-after
captures, capture context, reviewer-accessible links, and a concrete explanation
when evidence is blocked or does not apply. Step 8 carries this into the PR body.
The bundled template asks for both revisions and outcomes. The existing policy
that a missing screenshot is a review finding rather than a gate stop is retained;
missing visual verification must stay pending. Plugin version increases to 0.4.1.

Two contract tests were written and seen failing before the instructions changed:

```text
not ok 1 visible UI evidence compares base and feature revisions in a real browser
# [[ "$five" == *'before-and-after screenshots or a short video'* ]] failed
not ok 2 bundled PR template asks for before and after evidence and capture context
# [[ "$body" == *'Before: link and base revision'* ]] failed
```

After the change, all 63 contract tests and all 270 QED Bats tests passed.
`git diff --check` passed. Independent review found no actionable plugin findings.

`make check PLUGIN=qed` stopped in the existing identifier lint: this environment's
account name is an ordinary word used throughout the unchanged plugin documents.
No files were changed to bypass it. ShellCheck and Claude Code are unavailable,
so their checks have not run. CI and the full QED ship gate remain pending.
This instruction/template change has no visible application screen to capture.
