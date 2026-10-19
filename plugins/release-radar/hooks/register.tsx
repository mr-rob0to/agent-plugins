import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Change, ChangeKind, RepoView, Section, Summary } from '../types'

const PANE = 'release-radar'
const MAX_SUMMARIES_KEPT = 150

const reposAtom = atom({ plugin: 'release-radar', key: 'repos' } as const, [])
const selectedAtom = atom({ plugin: 'release-radar', key: 'selected' } as const, null)
const viewAtom = atom({ plugin: 'release-radar', key: 'view' } as const, null)
const openAtom = atom({ plugin: 'release-radar', key: 'openSection' } as const, null)
const rawAtom = atom({ plugin: 'release-radar', key: 'showRaw' } as const, false)
const summariesAtom = atom({ plugin: 'release-radar', key: 'summaries' } as const, {})
const noticeAtom = atom({ plugin: 'release-radar', key: 'notice' } as const, null)

// The three groups a reader sees. `maintenance` (dependency bumps, CI, tests,
// docs, refactors) is classified so it can be counted, but stays out of the
// notes: people reading release notes do not need it.
const SHOWN_KINDS = ['new', 'improved', 'fixed'] as const
const HEADINGS: Record<(typeof SHOWN_KINDS)[number], string> = {
  new: '🚢 New Features',
  improved: '🔧 Improvements',
  fixed: '🐛 Bug Fixes',
}

export function shownChanges(changes: readonly Change[]): Change[] {
  return changes.filter(c => c.kind !== 'maintenance')
}

// --- GitHub ---------------------------------------------------------------

class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type GitHubCommit = {
  sha: string
  commit: { message: string; author?: { name?: string } }
  author?: { login?: string } | null
}

type GitHubRelease = {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
}

export function parseRepo(text: string): string | undefined {
  const trimmed = text.trim()
  const fromUrl = trimmed.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  if (fromUrl) return `${fromUrl[1]}/${fromUrl[2]}`
  const plain = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)

  return plain ? `${plain[1]}/${plain[2]}` : undefined
}

export function classify(title: string, author = ''): ChangeKind {
  if (/\[bot\]$|^dependabot|^renovate/i.test(author)) return 'maintenance'
  if (/^(feat|feature)(\(.+?\))?!?:|^add(s|ed)?\b|^introduc|^new\b|^support\b/i.test(title)) return 'new'
  if (/^(fix|bugfix|hotfix)(es|ed)?(\(.+?\))?!?:?|^(bug|resolve|correct)/i.test(title)) return 'fixed'
  if (/^(chore|ci|build|test|tests|docs?|style|refactor|deps|bump|revert|release|lint|typo)\b/i.test(title)) {
    return 'maintenance'
  }

  return 'improved'
}

function cleanTitle(title: string): string {
  const stripped = title.replace(/^\w+(\(.+?\))?!?:\s*/, '').trim()

  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

export function changesFromCommits(commits: readonly GitHubCommit[]): Change[] {
  const seen = new Set<string>()
  const changes: Change[] = []

  for (const c of commits) {
    const lines = c.commit.message.split('\n').map(line => line.trim())
    const first = lines[0] ?? ''
    if (/^Merge (branch|remote-tracking branch|tag)\b/.test(first)) continue

    let title = first
    let number: number | undefined
    const merge = first.match(/^Merge pull request #(\d+) from/)
    if (merge) {
      number = Number(merge[1])
      title = lines.slice(1).find(line => line.length > 0) ?? first
    } else {
      const ref = first.match(/\s*\(#(\d+)\)\s*$/)
      if (ref) {
        number = Number(ref[1])
        title = first.slice(0, ref.index).trim()
      }
    }
    if (title.length === 0) continue

    const author = c.author?.login ?? c.commit.author?.name
    const kind = classify(title, author)
    const clean = cleanTitle(title)
    const dedupeKey = clean.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    changes.push({ title: clean, kind, number, author })
  }

  // Newest first, as people read release notes.
  return changes.reverse()
}

/**
 * Orders tags newest first the way people read versions: numeric parts compare
 * as numbers (`v1.10.0` is newer than `v1.9.0`), and a pre-release
 * (`v1.0.0-beta.6`) is older than the release it leads up to (`v1.0.0`).
 */
export function compareTagsNewestFirst(a: string, b: string): number {
  const pa = tagParts(a)
  const pb = tagParts(b)
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === y) continue
    // One ran out: `1.0` is older than `1.0.1`, but newer than `1.0-beta`.
    if (x === undefined) return y !== undefined && isNumber(y) ? 1 : -1
    if (y === undefined) return isNumber(x) ? -1 : 1
    if (isNumber(x) && isNumber(y)) {
      if (Number(x) !== Number(y)) return Number(y) - Number(x)
      continue
    }
    // A number against a word at the same spot: `1.0.0` is newer than `1.0.rc`.
    if (isNumber(x) !== isNumber(y)) return isNumber(x) ? -1 : 1

    return y.localeCompare(x)
  }

  return 0
}

function tagParts(tag: string): string[] {
  return tag
    .trim()
    .toLowerCase()
    .replace(/^v(?=\d)/, '')
    .split(/[^0-9a-z]+/)
    .filter(part => part.length > 0)
}

function isNumber(part: string): boolean {
  return /^\d+$/.test(part)
}

// --- Markdown -------------------------------------------------------------

export function changesMarkdown(repo: string, changes: readonly Change[]): string {
  const blocks: string[] = []
  for (const kind of SHOWN_KINDS) {
    const ofKind = changes.filter(c => c.kind === kind)
    if (ofKind.length === 0) continue
    const bullets = ofKind.map(c =>
      c.number === undefined
        ? `- ${c.title}`
        : `- ${c.title} ([#${c.number}](https://github.com/${repo}/pull/${c.number}))`,
    )
    blocks.push(`### ${HEADINGS[kind]}\n${bullets.join('\n')}`)
  }
  const hidden = changes.length - shownChanges(changes).length
  if (hidden > 0) {
    blocks.push(`_Plus ${hidden} behind-the-scenes change${hidden === 1 ? '' : 's'} (tests, CI, dependencies, docs)._`)
  }

  return blocks.join('\n\n')
}

function rawMarkdown(repo: string, section: Section): string {
  if (section.changes.length > 0) return changesMarkdown(repo, section.changes)
  if (section.body && section.body.trim().length > 0) return section.body
  if (section.isPartial) return '_Loading the changes in this release…_'

  return section.isUpcoming
    ? '_Nothing has been merged since the last release._'
    : '_No changes found for this release._'
}

function summaryKey(repo: string, section: Section): string {
  // Base and head both: the upcoming section keeps its head when a new tag
  // moves its base, and the summary must move with it.
  return `${repo}@${section.id}@${section.base ?? ''}..${section.head ?? ''}`
}

// --- The module -----------------------------------------------------------

const config = { token: '', extraRepos: [] as string[], model: 'haiku', isSummaryOff: false }

let tokenPromise: Promise<string | undefined> | undefined

function token($: EngineInterface): Promise<string | undefined> {
  if (config.token.length > 0) return Promise.resolve(config.token)
  tokenPromise ??= $.process
    .run(['gh', 'auth', 'token'], { timeoutMs: 10_000 })
    .then(r => (r.exitCode === 0 && r.stdout.trim().length > 0 ? r.stdout.trim() : undefined))
    .catch(() => undefined)

  return tokenPromise
}

async function gh<T>($: EngineInterface, path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'claude-code-release-radar',
  }
  const auth = await token($)
  if (auth) headers.Authorization = `Bearer ${auth}`
  const res = await $.http.fetch(`https://api.github.com${path}`, { headers })
  if (!res.ok) {
    const isRateLimited = res.status === 403 && res.headers['x-ratelimit-remaining'] === '0'
    const message = isRateLimited
      ? auth
        ? 'GitHub rate limit reached. Try again in a few minutes.'
        : 'GitHub rate limit reached. Run `gh auth login` or add a token in this mod\'s settings.'
      : res.status === 404
        ? 'GitHub could not find that repo, or your login cannot see it.'
        : res.status === 401
          ? 'GitHub rejected the token. Check the token in this mod\'s settings or run `gh auth login`.'
          : `GitHub answered ${res.status}.`
    throw new GitHubError(res.status, message)
  }

  return JSON.parse(res.text) as T
}

async function currentRepo($: EngineInterface): Promise<string | undefined> {
  try {
    const r = await $.process.run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 })

    return r.exitCode === 0 ? parseRepo(r.stdout) : undefined
  } catch {
    return undefined
  }
}

async function pinnedRepos($: EngineInterface): Promise<string[]> {
  const stored = await $.store.get('pinned')

  return Array.isArray(stored) ? stored.filter((one): one is string => typeof one === 'string') : []
}

async function loadRepos($: EngineInterface): Promise<void> {
  const here = await currentRepo($)
  const pinned = await pinnedRepos($)
  let mine: string[] = []
  if (await token($)) {
    try {
      const list = await gh<{ full_name: string }[]>(
        $,
        '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      )
      mine = list.map(r => r.full_name)
    } catch (error) {
      await update($, noticeAtom, () => `Could not list your repos: ${messageOf(error)}`)
    }
  } else {
    await update($, noticeAtom, () =>
      'Not signed in to GitHub, so only public repos you add by name will load. Run `gh auth login` or add a token in this mod\'s settings.',
    )
  }

  const all = [here, ...pinned, ...config.extraRepos, ...mine].filter((one): one is string => one !== undefined)
  const unique = [...new Set(all)]
  await update($, reposAtom, () => unique)

  const selected = await read($, selectedAtom)
  const pick = selected ?? unique[0]
  if (pick && pick !== selected) await selectRepo($, pick)
}

async function selectRepo($: EngineInterface, repo: string, force = false): Promise<void> {
  await update($, selectedAtom, () => repo)
  await $.store.set('lastSelected', repo)
  const view = await read($, viewAtom)
  if (!force && view?.repo === repo && !view.error && view.fetchedAt && (await $.clock.now()) - view.fetchedAt < 10 * 60_000) {
    return
  }
  await loadView($, repo)
}

async function loadView($: EngineInterface, repo: string): Promise<void> {
  await update($, viewAtom, () => ({ repo, sections: [], isLoading: true }))
  try {
    const info = await gh<{ default_branch: string }>($, `/repos/${repo}`)
    const branch = info.default_branch
    // Releases first for their notes, but tags decide what the newest release
    // is: a repo that tags every release and publishes a GitHub Release for
    // only some of them would otherwise count months of shipped work as
    // "upcoming". Tags come back from GitHub in name order, not version
    // order, so they are sorted here.
    const [releases, tags] = await Promise.all([
      gh<GitHubRelease[]>($, `/repos/${repo}/releases?per_page=10`).then(list => list.filter(r => !r.draft)),
      gh<{ name: string }[]>($, `/repos/${repo}/tags?per_page=100`),
    ])
    const releaseByTag = new Map(releases.map(r => [r.tag_name, r]))
    const names = [...new Set([...tags.map(t => t.name), ...releases.map(r => r.tag_name)])].sort(
      compareTagsNewestFirst,
    )
    const released: Section[] = names.slice(0, 10).map((tag, i) => {
      const r = releaseByTag.get(tag)

      return {
        id: tag,
        name: r?.name && r.name.trim().length > 0 ? r.name : tag,
        isUpcoming: false,
        date: r?.published_at ?? undefined,
        url: r?.html_url ?? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
        isPrerelease: r?.prerelease,
        body: r?.body ?? undefined,
        changes: [],
        base: names[i + 1],
        head: tag,
        isPartial: true,
      }
    })

    const base = released[0]?.head
    let commits: GitHubCommit[]
    let head = branch
    if (base) {
      const compare = await gh<{ commits: GitHubCommit[]; ahead_by: number }>(
        $,
        `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`,
      )
      commits = compare.commits
      head = compare.commits.at(-1)?.sha ?? base
    } else {
      commits = (await gh<GitHubCommit[]>($, `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=50`)).reverse()
      head = commits.at(-1)?.sha ?? branch
    }

    const upcoming: Section = {
      id: 'upcoming',
      name: base ? `Upcoming release (since ${base})` : 'Upcoming release',
      isUpcoming: true,
      url: base ? `https://github.com/${repo}/compare/${base}...${branch}` : `https://github.com/${repo}/commits/${branch}`,
      changes: changesFromCommits(commits),
      base,
      head,
    }
    const sections = [upcoming, ...released]
    const view: RepoView = { repo, defaultBranch: branch, sections, fetchedAt: (await $.clock.now()), isLoading: false }
    if ((await read($, selectedAtom)) !== repo) return
    await update($, viewAtom, () => view)
    await update($, openAtom, open => (open && sections.some(s => s.id === open) ? open : 'upcoming'))
    const open = await read($, openAtom)
    if (open) await prepareSection($, repo, open, false)
  } catch (error) {
    if ((await read($, selectedAtom)) !== repo) return
    await update($, viewAtom, () => ({ repo, sections: [], isLoading: false, error: messageOf(error) }))
  }
}

async function sectionOf($: EngineInterface, repo: string, id: string): Promise<Section | undefined> {
  const view = await read($, viewAtom)

  return view?.repo === repo ? view.sections.find(s => s.id === id) : undefined
}

async function replaceSection($: EngineInterface, repo: string, section: Section): Promise<void> {
  await update($, viewAtom, view =>
    view && view.repo === repo
      ? { ...view, sections: view.sections.map(s => (s.id === section.id ? section : s)) }
      : view,
  )
}

/** Fetches a released section's commits when its notes are thin, then summarizes it. */
async function prepareSection($: EngineInterface, repo: string, id: string, force: boolean): Promise<void> {
  let section = await sectionOf($, repo, id)
  if (!section) return

  if (section.isPartial) {
    const hasNotes = (section.body ?? '').trim().length >= 40
    let changes: Change[] = []
    if (!hasNotes && section.head) {
      try {
        const commits = section.base
          ? (
              await gh<{ commits: GitHubCommit[] }>(
                $,
                `/repos/${repo}/compare/${encodeURIComponent(section.base)}...${encodeURIComponent(section.head)}`,
              )
            ).commits
          : (await gh<GitHubCommit[]>($, `/repos/${repo}/commits?sha=${encodeURIComponent(section.head)}&per_page=50`)).reverse()
        changes = changesFromCommits(commits)
      } catch (error) {
        await update($, noticeAtom, () => `Could not load the changes in ${section?.name}: ${messageOf(error)}`)
      }
    }
    section = { ...section, changes, isPartial: false }
    await replaceSection($, repo, section)
  }

  await summarize($, repo, section, force)
}

async function summarize($: EngineInterface, repo: string, section: Section, force: boolean): Promise<void> {
  if (config.isSummaryOff) return
  const key = summaryKey(repo, section)
  const known = (await read($, summariesAtom))[key]
  if (!force && (known?.isWorking || known?.text)) return

  const hasNotes = (section.body ?? '').trim().length > 0
  const shown = shownChanges(section.changes)
  if (shown.length === 0 && !hasNotes) return

  if (!force) {
    const stored = await $.store.get(`summary:${key}`)
    if (typeof stored === 'string') {
      await setSummary($, key, { text: stored, isWorking: false })

      return
    }
  }

  await setSummary($, key, { isWorking: true })
  const source =
    shown.length > 0
      ? `Changes (commit and pull request titles, newest first):\n${shown
          .slice(0, 250)
          .map(c => `- ${c.title}${c.number === undefined ? '' : ` (#${c.number})`}`)
          .join('\n')}`
      : `The release's own notes:\n\n${(section.body ?? '').slice(0, 20_000)}`

  const result = await $.model.complete({
    model: config.model,
    maxTokens: 1500,
    system:
      'You write release notes for people who use the software but do not read its code. Be plain, short and concrete.',
    prompt: `Repository: ${repo}
Release: ${section.name}${section.isUpcoming ? ' (not released yet: these are the changes merged since the last release)' : ''}

${source}

Write release notes in Markdown:
- Start with one or two sentences on what this release means for someone using it.
- Then group the changes under these headings, leaving out any that would be empty: "### 🚢 New Features", "### 🔧 Improvements", "### 🐛 Bug Fixes". Use exactly these headings, emoji included, and no others.
- One short plain-English bullet per change. Merge near-duplicates. Keep pull request numbers like (#123) at the end of a bullet.
- Leave out dependency bumps, CI, tests, docs and refactors entirely.
- No preamble and no closing remarks.`,
  })

  if (result.isAnswered) {
    const text = result.text.replace(/\(#(\d+)\)/g, `([#$1](https://github.com/${repo}/pull/$1))`)
    await setSummary($, key, { text, isWorking: false })
    await keepSummary($, key, text)
  } else {
    await setSummary($, key, { isWorking: false, error: `The summary could not be written (${result.reason}).` })
  }
}

async function setSummary($: EngineInterface, key: string, summary: Summary): Promise<void> {
  await update($, summariesAtom, all => ({ ...all, [key]: summary }))
}

async function keepSummary($: EngineInterface, key: string, text: string): Promise<void> {
  await $.store.set(`summary:${key}`, text)
  const kept = await $.store.get('summaryKeys')
  const list = Array.isArray(kept) ? kept.filter((one): one is string => typeof one === 'string' && one !== key) : []
  list.push(key)
  for (const old of list.splice(0, Math.max(0, list.length - MAX_SUMMARIES_KEPT))) {
    await $.store.delete(`summary:${old}`)
  }
  await $.store.set('summaryKeys', list)
}

async function addRepo($: EngineInterface, text: string): Promise<boolean> {
  const repo = parseRepo(text)
  if (!repo) {
    await update($, noticeAtom, () => `"${text}" is not a repo. Use owner/name, like vercel/next.js.`)

    return false
  }
  const pinned = await pinnedRepos($)
  if (!pinned.includes(repo)) await $.store.set('pinned', [repo, ...pinned].slice(0, 50))
  await update($, reposAtom, list => [repo, ...list.filter(one => one !== repo)])
  await update($, noticeAtom, () => null)
  await selectRepo($, repo, true)

  return true
}

async function toggleSection($: EngineInterface, id: string): Promise<void> {
  const open = await read($, openAtom)
  const next = open === id ? null : id
  await update($, openAtom, () => next)
  const repo = await read($, selectedAtom)
  if (next && repo) await prepareSection($, repo, next, false)
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Release radar' })
  if ((await read($, reposAtom)).length === 0) await loadRepos($)
}

export const register: Register = (on, options) => {
  config.token = String(options.githubToken ?? '').trim()
  config.extraRepos = String(options.extraRepos ?? '')
    .split(',')
    .map(one => parseRepo(one))
    .filter((one): one is string => one !== undefined)
  config.model = String(options.summaryModel ?? 'haiku').trim() || 'haiku'
  config.isSummaryOff = config.model.toLowerCase() === 'off'
  tokenPromise = undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'releases',
      description: 'Show upcoming and past release notes for a GitHub repo',
      argumentHint: '[owner/repo]',
    })
    const last = await $.store.get('lastSelected')
    if (typeof last === 'string' && (await read($, selectedAtom)) === null) {
      await update($, selectedAtom, () => last)
    }

    return next(e)
  })

  on('command.run', { command: 'releases' }, async ($, e) => {
    await openPane($)
    const arg = e.args.trim()
    if (arg.length > 0) {
      const isAdded = await addRepo($, arg)

      return { text: isAdded ? `Showing release notes for ${parseRepo(arg)}.` : `"${arg}" is not a repo; use owner/name.` }
    }

    return { text: 'Release radar pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const repos = await read($, reposAtom)
    const selected = await read($, selectedAtom)
    const view = await read($, viewAtom)
    const open = await read($, openAtom)
    const showRaw = config.isSummaryOff || (await read($, rawAtom))
    const summaries = await read($, summariesAtom)
    const notice = await read($, noticeAtom)

    let picker = (
      <Box flexDirection="column">
        {repos.slice(0, 8).map(repo => (
          <Button key={`repo:${repo}`} plain onPress={() => void selectRepo($, repo)}>
            {repo === selected ? '● ' : '○ '}
            {repo}
          </Button>
        ))}
      </Box>
    )
    if (e.surface !== 'mobile') {
      const { Select, Input } = $.ui.resolve(e)
      const options = repos.map(repo => ({ value: repo, label: repo }))
      picker = (
        <Box flexDirection="column" gap={1}>
          {options.length > 0 && (
            <Select
              key="repo"
              label="Repo"
              options={options}
              value={selected ?? undefined}
              onSelect={value => void selectRepo($, value)}
            />
          )}
          <Input
            key="add-repo"
            label="Add a repo"
            placeholder="owner/name or a GitHub URL"
            submitLabel="show"
            onSubmit={value => void addRepo($, value)}
          />
        </Box>
      )
    }

    const body: RenderChildren[] = []
    if (repos.length === 0 && !selected) {
      body.push(<Text dimColor>Finding your repos…</Text>)
    } else if (!view || view.isLoading) {
      body.push(<Text dimColor>Loading releases for {selected ?? view?.repo}…</Text>)
    } else if (view.error) {
      body.push(<Text color="red">{view.error}</Text>)
    } else {
      for (const section of view.sections) {
        const isOpen = section.id === open
        const shownCount = shownChanges(section.changes).length
        const count = section.isPartial ? '' : `${shownCount} change${shownCount === 1 ? '' : 's'}`
        const meta = [
          section.date ? section.date.slice(0, 10) : '',
          section.isPrerelease ? 'pre-release' : '',
          section.isUpcoming ? count : '',
        ]
          .filter(part => part.length > 0)
          .join(' · ')
        body.push(
          <Button key={`section:${section.id}`} plain onPress={() => void toggleSection($, section.id)}>
            {isOpen ? '▾ ' : '▸ '}
            {section.isUpcoming ? '🚀 ' : '🏷️ '}
            <Text bold>{section.name}</Text>
            {meta.length > 0 && <Text dimColor> {meta}</Text>}
          </Button>,
        )
        if (!isOpen) continue

        const summary = summaries[summaryKey(view.repo, section)]
        const raw = rawMarkdown(view.repo, section)
        const link = section.url ? `\n\n[View on GitHub](${section.url})` : ''
        body.push(
          <Box key={`body:${section.id}`} flexDirection="column" paddingLeft={2} gap={1}>
            {!showRaw && summary?.isWorking && <Text dimColor>Writing a plain-language summary…</Text>}
            {!showRaw && summary?.error && <Text color="yellow">{summary.error}</Text>}
            <Markdown text={(!showRaw && summary?.text ? summary.text : raw) + link} dimColor={!showRaw && summary?.isWorking} />
            <Box gap={2}>
              {!config.isSummaryOff && (
                <Button key={`raw:${section.id}`} label={showRaw ? 'Show summary' : 'Show full list'} onPress={() => void update($, rawAtom, value => !value)} />
              )}
              {!config.isSummaryOff && !showRaw && (
                <Button
                  key={`resummarize:${section.id}`}
                  label="Rewrite summary"
                  onPress={() => void prepareSection($, view.repo, section.id, true)}
                />
              )}
            </Box>
          </Box>,
        )
      }
    }

    return (
      <Box flexDirection="column" gap={1} width={e.props.bodyColumns}>
        {picker}
        <Box gap={2}>
          <Button key="refresh" label="Refresh" onPress={() => void (selected ? selectRepo($, selected, true) : loadRepos($))} />
          <Button key="reload-repos" label="Reload repo list" onPress={() => void loadRepos($)} />
        </Box>
        {notice && <Text color="yellow">{notice}</Text>}
        {body}
      </Box>
    )
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    if ((await read($, reposAtom)).length === 0) void loadRepos($)

    return opened
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
