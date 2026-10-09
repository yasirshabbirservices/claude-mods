// Finds the decisions a reply asks you to approve (D1, D2, ...) and writes the
// approval reply. Pure functions, no `$`.

import type { Decision } from '../types'

// A line that opens with a decision id: "- **D1** — Hero spacing", "D2: ...",
// "| D3 | ...", "### D4. ...".
const LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|\|\s*)?(?:\*\*|__)?\s*(D(\d{1,2}))\b(?:\*\*|__)?\s*[:.\-–—|)]?\s*(.*)$/

// The reply has to be asking: approval words near its end.
const ASKS = /approv|decid|decision|recommend|pick|choose|which (?:ones?|of these)|go ahead\?|your call|sign[- ]off/i

const clean = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const short = (text: string, max = 36) => {
  const first = clean(text).split(/(?<=[.;:!?])\s|\s[—–-]\s/)[0] ?? ''
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`
}

export const findDecisions = (answer: string): Decision[] => {
  if (!ASKS.test(answer.slice(-800))) return []
  const found = new Map<number, Decision>()
  for (const line of answer.split('\n')) {
    const m = LINE.exec(line)
    if (m === null) continue
    const n = Number(m[2])
    if (n < 1 || found.has(n)) continue
    found.set(n, { id: `D${n}`, label: short(m[3] ?? ''), isOn: true })
  }
  const list = [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d)
  return list.length >= 2 ? list : []
}

const join = (ids: string[]) =>
  ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`

// "D1, D2, D3" -> "D1 to D3" when the ids run without a gap.
const span = (ids: string[]) => {
  const nums = ids.map(id => Number(id.slice(1)))
  const isRun = nums.length > 2 && nums.every((n, i) => i === 0 || n === (nums[i - 1] as number) + 1)
  return isRun ? `${ids[0]} to ${ids[ids.length - 1]}` : join(ids)
}

/** The approval reply for the toggles as they stand. */
export const draftReply = (decisions: Decision[]): string => {
  const on = decisions.filter(d => d.isOn).map(d => d.id)
  const off = decisions.filter(d => !d.isOn).map(d => d.id)
  if (on.length === 0) return `skip all of ${span(off)} for now`
  if (off.length === 0) return `approved all, implement ${span(on)}`
  return `approved, implement ${span(on)}; skip ${span(off)}`
}
