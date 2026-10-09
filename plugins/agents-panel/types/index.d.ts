export type AgentDef = {
  name: string
  description: string
  model: string
  color?: string
}

export type AgentRun = {
  agentId: string
  startedAt: number
  status: 'running' | 'done' | 'failed'
  endedAt?: number
  /** The agent's final answer, once it finished. */
  answer?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agents-panel': {
      agents: AgentDef[]
      runs: Record<string, AgentRun>
      /** What the next run is asked to do, typed into the pane. */
      task: string
    }
  }
}
