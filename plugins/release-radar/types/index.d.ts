export type ChangeKind = 'new' | 'improved' | 'fixed' | 'maintenance'

export type Change = {
  title: string
  kind: ChangeKind
  number?: number
  author?: string
}

export type Section = {
  /** `upcoming`, or the release's tag name. */
  id: string
  name: string
  isUpcoming: boolean
  date?: string
  url?: string
  isPrerelease?: boolean
  /** The release's own notes, as written on GitHub. */
  body?: string
  /** The changes found in commits between this section's base and head. */
  changes: Change[]
  /** The ref range the changes came from, for the compare link and cache key. */
  base?: string
  head?: string
  /** True while `changes` has not been fetched yet (released sections load on open). */
  isPartial?: boolean
}

export type RepoView = {
  repo: string
  defaultBranch?: string
  sections: Section[]
  fetchedAt?: number
  isLoading: boolean
  error?: string
}

export type Summary = {
  text?: string
  isWorking: boolean
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'release-radar': {
      repos: string[]
      selected: string | null
      view: RepoView | null
      openSection: string | null
      showRaw: boolean
      summaries: Record<string, Summary>
      notice: string | null
    }
  }
}
