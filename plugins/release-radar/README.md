# release-radar

A pane that shows, for any GitHub repo you pick from a dropdown:

- **Upcoming release**: everything merged since the last release, in plain-language release notes.
- **Past releases**: the last 10 releases (or tags), each summarized the same way.

Type `/releases` to open it, or `/releases owner/name` to jump straight to a repo.

## Install

```sh
claude plugin marketplace add mr-rob0to/agent-plugins
claude plugin install release-radar@mr-rob0to
```

Then start a new session in Claude Code desktop (or run `/reload-plugins`) and type `/releases`.

## Sign in to GitHub

The mod reads GitHub with the GitHub CLI's login. If you haven't already:

```sh
gh auth login
```

No `gh`? Add a GitHub token (read access to your repos) in `/config` under **release-radar → GitHub token** instead.
Without either, only public repos load, and GitHub limits you to 60 requests an hour.

## Settings (`/config`)

- **GitHub token**: optional, used instead of `gh`.
- **Extra repos**: comma-separated `owner/name` repos to always list.
- **Summary model**: the model that writes the summaries (`haiku` by default). Set it to `off` to see the raw change list only.

## How it works

- The repo list is the repo of the folder you're in, any repos you've added, and your GitHub repos sorted by most recent push.
- "Upcoming" compares the newest tag with the default branch and reads the merged pull requests and commits in between. Tags are ordered as versions (`v1.10.0` is newer than `v1.9.0`, and `v1.0.0-beta.6` is older than `v1.0.0`), so a repo that tags releases without publishing a GitHub Release for each one still starts "Upcoming" at the right place.
- Past releases are the newest 10 tags. One with a GitHub Release shows the notes written there; otherwise, the commits between that tag and the one before it.
- Changes are grouped into 🚢 New Features, 🔧 Improvements and 🐛 Bug Fixes. Dependency bumps, CI, tests, docs and refactors are left out of the notes; the full list says how many there were. Summaries are cached, so each release is summarized once.
