export type ContextRow = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

export type ContextSnapshot = {
  /** Tokens in use, by /context's estimate. */
  used: number
  /** The window measured against. */
  window: number
  /** Where auto-compaction runs; absent when it is off. */
  compactsAt?: number
  percent: number
  rows: ContextRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { snapshot: ContextSnapshot | null; isHidden: boolean }
  }
}
