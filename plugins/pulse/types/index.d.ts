export type PulseMode = 'idle' | 'thinking' | 'tool' | 'done' | 'error'
export type PulseState = { mode: PulseMode; label: string; color: string; since: number }

declare module 'claude-code' {
  interface PluginState {
    pulse: { state: PulseState; now: number; isOff: boolean }
  }
}
