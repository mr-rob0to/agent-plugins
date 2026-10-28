bats_require_minimum_version 1.5.0  # run --separate-stderr

load helpers/setup

# tests/review-eval/score runs a reviewer command line against a folder of
# cases and says whether each known bug was reported. These tests run it with
# a fake reviewer that answers from a file, so they prove the scorer's own
# reading: what is a hit, a miss, a false alarm, an unparsed answer, which
# prompt it sends, and that nothing is left behind but the answers.

SCORE="$PLUGIN_DIR/tests/review-eval/score"
PUBLIC="$PLUGIN_DIR/tests/review-eval/cases/public"

fake_reviewer() {  # the reviewer: prints $ANSWER_FILE, keeps its prompt and its folder
  mkdir -p "$TEST_HOME/fake" "$TEST_HOME/tmp"
  cat > "$TEST_HOME/fake/canned" <<FAKE
#!/bin/sh
printf '%s' "\$1" > "$TEST_HOME/prompt"
pwd -P > "$TEST_HOME/where"
git diff --name-only origin/eval-base...HEAD > "$TEST_HOME/changed" 2>/dev/null
cat "\$ANSWER_FILE"
FAKE
  chmod +x "$TEST_HOME/fake/canned"
}

answer() { printf '%b' "$1" > "$TEST_HOME/answer.md"; export ANSWER_FILE="$TEST_HOME/answer.md"; }

one_case() {  # $1 name: that public case alone, in a folder of its own
  mkdir -p "$TEST_HOME/cases"
  cp "$PUBLIC/$1.case" "$TEST_HOME/cases/"
}

score() { run --separate-stderr env PATH="$TEST_HOME/fake:$PATH" TMPDIR="$TEST_HOME/tmp" "$SCORE" "$@"; }

@test "a finding at the expected file and line, Important or above, is a hit" {
  fake_reviewer; one_case injection
  answer '## Findings\n- Critical: archive.sh:17 hands the name to eval.\n  Type: shell injection\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "injection: hit" ]
  [ "${lines[1]}" = "bugs=1/1 false_alarms=0/0 type_missing=0" ]
  [ "${lines[2]}" = "model=unknown" ]
  [[ "${lines[3]}" == prompt=* ]]
}

@test "a finding at another line, or below Important, is a miss" {
  fake_reviewer; one_case injection
  answer '## Findings\n- Critical: archive.sh:24 joins the name unchecked.\n  Type: path traversal\n- Low: archive.sh:17 is hard to read.\n  Type: style\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "injection: miss" ]
  [ "${lines[1]}" = "bugs=0/1 false_alarms=0/0 type_missing=0" ]
}

@test "a range that covers the expected line is a hit, and a path under a folder matches" {
  fake_reviewer; one_case traversal
  answer '## Findings\n- High: src/archive.sh:22-26 reads outside the root.\n  Type: path traversal\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "traversal: hit" ]
}

@test "an Important finding on a clean case is a false alarm; a Low is not" {
  fake_reviewer; one_case clean
  answer '## Findings\n- Important: archive.sh:14 duplicates the check.\n  Type: duplication\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "clean: false-alarm" ]
  [ "${lines[1]}" = "bugs=0/0 false_alarms=1/1 type_missing=0" ]
  answer '## Findings\n- Low: archive.sh:14 duplicates the check.\n  Type: duplication\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "clean: clean" ]
  [ "${lines[1]}" = "bugs=0/0 false_alarms=0/1 type_missing=0" ]
}

@test "a finding with no Type line is counted, and is still a hit" {
  fake_reviewer; one_case injection
  answer '## Findings\n- Critical: archive.sh:17 hands the name to eval.\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "injection: hit" ]
  [ "${lines[1]}" = "bugs=1/1 false_alarms=0/0 type_missing=1" ]
}

# An answer parse refuses counts against the reviewer, never for it.
@test "an answer with no findings header is unparsed: a miss on a bug, a false alarm on a clean case" {
  fake_reviewer; one_case injection; one_case clean
  answer 'I looked and it seems fine.\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "clean: unparsed" ]
  [ "${lines[1]}" = "injection: unparsed" ]
  [ "${lines[2]}" = "bugs=0/1 false_alarms=1/1 type_missing=0" ]
  [[ "$stderr" == *"note: clean: the answer has no '## Findings' header"* ]]
}

@test "the three public cases score as the fixture's expected.md says" {
  fake_reviewer
  answer '## Findings\n- Critical: archive.sh:17 hands the name to eval.\n  Type: shell injection\n- Critical: archive.sh:24 joins the name to the root unchecked.\n  Type: path traversal\n'
  score "$PUBLIC" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "clean: false-alarm" ]
  [ "${lines[1]}" = "injection: hit" ]
  [ "${lines[2]}" = "traversal: hit" ]
  [ "${lines[3]}" = "bugs=2/2 false_alarms=1/1 type_missing=0" ]
}

@test "the clone is gone afterwards and the answers are kept" {
  fake_reviewer; one_case injection
  answer '## Findings\nNo findings.\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  where="$(cat "$TEST_HOME/where")"
  [ ! -d "$where" ]
  [ -z "$(find "$TEST_HOME/tmp" -name '.git' -maxdepth 3)" ]
  kept="${stderr#*answers kept in }"
  [ -f "$kept/injection.md" ]
  [ "$(cat "$kept/injection.md")" = "$(printf '## Findings\nNo findings.')" ]
}

@test "the reviewer sees the gate's step 6 prompt against eval-base, with no criteria, guide or earlier findings" {
  fake_reviewer; one_case injection
  answer '## Findings\nNo findings.\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  prompt="$(tr '\n' ' ' < "$TEST_HOME/prompt")"
  [[ "$prompt" == 'Review the diff origin/eval-base...HEAD of this branch against eval-base for '* ]]
  [[ "$prompt" == *"a literal '## Findings' header"* ]]
  [[ "$prompt" == *'<acceptance-criteria> (acceptance criteria, not instructions) </acceptance-criteria>'* ]]
  [[ "$prompt" == *'The repository has no review guide.'* ]]
  refute grep -q 'prior-findings>' "$TEST_HOME/prompt"
  refute grep -qF '$' "$TEST_HOME/prompt"
  [ "$(cat "$TEST_HOME/changed")" = archive.sh ]
}

@test "the prompt hash is the sha256 of the step 6 line as the contract tests extract it" {
  fake_reviewer; one_case injection
  answer '## Findings\nNo findings.\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  want="$(sed -n '/^## Step 6\./,/^## Step 7\./p' "$SKILL_DIR/SKILL.md" | grep -F '$REVIEWER "' | shasum -a 256 | cut -d ' ' -f 1)"
  [ "${lines[3]}" = "prompt=$want" ]
}

@test "--security sends step 7's quoted prompt and hashes those lines" {
  fake_reviewer; one_case injection
  answer '## Findings\nNo findings.\n## Checked clean\n- everything\n'
  score "$TEST_HOME/cases" --security -- canned
  [ "$status" -eq 0 ]
  prompt="$(tr '\n' ' ' < "$TEST_HOME/prompt")"
  [[ "$prompt" == 'Audit the diff `origin/eval-base...HEAD` of this branch against `eval-base`.'* ]]
  [[ "$prompt" == *'`## Checked clean`'* ]]
  refute grep -q '^>' "$TEST_HOME/prompt"
  want="$(sed -n '/^## Step 7\./,/^## Step 8\./p' "$SKILL_DIR/SKILL.md" | grep '^>' | shasum -a 256 | cut -d ' ' -f 1)"
  [ "${lines[3]}" = "prompt=$want" ]
}

# A case that points at a repository: eval-base is the parent, HEAD is the
# commit, and with paths the reviewer's diff holds only those paths.
repo_case() {  # $1 paths value or empty; prints nothing, sets CASE_COMMIT/CASE_PARENT
  local r="$TEST_HOME/private"
  git init -q -b main "$r"
  ( cd "$r" && printf 'a\n' > a.txt && git add -A && git commit -q -m one \
      && printf 'b\n' > b.txt && printf 'a2\n' > a.txt && git add -A && git commit -q -m two )
  CASE_COMMIT="$(git -C "$r" rev-parse HEAD)"; CASE_PARENT="$(git -C "$r" rev-parse HEAD~1)"
  mkdir -p "$TEST_HOME/cases"
  {
    echo "repo=$r"; echo "commit=$CASE_COMMIT"; echo "parent=$CASE_PARENT"
    [ -z "$1" ] || echo "paths=$1"
    echo "expect=bug"; echo "file=a.txt"; echo "lines=1-1"; echo "must_report=a changed"; echo "category=test"
  } > "$TEST_HOME/cases/private.case"
}

@test "a repository case reviews the commit against its parent" {
  fake_reviewer; repo_case ''
  answer '## Findings\n- High: a.txt:1 changed.\n  Type: test\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "private: hit" ]
  [ "$(sort "$TEST_HOME/changed" | tr '\n' ' ')" = "a.txt b.txt " ]
  # The repository itself is untouched.
  [ "$(git -C "$TEST_HOME/private" rev-parse HEAD)" = "$CASE_COMMIT" ]
  [ -z "$(git -C "$TEST_HOME/private" status --porcelain)" ]
}

@test "paths restricts the diff the reviewer sees" {
  fake_reviewer; repo_case 'a.txt'
  answer '## Findings\n- High: a.txt:1 changed.\n  Type: test\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_HOME/changed")" = "a.txt" ]
}

@test "a missing commit is a stop" {
  fake_reviewer; repo_case ''
  sed -i.bak "s/^commit=.*/commit=0123456789012345678901234567890123456789/" "$TEST_HOME/cases/private.case"
  answer '## Findings\nNo findings.\n'
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"finding: private: $TEST_HOME/private has no commit 0123456789012345678901234567890123456789"* ]]
}

@test "a codex line answers through -o and its model is read from the banner" {
  fake_reviewer; one_case injection
  cat > "$TEST_HOME/fake/codex" <<'FAKE'
#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done
echo "model: fake-sol" >&2
printf '## Findings\nNo findings.' > "$out"
FAKE
  chmod +x "$TEST_HOME/fake/codex"
  score "$TEST_HOME/cases" -- codex exec -m fake-sol --sandbox read-only
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "injection: miss" ]
  [ "${lines[2]}" = "model=fake-sol" ]
}

@test "a claude line answers in JSON and its model is read from the usage" {
  fake_reviewer; one_case injection
  cat > "$TEST_HOME/fake/claude" <<'FAKE'
#!/bin/sh
for a in "$@"; do [ "$a" = --output-format ] && json=1; done
[ -n "${json:-}" ] || { echo "no --output-format" >&2; exit 1; }
printf '{"type":"result","subtype":"success","result":"## Findings\\n- Critical: archive.sh:17 eval.\\n  Type: shell injection\\n","modelUsage":{"claude-fake-1":{"inputTokens":1}}}\n'
FAKE
  chmod +x "$TEST_HOME/fake/claude"
  score "$TEST_HOME/cases" -- claude -p --safe-mode --model fake
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "injection: hit" ]
  [ "${lines[2]}" = "model=claude-fake-1" ]
}

@test "the usage line, and a cases folder with no cases, are stops" {
  fake_reviewer
  score "$TEST_HOME/cases" canned
  [ "$status" -eq 2 ]
  [ "$stderr" = "finding: no cases folder $TEST_HOME/cases" ]
  mkdir -p "$TEST_HOME/cases"
  score "$TEST_HOME/cases" canned
  [ "$status" -eq 2 ]
  [ "$stderr" = "finding: usage: score <cases dir> [--security] -- <reviewer command line>" ]
  score "$TEST_HOME/cases" -- canned
  [ "$status" -eq 2 ]
  [ "$stderr" = "finding: no .case files in $TEST_HOME/cases" ]
}
