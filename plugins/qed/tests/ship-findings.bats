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
