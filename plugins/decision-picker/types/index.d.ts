export type Decision = { id: string; label: string; isOn: boolean }

declare module 'claude-code' {
  interface PluginState {
    'decision-picker': { decisions: Decision[] }
  }
}
