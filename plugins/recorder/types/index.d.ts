export type RecordedCall = { id: string; tool: string; target: string; path?: string; startedAt: number; durationMs?: number; isError: boolean }
export type RecordedTurn = { id: string; startedAt: number; endedAt?: number; calls: RecordedCall[] }

declare module 'claude-code' {
  interface PluginState {
    recorder: { turns: RecordedTurn[]; view: number }
  }
}
