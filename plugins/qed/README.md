# qed

Skills for software delivery. One so far: `ship`.

The name comes from Q.E.D., short for the Latin *quod erat demonstrandum*,
"which was to be shown". Mathematicians write it at the end of a proof. These
skills work the same way: a change is done when it has been shown to work, not
when someone says it does.

To install, see [Install](../../README.md#install) in the repository's README.

## ship

`ship` takes a finished branch through a pre-merge gate and stops at the first
thing that is wrong. In order, it:

1. Finds the branch the pull request should target, and stops if the
   repository's own signals disagree.
2. Decides whether the branch gets one combined review, or separate correctness
   and security reviews. Anything touching sign-in or permissions, secrets,
   migrations, stored data, concurrency, or the order of deploys gets separate
   reviews.
3. Runs the project's own checks.
4. Sends the diff to a fresh, read-only reviewer that does not load the
   repository's own instruction files. When the branch needs it, a second
   reviewer does a security pass.
5. Records which commit each check and review saw. If a commit lands after them,
   the push is refused until they run again.
6. Pushes without overwriting commits it has not seen, and opens or updates the
   pull request from the repository's own template. The body ends with a hidden
   note naming the commit each check and review saw.
7. Watches CI until it is green.

It never merges. That stays with you.

### Running it

- Claude Code: `/qed:ship`.
- Codex: `$qed:ship`.
- Anywhere else: ask the agent to follow the installed `SKILL.md`. It needs to
  know which folder that file is in; if it cannot tell, the gate stops and says
  how to set it.

The gate needs bash, `git`, `jq`, the GitHub CLI `gh` signed in, and a reviewer
on your `PATH`: `codex`, or failing that `claude`.

### Choosing the reviewers

Out of the box both reviewers are set to `auto`:

- **Code review:** the vendor that did not write the branch. The gate says
  which harness it runs in, so a branch written in Codex goes to Claude Code in
  plan mode, which can read the code but not change it, and any other branch
  goes to `codex`. With only one of them installed, that one reviews, and the
  pull request says when it is the author's own vendor.
- **Security review:** Claude Code on Opus in plan mode, whoever wrote the
  branch; the pull request says so when the branch is Claude's own. Opus found
  both planted defects in `tests/fixtures/security-review` and invented nothing
  against the clean file. Codex on Sol passed the same fixtures and is the
  written alternative: put its line in your own `security-reviewer` file (the
  bundled note shows it). Without `claude`, a branch that needs a security
  review stops rather than running a reviewer nobody has tested.

The code review always uses the newest version of its model. Claude Code is
given `fable`, which it resolves to the newest Fable. Codex has no such name, so
the gate reads Codex's model list on every run and takes the Sol that Codex
ranks first, falling back to `gpt-5.6-sol` with a note when Codex lists none.
A Sol chosen from that list has no score row of its own (see Scoring a
reviewer below) and the pull request names it as unscored. The pull request
names the model that ran either way.

To choose your own, write a command line into a file:

- `~/.config/ship/reviewer` for the code review.
- `~/.config/ship/security-reviewer` for the security review.

When `XDG_CONFIG_HOME` is set, the files go in `$XDG_CONFIG_HOME/ship/`
instead. The gate adds the review prompt to the end of your command as one
argument. Lines starting with `#` are notes. The bundled files in
`skills/ship/config/` explain each choice. Copy one and edit the copy: an update
replaces the bundled files, never yours.

In Claude Code only, `security-reviewer` may say `agent:<name>` to use one of
your agents. Any other harness stops the gate on that value.

### Briefing the reviewers with REVIEW.md

A repository can brief both reviewers with a `REVIEW.md` at its root. The gate
reads it from the base branch only, as it is on `origin/<base>` after the
fetch, never from the branch under review or the working tree: a branch must
not write its own reviewer's brief. The text travels inside a fence marked as
data, after the acceptance criteria, and the prompt tells the reviewer what it
is for. Keep it under 16 KB; a bigger file stops the gate rather than being
cut. Three headings are enough:

- **Failures**: what this repository counts as a defect, in its own terms. A
  lost write, a double charge, a screen that shows the wrong user.
- **Not worth a finding**: what reviewers should not spend a finding on here.
  Naming, formatting, a style the repository has chosen on purpose.
- **Paths to leave alone**: generated code, vendored code, fixtures. A path
  listed here waives nitpicks only. It does not narrow the sensitive categories
  that force separate reviews, and it does not narrow the security coverage
  list.

A line in the guide that reads as an instruction to the reviewer is a guide
written badly, and the prompt says so; it is not followed.

### Introduced or pre-existing

Every finding a reviewer returns is labelled against the branch diff.
A finding whose lines touch, or sit one line from, anything the branch changed
is `introduced` and is the branch's to fix. A finding in code the branch did
not touch is `pre-existing`: it is logged in the pull request as file, line,
severity and type, and it blocks nothing. The one exception is a pre-existing
Critical or High from the security audit, where the gate stops and asks,
because a branch that makes a live hole visible is your call. A finding with
no file and line, or one the gate cannot place, counts as introduced: the
error is on the blocking side.

### Re-reviews that converge

A fix pass does not send the whole branch again. The re-review reads from the
commit the reviewers last saw to the new head, kept only once every phase of
the gate was recorded, and is shown every earlier
answer, fenced as data, with the rule: do not repeat a finding already listed,
and report one that still stands as `Unresolved:` with its number. Each
finding carries a `Type:` line, the kind of bug in a few words, and before
fixing one the gate looks through the branch diff for other instances of that
kind and fixes them in the same pass. The three-pass cap is unchanged.

### Scoring a reviewer

`tests/review-eval/score` runs a reviewer command line against a folder of
cases, commits with a known bug at a known place and commits with none, and
says for each whether the bug was reported at Important or above, at the
expected file and line:

```bash
plugins/qed/tests/review-eval/score plugins/qed/tests/review-eval/cases/public -- codex exec -m gpt-5.6-sol --sandbox read-only -c project_doc_max_bytes=0
```

Add `--security` before the `--` to score under the security prompt. The three
public cases are the fixture's own planted defects and are a smoke test of the
pipeline, not a measurement; a real measurement needs a private collection of
real bugs, which never reaches this repository. The results and the rescore
rule live in `tests/review-eval/scores.md`: every reviewer line the gate can
run needs a row under the current prompt, and `make check` fails when a line
or a prompt changes without one.

### Requiring the gate in CI

The gate ends every pull request body with a hidden attestation naming the
commit each check and review saw. A repository can make GitHub refuse to merge
a head the gate never covered: call the reusable workflow and mark its job a
required status check in a branch ruleset.

```yaml
name: ship-attestation
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
permissions:
  contents: read
  pull-requests: read
jobs:
  attestation:
    uses: mr-rob0to/agent-plugins/.github/workflows/ship-attestation.yml@main
```

The check passes when the body carries exactly one attestation, it names the
pull request's head, and every phase its review mode owes is bound to that
head. A pull request whose every file is prose only a person reads passes
without one, because the gate skips it. Run the same check by hand with
`skills/ship/ship-attest-check verify <head-sha> < body.md`.

It is evidence, not proof: the session that ran the gate writes the
attestation. What it adds is that a commit pushed after the reviews, or a body
left over from an earlier push, turns the check red.

### What the gate does not cover

- It does not merge, and it does not settle design questions. It stops and asks.
- It reads the diff, not the running app. Run the app yourself.
- A reviewer you name yourself is not isolated for you. `auto` tells the
  reviewer to ignore the reviewed repository's own instruction files; your own
  command line gets no such treatment.
- The reviewer still reads the code, and the code can contain text written to
  steer it. Skipping instruction files does not stop that.
- It trusts your machine. Anyone who can edit your config files or the installed
  skill can change what the gate does.
- A repository you open can define its own `ship` skill and take the bare
  `/ship` name. `/qed:ship` always means this one.
- It works with GitHub only. The pull request and the CI watch go through `gh`.
- Token counts for a review come only from `codex`. Any other reviewer's are
  reported as `unknown`.
