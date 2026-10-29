# Native reviewers in ship

Requested on 2026-10-29: let the enclosing AI harness use a fresh built-in
reviewer instead of launching another command-line session. Codex selects a
native Codex Sol model; Claude Code selects a native Claude Fable model.

The host verifies actual tools, fresh context, read-only behavior and selectable
models before advertising `SHIP_NATIVE_REVIEW`. The helper prefers that capability
for auto code review. Explicit operator commands retain priority; hosts without
native tools keep the existing command selection. Native selectors are dispatched
directly by model, never through a repository-defined agent name.

Native results use the existing prompts, finding parser, prior findings, commit
binding, phase recordings and fix-pass limits. Missing/malformed answers, a moved
head, reviewer writes, invalid capabilities and unavailable explicit selectors
fail closed. Native usage is in-session unless actual host metadata is supplied.

Separate security reviews retain the qualified-model restriction. The host must
verify the exact qualified model before advertising its native availability.
A newer code-review model is not automatically a qualified security model.
Existing security-model scores do not establish a native-transport evaluation;
live fixture evaluation of that transport remains pending. Read-only is a reviewer
instruction unless enforced by the harness; no OS sandbox is claimed by default.

## Evidence

Before implementation, seven of nine new selection tests failed against the old
helper. The two already passing cases were explicit command priority and refusal
to invent an unavailable security reviewer. The native-workflow contract test
also failed before the workflow instructions were added.

After implementation all nine selection tests and all five new native workflow
contract/completion tests passed. The completion tests exercise the actual shell
block from the skill, including changed-head, dirty-worktree and malformed-answer
refusals, rather than a copied implementation.

Each new important protection was deliberately removed in a temporary copy and
the named test failed, then the copy was restored:

```text
not ok 1 native security selects only a qualified available Codex model
not ok 1 unknown native host capability fails rather than choosing a CLI
not ok 1 an explicit native selector fails without the matching host capability
not ok 1 native completion refuses a changed head
not ok 1 native completion refuses reviewer writes
not ok 1 native completion refuses missing or malformed answers
```

Each failure printed `[ "$status" -eq 2 ] failed`: removing the protection made
its refused case succeed. The temporary mutations never changed the branch.

The plugin version increases to 0.5.0. This change is independent of the pending
visual-evidence update. This is a delivery-workflow change, so application
screenshots do not apply. Actual native code review was exercised with a fresh
built-in Sol reviewer in another feature branch. Claude native dispatch and a live
native security-transport qualification run remain pending; shell fixture tests
validate their selection protocol without claiming those live checks happened.
