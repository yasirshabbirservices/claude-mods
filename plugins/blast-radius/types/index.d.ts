export type Report = {
  /** The risky part of the command, e.g. `git reset --hard HEAD~2`. */
  segment: string
  /** What is listed: files, commits. */
  unit: string
  count: number
  items: string[]
  note?: string
}

export type Held = {
  command: string
  reports: Report[]
  decision: 'proceed' | 'cancel' | null
}

declare module 'claude-code' {
  interface PluginState {
    'blast-radius': { held: Held | null }
  }
}
