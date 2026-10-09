export type FuelLimit = { kind: string; percentUsed: number; resetsAt?: string }
export type FuelUsage = { tokens?: number; window?: number; percent?: number; limits: FuelLimit[] }

declare module 'claude-code' {
  interface PluginState {
    fuel: { usage: FuelUsage | null; lastResponseAt: number | null; now: number }
  }
}
