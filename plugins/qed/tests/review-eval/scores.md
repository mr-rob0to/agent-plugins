# Reviewer scores

What each reviewer command line found when `tests/review-eval/score` ran it
against a folder of cases: commits with a known bug at a known place, and
commits with none. A hit is a finding at Important or above that names the
expected file and a line inside the expected range. The score is a comparison
number between reviewers and between prompts, not a pass mark: the pass mark
for the security reviewer is still the fixture rule in
`tests/fixtures/security-review/expected.md`.

**The public cases are a smoke test of the pipeline, not a measurement.** The
three cases under `cases/public` are the fixture's own two planted defects and
its clean counterpart, and the fixture's comments name the bugs. Only the
operator's collection, cases in a private repository that never reach this
one, measures detection. Collection rows carry counts only.

## The rescore rule

A row is evidence about one reviewer line under one prompt. Changing a flag or
a model on the line, or a word of the prompt in `SKILL.md`, makes the row
evidence about something else. So a contract test in `tests/contract.bats`
reads every reviewer line the gate can run from `ship-env` and
`config/security-reviewer`, hashes the step 6 and step 7 prompts the way
`score` does, and requires a row for each line under each prompt it is used
with, carrying the current hash. The lines and the prompt each is scored
under:

- The Claude code-review line: the code prompt (step 6).
- The Sol floor, every tested Sol, and the Terra fallback: both prompts, since
  Codex reviews code when Claude wrote the branch and audits security always.
- The Claude security line: the security prompt (step 7).

`make check` fails until the new row exists. Run `score` on `cases/public`
for the line and prompt that changed, then on the operator's collection, and
add the row with the model id the run printed. A Sol chosen from Codex's
catalog at run time (`newest_sol any`) has no row unless it is also a tested
Sol; the pull request names it as unscored.

The Claude lines name an alias, `fable` or `opus`, that Claude Code resolves
to the newest model of that name. A new release under the same alias changes
nothing here, so it is not caught: when one ships, rescore the line by hand
and add a row with the new model id.

A row's prompt hash is `prompt=` as `score` printed it. Rows marked
`historical` predate the scorer and carry no hash; they are outside the rule
and kept for comparison.

Collection rows from 2026-10-29 carry two numbers when they differ: what
`score` counted, and what a person counted reading the kept answers by the
same rule, and dropping a location match whose text names a different bug than the case does. The gap is mostly the parser, not the reviewer: `ship-findings parse`
refuses a finding whose body mentions a second file and line, and the Claude
lines write that way often. Both numbers are kept because the gate runs the
parser, so the first is what the gate would see today, and the second is what
the reviewer actually found. "Not rerun" in the Public column means the public
smoke test for that line and hash is the row above it.

## Rows

| Date | Reviewer command line | Model id | Prompt | Prompt hash | Public | Collection | Run by |
|---|---|---|---|---|---|---|---|
| 2026-10-26 | `codex exec -m gpt-5.6-sol --sandbox read-only -c project_doc_max_bytes=0` | gpt-5.6-sol | security | historical | 2/2, 0 false alarms | not run | operator |
| 2026-10-26 | `codex exec -m gpt-6.1-sol --sandbox read-only -c project_doc_max_bytes=0` | gpt-6.1-sol | security | historical | 0/2, 0 false alarms | not run | operator |
| 2026-10-26 | `claude -p --safe-mode --disallowedTools WebFetch,WebSearch --model opus --effort high --permission-mode plan` | claude-opus-5-5 | security | historical | 2/2, 0 false alarms | not run | operator |
| 2026-10-27 | `claude -p --safe-mode --disallowedTools WebFetch,WebSearch --model fable --effort high --permission-mode plan` | claude-fable-5-1 | code | 41a519cabe70ff16b6995a9de524b0fdf482046a91cb12bc787a3b85eaa0bc94 | 2/2, 0 false alarms | not run | operator |
| 2026-10-27 | `codex exec -m gpt-5.6-sol --sandbox read-only -c project_doc_max_bytes=0` | gpt-5.6-sol | code | 41a519cabe70ff16b6995a9de524b0fdf482046a91cb12bc787a3b85eaa0bc94 | 2/2, 0 false alarms | not run | operator |
| 2026-10-27 | `codex exec -m gpt-5.6-sol --sandbox read-only -c project_doc_max_bytes=0` | gpt-5.6-sol | security | 8bf2fde10ac18f8fc3118f2f902ec8ec82829c6e3980279fa55b25727ac2f7f5 | 2/2, 0 false alarms | not run | operator |
| 2026-10-27 | `codex exec -m gpt-5.6-terra --sandbox read-only -c project_doc_max_bytes=0` | gpt-5.6-terra | code | 41a519cabe70ff16b6995a9de524b0fdf482046a91cb12bc787a3b85eaa0bc94 | 1/2, 0 false alarms (the injection finding named line 19, two lines off) | not run | operator |
| 2026-10-27 | `codex exec -m gpt-5.6-terra --sandbox read-only -c project_doc_max_bytes=0` | gpt-5.6-terra | security | 8bf2fde10ac18f8fc3118f2f902ec8ec82829c6e3980279fa55b25727ac2f7f5 | 2/2, 0 false alarms | not run | operator |
| 2026-10-27 | `claude -p --safe-mode --disallowedTools WebFetch,WebSearch --model opus --effort high --permission-mode plan` | claude-opus-5-5 | security | 8bf2fde10ac18f8fc3118f2f902ec8ec82829c6e3980279fa55b25727ac2f7f5 | 1/2, 0 false alarms (one answer unparsed: a finding named two locations) | not run | operator |
| 2026-10-29 | `claude -p --safe-mode --disallowedTools WebFetch,WebSearch --model fable --effort high --permission-mode plan` | claude-fable-5-1 | code | 41a519cabe70ff16b6995a9de524b0fdf482046a91cb12bc787a3b85eaa0bc94 | not rerun | 2/9, 2/5 false alarms (7 of 14 answers unparsed: 6 put a second location inside a finding, 1 came back as a trailing remark with the review text lost; read by hand, 4/9 and 2/5: one location match named a different bug and is not counted) | operator |
| 2026-10-29 | `codex exec -m gpt-5.6-sol --sandbox read-only -c project_doc_max_bytes=0` | gpt-5.6-sol | code | 41a519cabe70ff16b6995a9de524b0fdf482046a91cb12bc787a3b85eaa0bc94 | not rerun | 4/9, 0/5 false alarms (read by hand, 4/9: one counted hit named the expected lines but a different bug, a concurrency race, and is not counted; one miss wrote its location as a markdown link, which the parser does not read, and is) | operator |
| 2026-10-29 | `codex exec -m gpt-5.6-sol --sandbox read-only -c project_doc_max_bytes=0` | gpt-5.6-sol | security | 8bf2fde10ac18f8fc3118f2f902ec8ec82829c6e3980279fa55b25727ac2f7f5 | not rerun | 3/9, 2/5 false alarms | operator |
| 2026-10-29 | `claude -p --safe-mode --disallowedTools WebFetch,WebSearch --model opus --effort high --permission-mode plan` | claude-opus-5-5 | security | 8bf2fde10ac18f8fc3118f2f902ec8ec82829c6e3980279fa55b25727ac2f7f5 | not rerun | 1/9, 2/5 false alarms (10 of 14 answers unparsed: each put a second location inside a finding; read by hand, 6/9 and 1/5) | operator |
