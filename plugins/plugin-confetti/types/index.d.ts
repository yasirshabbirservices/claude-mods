export type Celebration = { brand: string; seq: number }

declare module 'claude-code' {
  interface PluginState {
    'plugin-confetti': { now: Celebration | null; frame: number }
  }
}
