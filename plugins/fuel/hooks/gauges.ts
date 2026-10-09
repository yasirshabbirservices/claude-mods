// The runway figures as gauges: which to show, their words, and how each is
// drawn (true-colour cells for the terminal, an SVG card for the desktop).
// Pure functions, no `$`.

import type { FuelUsage } from '../types'

export type Gauge = { key: string; label: string; fraction: number; percent: string; detail: string }

export const CLAY = 0xd97757
export const AMBER = 0xf5a524
export const RED = 0xe5484d
const TRACK = 0x3a3a3a

const mix = (a: number, b: number, t: number) => {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** Clay at empty, amber at the middle, red at full. */
export const rampColor = (t: number) => (t <= 0.5 ? mix(CLAY, AMBER, Math.max(0, t) / 0.5) : mix(AMBER, RED, (Math.min(1, t) - 0.5) / 0.5))

export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

/** "2h 14m", "3d 4h", "12m", "under a minute". */
export const countdown = (ms: number) => {
  if (ms < 60_000) return 'under a minute'
  const m = Math.floor(ms / 60_000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${mm}m`
  return `${mm}m`
}

const LIMIT_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', spend_limit: 'Spend' }
const limitName = (kind: string) => LIMIT_NAMES[kind] ?? kind.replace(/_/g, ' ')

/** Every gauge that has a number; the ones without are left out. */
export const gauges = (usage: FuelUsage | null, lastResponseAt: number | null, now: number, warmMinutes: number): Gauge[] => {
  const out: Gauge[] = []
  if (usage !== null && usage.percent !== undefined) {
    const detail = usage.tokens !== undefined && usage.window !== undefined ? `${compact(usage.tokens)} / ${compact(usage.window)} tokens` : ''
    out.push({ key: 'context', label: 'Context', fraction: usage.percent / 100, percent: `${Math.round(usage.percent)}%`, detail })
  }
  for (const limit of usage?.limits ?? []) {
    const resets = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
    const detail = Number.isNaN(resets) ? '' : `resets in ${countdown(Math.max(0, resets - now))}`
    out.push({ key: `limit-${limit.kind}`, label: limitName(limit.kind), fraction: limit.percentUsed / 100, percent: `${Math.round(limit.percentUsed)}%`, detail })
  }
  if (lastResponseAt !== null && warmMinutes > 0) {
    const age = Math.max(0, now - lastResponseAt)
    const windowMs = warmMinutes * 60_000
    const isCold = age >= windowMs
    out.push({
      key: 'cache',
      label: 'Cache',
      fraction: Math.min(1, age / windowMs),
      percent: isCold ? 'cold' : countdown(age).replace('under a minute', '<1m'),
      detail: isCold ? `older than the ${warmMinutes}m warm window (estimate)` : `of ${warmMinutes}m warm window (estimate)`,
    })
  }
  return out
}

/** One line for /fuel. */
export const summary = (list: Gauge[]) =>
  list.length === 0
    ? 'No fuel readings yet: they arrive with the first response.'
    : list.map(g => `${g.label} ${g.percent}${g.detail === '' ? '' : ` (${g.detail})`}`).join(' · ')

// ---- terminal: a row of true-colour cells, eighth blocks at the edge ---------------------

const EIGHTHS = [0x20, 0x258f, 0x258e, 0x258d, 0x258c, 0x258b, 0x258a, 0x2589, 0x2588]
const DEFAULT = 0x01000000

export const barCells = (fraction: number, columns: number): [number, number, number][] => {
  const f = Math.max(0, Math.min(1, fraction))
  const eighths = Math.round(f * columns * 8)
  const cells: [number, number, number][] = []
  for (let c = 0; c < columns; c += 1) {
    const color = rampColor((c + 0.5) / columns)
    const filled = Math.max(0, Math.min(8, eighths - c * 8))
    if (filled === 8) cells.push([0x2588, color, DEFAULT])
    else if (filled > 0) cells.push([EIGHTHS[filled] as number, color, TRACK])
    else cells.push([0x20, DEFAULT, TRACK])
  }
  return cells
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const base64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

export const pack = (cells: [number, number, number][]) => {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach((cell, i) => words.set(cell, i * 3))
  return base64(new Uint8Array(words.buffer))
}

// ---- desktop: one SVG card --------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

export const svgCard = (list: Gauge[], width = 560): string => {
  const rowH = 26
  const barX = 92
  const barW = width - barX - 210
  const height = list.length * rowH + 12
  const font = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="12"'
  const rows = list
    .map((g, i) => {
      const y = 8 + i * rowH
      const w = Math.max(0, Math.min(1, g.fraction)) * barW
      return (
        `<text x="10" y="${y + 13}" ${font} fill="#8A8F98">${esc(g.label)}</text>` +
        `<rect x="${barX}" y="${y + 4}" width="${barW}" height="10" rx="5" fill="#8A8F9833"/>` +
        `<clipPath id="c${i}"><rect x="${barX}" y="${y + 4}" width="${w.toFixed(1)}" height="10" rx="5"/></clipPath>` +
        `<rect x="${barX}" y="${y + 4}" width="${barW}" height="10" rx="5" fill="url(#ramp)" clip-path="url(#c${i})"/>` +
        `<text x="${barX + barW + 10}" y="${y + 13}" ${font} font-weight="600" fill="${hex(rampColor(g.fraction))}">${esc(g.percent)}</text>` +
        `<text x="${barX + barW + 58}" y="${y + 13}" ${font} fill="#8A8F98">${esc(g.detail)}</text>`
      )
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="ramp" x1="${barX}" x2="${barX + barW}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${hex(CLAY)}"/><stop offset="0.5" stop-color="${hex(AMBER)}"/><stop offset="1" stop-color="${hex(RED)}"/></linearGradient></defs>` +
    rows +
    `</svg>`
  )
}
