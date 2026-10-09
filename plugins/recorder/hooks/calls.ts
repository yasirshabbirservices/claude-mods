// What the recorder keeps of a tool call, and how a row reads. Pure, no `$`.
// Only the call's own input is read, and only its target: a path, a pattern, a
// URL's host, a command's first words. Never file contents, never output.

export type Category = 'read' | 'edit' | 'bash' | 'search' | 'mcp' | 'agent' | 'other'

export const COLORS: Record<Category, string> = {
  read: '#4A9EFF',
  edit: '#D97757',
  bash: '#F5A524',
  search: '#2BB3A3',
  mcp: '#8B5CF6',
  agent: '#EC4899',
  other: '#8A8F98',
}

export const categoryOf = (tool: string): Category => {
  if (tool.startsWith('mcp__')) return 'mcp'
  if (tool === 'Read' || tool === 'NotebookRead') return 'read'
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'edit'
  if (tool === 'Bash' || tool === 'PowerShell') return 'bash'
  if (tool === 'Grep' || tool === 'Glob' || tool === 'WebSearch' || tool === 'WebFetch' || tool === 'ToolSearch' || tool === 'LS') return 'search'
  if (tool === 'Agent' || tool === 'Task') return 'agent'
  return 'other'
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
const host = (url: string) => {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
  return m?.[1] ?? url
}

/** The call's target, and its file path when it has one. */
export const targetOf = (tool: string, input: Record<string, unknown>): { target: string; path?: string } => {
  const path = str(input.file_path) || str(input.notebook_path)
  if (path !== '') return { target: path, path }
  if (tool === 'Bash' || tool === 'PowerShell') return { target: oneLine(str(input.command), 80) }
  if (tool === 'Grep' || tool === 'Glob') {
    const where = str(input.path)
    return { target: oneLine(`${str(input.pattern)}${where === '' ? '' : ` in ${where}`}`, 80) }
  }
  if (tool === 'WebFetch') return { target: host(str(input.url)) }
  if (tool === 'WebSearch' || tool === 'ToolSearch') return { target: oneLine(str(input.query), 60) }
  if (tool === 'Agent' || tool === 'Task') return { target: oneLine(str(input.description) || str(input.subagent_type), 60) }
  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')
    return { target: `${server.replace(/^claude_ai_/, '').replace(/^plugin_/, '')} · ${name}` }
  }
  const url = str(input.url)
  return { target: url === '' ? '' : host(url) }
}

/** Shortens in the middle: "src/components/…/app.ts". */
export const middle = (text: string, max: number): string => {
  if (text.length <= max) return text
  if (max <= 3) return text.slice(0, max)
  const keep = max - 1
  const tail = Math.ceil(keep * 0.6)
  return `${text.slice(0, keep - tail)}…${text.slice(text.length - tail)}`
}

export const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)

/** Cells of a duration bar, scaled to the slowest call (at least one when it took any time). */
export const barLength = (ms: number, slowest: number, width: number) => (slowest <= 0 ? 0 : Math.max(ms > 0 ? 1 : 0, Math.round((ms / slowest) * width)))

const short = (tool: string) => (tool.startsWith('mcp__') ? 'MCP' : tool)

/** The toast when a turn ends: one line. */
export const toastLine = (calls: { tool: string; durationMs?: number; isError: boolean }[], turnMs: number): string => {
  if (calls.length === 0) return `Turn done in ${seconds(turnMs)}, no tool calls`
  const errors = calls.filter(c => c.isError).length
  const slow = calls.reduce((a, b) => ((b.durationMs ?? 0) > (a.durationMs ?? 0) ? b : a))
  return [
    `Turn done: ${calls.length} tool call${calls.length === 1 ? '' : 's'} in ${seconds(turnMs)}`,
    errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : '',
    `slowest ${short(slow.tool)} ${seconds(slow.durationMs ?? 0)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}
