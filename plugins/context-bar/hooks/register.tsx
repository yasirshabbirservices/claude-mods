import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextRow, ContextSnapshot } from '../types'

const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null as ContextSnapshot | null)
const isHidden = atom({ plugin: 'context-bar', key: 'isHidden' } as const, false)

const PALETTE = ['#6b8fd6', '#5fb3b3', '#9b7fe6', '#8cc265', '#e3b95c', '#e88fb5', '#e07a52', '#7fb8e6', '#c9a0dc']
const FREE = '#3a4150'
const MARKER = '#e3b95c'

const tokens = (n: number) => {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const pct = (n: number, of: number) => `${of > 0 ? Math.round((n / of) * 100) : 0}%`

// Measures the context window by category, as /context does (estimated
// locally, no API calls), and keeps it for the band to draw.
async function refresh($: EngineInterface) {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  if (b === undefined) return

  const rows: ContextRow[] = b.categories
    .filter(c => !c.isDeferred && c.kind !== 'buffer')
    .map(c => ({ name: c.name.toLowerCase(), tokens: c.tokens, kind: c.kind }))
  const value: ContextSnapshot = {
    used: b.totalTokens,
    window: b.rawMaxTokens,
    compactsAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
    percent: b.percentage,
    rows,
  }
  await update($, snapshot, () => value)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await $.command.register({ name: 'context-bar', description: 'Show or hide the context usage bar' })
    await refresh($)

    return ran
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'refresh') {
      await refresh($)
      return { text: 'Context bar refreshed.' }
    }
    const hidden = await update($, isHidden, v => !v)
    if (!hidden) await refresh($)

    return { text: hidden ? 'Context bar hidden.' : 'Context bar shown.' }
  })

  // The context changes as a turn ends and when the conversation is compacted.
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) await refresh($)

    return ran
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    await refresh($)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns - 4)
    const used = snap.rows.filter(r => r.kind === 'used')
    const free = snap.rows.find(r => r.kind === 'free')
    const colorOf = (r: ContextRow) => (r.kind === 'free' ? FREE : PALETTE[used.indexOf(r) % PALETTE.length]!)

    // The bar: one run of cells per category, scaled to the window, with a
    // mark where auto-compaction runs.
    const cells: string[] = []
    for (const r of used) {
      const n = r.tokens > 0 ? Math.max(1, Math.round((r.tokens / snap.window) * width)) : 0
      for (let i = 0; i < n && cells.length < width; i++) cells.push(colorOf(r))
    }
    while (cells.length < width) cells.push(FREE)
    const mark = snap.compactsAt !== undefined ? Math.min(width - 1, Math.round((snap.compactsAt / snap.window) * width)) : -1
    const runs: Array<{ color: string; text: string }> = []
    cells.forEach((color, i) => {
      const isMark = i === mark
      const c = isMark ? MARKER : color
      const ch = isMark ? '▎' : color === FREE ? '░' : '█'
      const last = runs[runs.length - 1]
      if (last && last.color === c && !isMark && !last.text.includes('▎')) last.text += ch
      else runs.push({ color: c, text: ch })
    })

    // The legend, wrapped to the band's width.
    const items = [...used, ...(free ? [free] : [])].map(r => ({
      r,
      text: r.kind === 'free' ? `${r.name} ${tokens(r.tokens)}` : `${r.name} ${tokens(r.tokens)} ${pct(r.tokens, snap.window)}`,
    }))
    const lines: Array<typeof items> = [[]]
    let lineWidth = 0
    for (const item of items) {
      const w = item.text.length + 4
      if (lineWidth + w > width && lines[lines.length - 1]!.length > 0) {
        lines.push([])
        lineWidth = 0
      }
      lines[lines.length - 1]!.push(item)
      lineWidth += w
    }

    const level = snap.percent >= 80 ? 'red' : snap.percent >= 50 ? 'yellow' : 'green'
    const compacts = snap.compactsAt !== undefined ? ` · compacts at ${tokens(snap.compactsAt)}` : ''

    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color={MARKER}>◆ </Text>
            <Text bold>context</Text>
          </Text>
          <Text>
            <Text bold>{tokens(snap.used)}</Text>
            <Text dimColor>{` of ${tokens(snap.window)}${compacts}  `}</Text>
            <Text bold color={level}>{`${snap.percent}%`}</Text>
          </Text>
        </Box>
        <Text>
          {runs.map(run => (
            <Text color={run.color}>{run.text}</Text>
          ))}
        </Text>
        {lines.map(line => (
          <Text>
            {line.map(({ r, text }) => (
              <Text>
                <Text color={colorOf(r)}>■ </Text>
                <Text dimColor={r.kind === 'free'}>{text}</Text>
                <Text>{'   '}</Text>
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    )
  })
}
