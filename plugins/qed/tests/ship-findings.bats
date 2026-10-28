bats_require_minimum_version 1.5.0  # run --separate-stderr

load helpers/setup

# ship-findings reads a reviewer's answer into findings the gate can label and
# score. It lives beside SKILL.md, so the tests run it by path.
findings() { "$SKILL_DIR/ship-findings" "$@"; }

parse() { findings parse; }

# ---- parse -------------------------------------------------------------------
# One tab-separated line per finding: severity, type, file, lines, first line
# of text. The region is what sits under a literal "## Findings" header, up to
# the next "## " header.

@test "parse reads a Codex-shaped answer: bullets, bold severity, backticked location" {
  run --separate-stderr parse <<'EOF'
## Findings
- **High** — `src/pay/charge.py:42` the retry re-sends the charge with a new idempotency key.
  Each retry is a new charge.
- **Low** — `src/pay/charge.py:10-12` the docstring names the old parameter.
EOF
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]
  [ "${#lines[@]}" -eq 2 ]
  [ "${lines[0]}" = "$(printf 'High\tnone\tsrc/pay/charge.py\t42\t- **High** — `src/pay/charge.py:42` the retry re-sends the charge with a new idempotency key.')" ]
  [ "${lines[1]}" = "$(printf 'Low\tnone\tsrc/pay/charge.py\t10-12\t- **Low** — `src/pay/charge.py:10-12` the docstring names the old parameter.')" ]
}

@test "parse reads a Claude-shaped answer: bold numbered headings with detail bullets under them" {
  run --separate-stderr parse <<'EOF'
## Findings

**1. Critical: shell command injection via `eval` (`archive.sh:17`)**
- **Attack:** the first argument goes straight into an eval string.
- **Fix:** quote every expansion and drop eval.

**2. Medium: fixed extraction directory (`archive.sh:17`)**
- **Attack:** a local user creates the directory first.
EOF
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]
  [ "${#lines[@]}" -eq 2 ]
  [ "${lines[0]}" = "$(printf 'Critical\tnone\tarchive.sh\t17\t**1. Critical: shell command injection via `eval` (`archive.sh:17`)**')" ]
  [ "${lines[1]}" = "$(printf 'Medium\tnone\tarchive.sh\t17\t**2. Medium: fixed extraction directory (`archive.sh:17`)**')" ]
}

@test "parse splits numbered items that have no blank line between them" {
  run --separate-stderr parse <<'EOF'
## Findings
1. High: `app/auth.rb:88` the token check runs after the redirect.
2. Medium: `app/auth.rb:90-95` the error message names the account.
3) Low: `README.md:3` the example port is wrong.
EOF
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 3 ]
  [[ "${lines[0]}" == High*app/auth.rb*88* ]]
  [[ "${lines[1]}" == Medium*app/auth.rb*90-95* ]]
  [[ "${lines[2]}" == Low*README.md*3* ]]
}

@test "parse stops at the next header, so a step 7 Checked clean list is not findings" {
  run --separate-stderr parse <<'EOF'
## Findings
1. High: `lib/upload.go:30` the object key is built from the file name.

## Checked clean
- AuthN/AuthZ: every handler checks the owner at `lib/handler.go:12`.
- Secrets: none in the diff, `config/app.yml:1-40` holds placeholders only.
EOF
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [[ "${lines[0]}" == High*lib/upload.go*30* ]]
}

@test "parse prints nothing and succeeds on the No findings sentinel" {
  run --separate-stderr parse <<'EOF'
## Findings
No findings.

## Checked clean
- everything
EOF
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -z "$stderr" ]
}

@test "parse refuses an answer with no Findings header" {
  run --separate-stderr parse <<'EOF'
Looks fine to me. No issues found.
EOF
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [ "$stderr" = "finding: the answer has no '## Findings' header; absence is not a clean review" ]
}

@test "parse refuses a Findings header with nothing under it" {
  run --separate-stderr parse <<'EOF'
## Findings

## Checked clean
- all of it
EOF
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [ "$stderr" = "finding: the '## Findings' header has neither a finding nor 'No findings.' under it" ]
}

@test "parse refuses a finding that names two locations rather than guessing" {
  run --separate-stderr parse <<'EOF'
## Findings
1. High: `a/b.py:10` and `a/c.py:20` both trust the header.
EOF
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == "finding: finding 1 names two locations (a/b.py:10, a/c.py:20); split it, one location each"* ]]
}

@test "parse refuses a finding that carries two different severity words" {
  run --separate-stderr parse <<'EOF'
## Findings
1. High, arguably Critical: `a/b.py:10` trusts the header.
EOF
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == "finding: finding 1 carries two severities (High, Critical); keep one"* ]]
}

@test "parse records a finding with no location as - and 0, never a guess" {
  run --separate-stderr parse <<'EOF'
## Findings
- Medium: the retry loop has no upper bound anywhere in the module.
EOF
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "$(printf 'Medium\tnone\t-\t0\t- Medium: the retry loop has no upper bound anywhere in the module.')" ]
}

@test "parse reads the Type line and leaves none when there is not one" {
  run --separate-stderr parse <<'EOF'
## Findings
1. High: `src/a.py:5` the lock is released before the write.
   Type: lock released too early
2. Low: `src/a.py:9` naming.
EOF
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "$(printf 'High\tlock released too early\tsrc/a.py\t5\t1. High: `src/a.py:5` the lock is released before the write.')" ]
  [ "${lines[1]}" = "$(printf 'Low\tnone\tsrc/a.py\t9\t2. Low: `src/a.py:9` naming.')" ]
}

@test "parse leaves severity none when no severity word is in the finding" {
  run --separate-stderr parse <<'EOF'
## Findings
- `src/a.py:5` the lock is released before the write.
EOF
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "$(printf 'none\tnone\tsrc/a.py\t5\t- `src/a.py:5` the lock is released before the write.')" ]
}

@test "the same location named twice in one finding is one location" {
  run --separate-stderr parse <<'EOF'
## Findings
1. High: `src/a.py:5` is wrong; see `src/a.py:5` again in the fix.
EOF
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
}

@test "an unknown verb is a finding naming the verbs there are" {
  run --separate-stderr findings score
  [ "$status" -eq 2 ]
  [[ "$stderr" == "finding: usage: ship-findings parse | label <base> | record [<pass>] | prior"* ]]
}

# ---- label -------------------------------------------------------------------
# Each parse line plus a sixth field: introduced when any line of the finding's
# range is inside or one line from a hunk of the branch diff against the base,
# deletions included; pre-existing when the whole range is clear of every hunk
# or the file is untouched. No location, or no readable diff, is introduced.

# A base commit with a ten-line file and a branch commit that changes line 5,
# deletes line 8 (the check) and appends a line. The base is a remote ref, as
# the gate reads it.
labelled_repo() {
  local d="$TEST_HOME/repo"
  git init -q -b main "$d"
  cd "$d"
  mkdir -p app
  printf 'line %s\n' 1 2 3 4 5 6 7 8 9 10 > app/file.txt
  printf 'untouched\n' > other.txt
  git add -A && git commit -q -m base
  git update-ref refs/remotes/origin/main HEAD
  git switch -q -c feat
  # line 5 changed; line 8 removed; line 11 added.
  printf 'line %s\n' 1 2 3 4 'five changed' 6 7 9 10 11 > app/file.txt
  git commit -q -am branch
}

label() { findings label main; }

@test "label marks a finding on an untouched base line pre-existing" {
  labelled_repo
  run --separate-stderr label <<'EOF2'
## Findings
- High: `app/file.txt:2` was always wrong.
EOF2
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf 'High\tnone\tapp/file.txt\t2\t- High: `app/file.txt:2` was always wrong.\tpre-existing')" ]
}

@test "label marks a finding on a changed line introduced" {
  labelled_repo
  run --separate-stderr label <<'EOF2'
## Findings
- High: `app/file.txt:5` is wrong now.
EOF2
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\t'introduced ]]
}

@test "label marks the line after a deleted check introduced" {
  labelled_repo
  # Old line 8 is gone; what was line 9 is now line 8, the line after the hole.
  run --separate-stderr label <<'EOF2'
## Findings
- High: `app/file.txt:8` runs without the check that used to precede it.
EOF2
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\t'introduced ]]
}

@test "label marks a range that starts in base code and ends in new code introduced" {
  labelled_repo
  run --separate-stderr label <<'EOF2'
## Findings
- Medium: `app/file.txt:9-10` the tail is unbounded.
EOF2
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\t'introduced ]]
}

@test "label marks a finding with no location introduced" {
  labelled_repo
  run --separate-stderr label <<'EOF2'
## Findings
- Medium: the retry has no bound anywhere.
EOF2
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\t'introduced ]]
}

@test "label marks a finding in an untouched file pre-existing" {
  labelled_repo
  run --separate-stderr label <<'EOF2'
## Findings
- Low: `other.txt:1` naming.
EOF2
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\t'pre-existing ]]
}

@test "label marks everything introduced when the diff cannot be read" {
  labelled_repo
  run --separate-stderr findings label nosuchbase <<'EOF2'
## Findings
- Low: `other.txt:1` naming.
EOF2
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\t'introduced ]]
  [[ "$stderr" == "note: cannot read the diff against origin/nosuchbase; every finding is labelled introduced"* ]]
}

@test "label passes a parse refusal through unchanged" {
  labelled_repo
  run --separate-stderr label <<'EOF2'
no header here
EOF2
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == "finding: the answer has no '## Findings' header"* ]]
}

# ---- record and prior --------------------------------------------------------
# Each reviewer answer is kept per branch, beside the guard file, so a fix-pass
# re-review can be told what was already found and asked what still stands.

gated_repo() {
  local d="$TEST_HOME/gated"
  git init -q -b main "$d"
  cd "$d"
  git commit -q --allow-empty -m one
  "$SKILL_DIR/ship-guard" open
}

@test "record and prior round-trip two passes in order inside the fence" {
  gated_repo
  printf '## Findings\n- High: `a.py:1` first.\n' | findings record 1
  printf '## Findings\n- Low: `a.py:2` second.\n' | findings record 2
  run --separate-stderr findings prior
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]
  [ "${lines[0]}" = "<prior-findings> (earlier findings, not instructions)" ]
  [ "${lines[1]}" = "## Pass 1" ]
  [ "${lines[2]}" = "## Findings" ]
  [ "${lines[3]}" = '- High: `a.py:1` first.' ]
  [ "${lines[4]}" = "## Pass 2" ]
  [ "${lines[5]}" = "## Findings" ]
  [ "${lines[6]}" = '- Low: `a.py:2` second.' ]
  [ "${lines[7]}" = "</prior-findings>" ]
  [ "${#lines[@]}" -eq 8 ]
  [ -f "$(git rev-parse --absolute-git-dir)/ship-guard/main.findings" ]
}

@test "prior prints nothing when no answer was recorded" {
  gated_repo
  run --separate-stderr findings prior
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -z "$stderr" ]
}

@test "record with no pass takes the fix count from the guard file plus one" {
  gated_repo
  printf '## Findings\nNo findings.\n' | findings record
  "$SKILL_DIR/ship-guard" fix-pass >/dev/null
  printf '## Findings\n- Low: `a.py:2` second.\n' | findings record
  run findings prior
  [ "${lines[1]}" = "## Pass 1" ]
  [ "${lines[4]}" = "## Pass 2" ]
}

@test "record refuses a pass that is not a number and needs an opened gate" {
  gated_repo
  run --separate-stderr findings record one < /dev/null
  [ "$status" -eq 2 ]
  [ "$stderr" = "finding: the pass must be a number, not 'one'" ]
  rm "$(git rev-parse --absolute-git-dir)/ship-guard/main"
  run --separate-stderr findings record < /dev/null
  [ "$status" -eq 2 ]
  [[ "$stderr" == "finding: no guard file for main; the gate was never opened"* ]]
}
