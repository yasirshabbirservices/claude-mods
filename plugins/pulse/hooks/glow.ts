// The pulse bar's words, colours and motion. Pure functions, no `$`.

import type { PulseMode } from '../types'

export const COLORS = {
  read: '#4A9EFF',
  edit: '#D97757',
  bash: '#F5A524',
  search: '#2BB3A3',
  mcp: '#8B5CF6',
  agent: '#EC4899',
  other: '#8A8F98',
  thinking: '#B3A79A',
  idle: '#8A8F98',
  done: '#3FB950',
  error: '#E5484D',
}

export const DONE_MS = 1200
export const ERROR_MS = 900
export const IDLE_STOP_MS = 60_000

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const cut = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
const tail = (path: string, max: number) => {
  const p = path.replace(/\\/g, '/')
  if (p.length <= max) return p
  const parts = p.split('/')
  let out = parts.pop() ?? ''
  while (parts.length > 0 && out.length + (parts[parts.length - 1] ?? '').length + 1 <= max - 2) out = `${parts.pop()}/${out}`
  return `…/${out}`
}
const host = (url: string) => /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url

// A server's display name: claude_ai_Zapier → Zapier, plugin_small-business_gmail → Gmail;
// an id-like name gives way to the tool's own name.
const serverName = (server: string, tool: string) => {
  const s = server.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '')
  if (/^[0-9a-f]{8}-/i.test(s) || s === '') return tool.replace(/_/g, ' ')
  const clean = s.replace(/[_-]+/g, ' ')
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

/** The tool's colour and the plain words for what it does. */
export const describe = (tool: string, input: Record<string, unknown>): { label: string; color: string } => {
  const path = str(input.file_path) || str(input.notebook_path)
  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')
    return { label: `Calling ${serverName(server, name)}`, color: COLORS.mcp }
  }
  switch (tool) {
    case 'Read':
      return { label: `Reading ${tail(path, 40)}`, color: COLORS.read }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { label: `Editing ${tail(path, 40)}`, color: COLORS.edit }
    case 'Write':
      return { label: `Writing ${tail(path, 40)}`, color: COLORS.edit }
    case 'Bash':
    case 'PowerShell':
      return { label: `Running ${cut(str(input.command), 40)}`, color: COLORS.bash }
    case 'Grep':
    case 'Glob':
      return { label: `Searching ${cut(str(input.pattern), 32)}`, color: COLORS.search }
    case 'WebSearch':
      return { label: `Searching the web for ${cut(str(input.query), 28)}`, color: COLORS.search }
    case 'WebFetch':
      return { label: `Fetching ${host(str(input.url))}`, color: COLORS.search }
    case 'Agent':
    case 'Task':
      return { label: `Running agent: ${cut(str(input.description) || str(input.subagent_type), 32)}`, color: COLORS.agent }
    default:
      return { label: `Using ${tool}`, color: COLORS.other }
  }
}

const wave = (x: number) => 0.5 + 0.5 * Math.sin(2 * Math.PI * x)

/** Brightness 0..1 of column `x` (0..1) after `t` ms in `mode`; undefined = static. */
export const intensity = (mode: PulseMode, t: number, x: number): number => {
  switch (mode) {
    case 'idle':
      return t >= IDLE_STOP_MS ? 0.18 : 0.12 + 0.18 * wave(t / 4000)
    case 'thinking':
      return 0.22 + 0.38 * wave(x * 1.2 - t / 1800)
    case 'tool':
      return 0.35 + 0.6 * wave(x * 2 - t / 900)
    case 'done': {
      if (t >= DONE_MS) return 0.25
      const head = (t / DONE_MS) * 1.3 - 0.15
      return Math.max(0.15, 0.95 * Math.exp(-(((x - head) / 0.12) ** 2)))
    }
    case 'error':
      return t >= ERROR_MS ? 0.25 : 0.2 + 0.7 * Math.sin(Math.PI * (t / ERROR_MS))
  }
}

/** Whether the bar is still moving: idle stops after a minute, done and error after one go. */
export const isAnimating = (mode: PulseMode, t: number) =>
  mode === 'idle' ? t < IDLE_STOP_MS : mode === 'done' ? t < DONE_MS : mode === 'error' ? t < ERROR_MS : true

const BASE = 0x1c1c1c
const mix = (color: string, k: number) => {
  const c = parseInt(color.slice(1), 16)
  const ch = (s: number) => Math.round(((BASE >> s) & 255) + ((((c >> s) & 255) - ((BASE >> s) & 255)) * Math.max(0, Math.min(1, k))))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** One row of cells for the terminal: a heavy line, each cell lit by `intensity`. */
export const rowCells = (mode: PulseMode, color: string, t: number, columns: number): [number, number, number][] =>
  Array.from({ length: columns }, (_, i) => [0x2501, mix(color, intensity(mode, t, (i + 0.5) / columns)), 0x01000000] as [number, number, number])

/** The desktop's bar: one SVG that animates itself, so no redraws are needed. */
export const svgBar = (mode: PulseMode, color: string, idleLeftMs: number, width = 640): string => {
  const h = 6
  const base = `<rect width="${width}" height="${h}" rx="3" fill="${color}" opacity="0.14"/>`
  const grad = (dur: string, lo: number, hi: number) =>
    `<defs><linearGradient id="g" x1="0" x2="${width}" gradientUnits="userSpaceOnUse" spreadMethod="reflect">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="${lo}"/><stop offset="0.5" stop-color="${color}" stop-opacity="${hi}"/><stop offset="1" stop-color="${color}" stop-opacity="${lo}"/>` +
    `<animateTransform attributeName="gradientTransform" type="translate" from="${-width} 0" to="${width} 0" dur="${dur}" repeatCount="indefinite"/></linearGradient></defs>` +
    `<rect width="${width}" height="${h}" rx="3" fill="url(#g)"/>`
  let body = ''
  if (mode === 'idle') {
    const left = Math.max(0, idleLeftMs / 1000)
    body =
      left <= 0
        ? `<rect width="${width}" height="${h}" rx="3" fill="${color}" opacity="0.18"/>`
        : `<rect width="${width}" height="${h}" rx="3" fill="${color}" opacity="0.18"><animate attributeName="opacity" values="0.12;0.3;0.12" dur="4s" repeatDur="${left.toFixed(1)}s" fill="freeze"/></rect>`
  } else if (mode === 'thinking') body = grad('3.6s', 0.15, 0.6)
  else if (mode === 'tool') body = grad('1.8s', 0.3, 0.95)
  else if (mode === 'done')
    body = `<rect x="-160" width="160" height="${h}" rx="3" fill="${color}" opacity="0.95"><animate attributeName="x" from="-160" to="${width}" dur="${DONE_MS / 1000}s" fill="freeze"/></rect><rect width="${width}" height="${h}" rx="3" fill="${color}" opacity="0.25"/>`
  else body = `<rect width="${width}" height="${h}" rx="3" fill="${color}" opacity="0.25"><animate attributeName="opacity" values="0.2;0.9;0.25" dur="${ERROR_MS / 1000}s" fill="freeze"/></rect>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${base}${body}</svg>`
}
