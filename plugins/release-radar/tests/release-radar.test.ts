import { expect, mock, test } from 'claude-code/testing'

import { changesFromCommits, changesMarkdown, classify, compareTagsNewestFirst, parseRepo } from '../hooks/register'

const REPO = 'acme/widgets'

function commit(message: string, login = 'dev') {
  return { sha: Math.random().toString(16).slice(2), commit: { message }, author: { login } }
}

const API: Record<string, unknown> = {
  [`/repos/${REPO}`]: { default_branch: 'main' },
  [`/repos/${REPO}/releases?per_page=10`]: [
    {
      tag_name: 'v1.1.0',
      name: 'v1.1.0',
      body: '## What changed\n- Added dark mode to the settings screen\n- Fixed a crash on startup',
      html_url: `https://github.com/${REPO}/releases/tag/v1.1.0`,
      draft: false,
      prerelease: false,
      published_at: '2026-10-01T10:00:00Z',
    },
  ],
  [`/repos/${REPO}/tags?per_page=100`]: [{ name: 'v1.1.0' }, { name: 'v1.0.0' }],
  [`/repos/${REPO}/compare/v1.1.0...main`]: {
    ahead_by: 3,
    commits: [
      commit('feat: export reports as CSV (#12)'),
      commit('fix(login): keep people signed in after an update (#13)'),
      commit('chore(deps): bump lodash (#14)', 'dependabot[bot]'),
    ],
  },
  '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member': [
    { full_name: REPO },
    { full_name: 'acme/gadgets' },
  ],
}

const PANE_PROPS = {
  title: 'Release radar',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

test('parses repos and sorts changes into plain groups', async () => {
  expect(parseRepo('git@github.com:acme/widgets.git\n')).toBe(REPO)
  expect(parseRepo('https://github.com/acme/widgets')).toBe(REPO)
  expect(parseRepo('acme/widgets')).toBe(REPO)
  expect(parseRepo('not a repo')).toBe(undefined)
  expect(classify('feat: add things')).toBe('new')
  expect(classify('Fix crash')).toBe('fixed')
  expect(classify('Bump x', 'dependabot[bot]')).toBe('maintenance')

  const tags = ['v1.0.0-beta.6', 'v1.9.0', '1.0.0', 'v1.10.0', 'v1.0.0-rc.1', 'v1.0.1', 'v1.0.0-beta.10']
  expect([...tags].sort(compareTagsNewestFirst)).toEqual([
    'v1.10.0',
    'v1.9.0',
    'v1.0.1',
    '1.0.0',
    'v1.0.0-rc.1',
    'v1.0.0-beta.10',
    'v1.0.0-beta.6',
  ])

  const changes = changesFromCommits([
    commit('Merge pull request #5 from x/y\n\nAdd search to the home page'),
    commit("Merge branch 'main' into feature"),
  ])
  expect(changes).toEqual([{ title: 'Add search to the home page', kind: 'new', number: 5, author: 'dev' }])

  const markdown = changesMarkdown(REPO, [
    { title: 'Export reports as CSV', kind: 'new', number: 12 },
    { title: 'Keep people signed in after an update', kind: 'fixed', number: 13 },
    { title: 'Bump lodash', kind: 'maintenance', number: 14 },
    { title: 'Faster start-up', kind: 'improved' },
  ])
  expect(markdown).toBe(
    [
      '### 🚢 New Features\n- Export reports as CSV ([#12](https://github.com/acme/widgets/pull/12))',
      '### 🔧 Improvements\n- Faster start-up',
      '### 🐛 Bug Fixes\n- Keep people signed in after an update ([#13](https://github.com/acme/widgets/pull/13))',
      '_Plus 1 behind-the-scenes change (tests, CI, dependencies, docs)._',
    ].join('\n\n'),
  )
})

test('shows upcoming changes with a summary, on every surface with a pane', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_800_000_000_000 })
  on('process.run', async (_$, e) => {
    const stdout = e.argv[0] === 'gh' ? 'test-token\n' : `git@github.com:${REPO}.git\n`

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', async (_$, e) => {
    const path = e.url.replace('https://api.github.com', '')
    const body = API[path]
    expect(e.init?.headers?.Authorization).toBe('Bearer test-token')

    return {
      value:
        body === undefined
          ? { status: 404, ok: false, headers: {}, text: '{}' }
          : { status: 200, ok: true, headers: {}, text: JSON.stringify(body) },
    }
  })
  on('model.complete', async (_$, e) => {
    expect(e.prompt).toContain('### 🚢 New Features')
    expect(e.prompt).not.toContain('lodash')

    return {
      value: {
        isAnswered: true as const,
        text: 'People can now export reports.\n\n### 🚢 New Features\n- Export reports as CSV (#12)',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'release-radar',
      surface,
      component: 'Pane',
      requestId: 'release-radar',
      props: PANE_PROPS,
    })
    if (surface === 'terminal') await ui.press({ key: 'reload-repos' })
    expect(await ui.find({ key: 'repo' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /export reports/ })).toBeDefined()
    expect(await ui.find({ key: 'section:v1.1.0' })).toBeDefined()

    const upcoming = await ui.find({ key: 'section:upcoming' })
    expect(upcoming?.text).toContain('🚀')
    expect(upcoming?.text).toContain('2 changes')
    expect((await ui.find({ key: 'section:v1.1.0' }))?.text).toContain('🏷️')
    await ui.press({ key: 'raw:upcoming' })
    expect(await ui.find({ type: 'Markdown', text: /🐛 Bug Fixes/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /Plus 1 behind-the-scenes change/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /Behind the scenes/ })).toBe(undefined)
    await ui.press({ key: 'raw:upcoming' })
    await ui.unmount()
  }
})

// A repo that tags every release but only published a GitHub Release for an old
// pre-release. The upcoming section must start at the newest tag, not at the
// newest Release, or it lists months of already-shipped work as "upcoming".
const TAGGED = 'acme/tagged'
const TAGGED_API: Record<string, unknown> = {
  [`/repos/${TAGGED}`]: { default_branch: 'main' },
  [`/repos/${TAGGED}/releases?per_page=10`]: [
    {
      tag_name: 'v1.0.0-beta.6',
      name: 'v1.0.0-beta.6',
      body: '## Beta 6\n- The sixth beta, with the onboarding flow and the new crew screens',
      html_url: `https://github.com/${TAGGED}/releases/tag/v1.0.0-beta.6`,
      draft: false,
      prerelease: true,
      published_at: '2026-07-23T17:07:01Z',
    },
  ],
  [`/repos/${TAGGED}/tags?per_page=100`]: [
    { name: 'v1.0.0-beta.6' },
    { name: 'v1.0.3' },
    { name: 'v1.0.1' },
    { name: 'v1.0.10' },
  ],
  [`/repos/${TAGGED}/compare/v1.0.10...main`]: {
    ahead_by: 1,
    commits: [commit('fix(battle): let an invitee answer a 1v1 (#182)')],
  },
  [`/repos/${TAGGED}/compare/v1.0.0-beta.6...main`]: {
    ahead_by: 2,
    commits: [commit('feat: months of shipped work (#100)'), commit('fix: more shipped work (#101)')],
  },
  [`/repos/${TAGGED}/compare/v1.0.3...v1.0.10`]: {
    ahead_by: 1,
    commits: [commit('feat(settings): show Change password only to accounts with a password (#180)')],
  },
}

test('starts the upcoming release at the newest tag, even when the newest GitHub Release is older', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_800_000_000_000 })
  on('process.run', async (_$, e) => {
    const stdout = e.argv[0] === 'gh' ? 'test-token\n' : `git@github.com:${TAGGED}.git\n`

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', async (_$, e) => {
    const path = e.url.replace('https://api.github.com', '')
    const body = TAGGED_API[path]

    return {
      value:
        body === undefined
          ? { status: 404, ok: false, headers: {}, text: '{}' }
          : { status: 200, ok: true, headers: {}, text: JSON.stringify(body) },
    }
  })
  on('model.complete', async () => ({ value: { isAnswered: false as const, reason: 'refused' } }))

  const ui = await $.ui.mount({
    plugin: 'release-radar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'release-radar',
    props: PANE_PROPS,
  })
  await ui.press({ key: 'reload-repos' })

  const upcoming = await ui.find({ key: 'section:upcoming' })
  expect(upcoming?.text).toContain('since v1.0.10')
  expect(upcoming?.text).toContain('1 change')
  expect(await ui.find({ type: 'Markdown', text: /invitee/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /shipped work/ })).toBe(undefined)

  // Tags without a GitHub Release are releases too, newest first.
  expect(await ui.find({ key: 'section:v1.0.10' })).toBeDefined()
  expect(await ui.find({ key: 'section:v1.0.3' })).toBeDefined()
  expect(await ui.find({ key: 'section:v1.0.1' })).toBeDefined()
  // One that has a Release keeps the Release's name, date and notes.
  const beta = await ui.find({ key: 'section:v1.0.0-beta.6' })
  expect(beta?.text).toContain('2026-07-23')
  expect(beta?.text).toContain('pre-release')

  await ui.press({ key: 'section:v1.0.10' })
  expect(await ui.find({ type: 'Markdown', text: /Change password/ })).toBeDefined()
  await ui.press({ key: 'section:v1.0.0-beta.6' })
  expect(await ui.find({ type: 'Markdown', text: /sixth beta/ })).toBeDefined()
  await ui.unmount()
})
