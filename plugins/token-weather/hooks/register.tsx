import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading } from '../types'

const HISTORY = 12
const BARS = '▁▂▃▄▅▆▇█'

const readings = atom({ plugin: 'token-weather', key: 'readings' } as const, [] as Reading[])

export function forecast(percent: number): string {
  if (percent >= 90) return '↯ Compact soon'
  if (percent >= 75) return '☇ Storm'
  if (percent >= 50) return '☂ Showers'
  if (percent >= 25) return '☁ Cloudy'
  return '☀ Clear'
}

function color(percent: number): string {
  if (percent >= 90) return 'red'
  if (percent >= 75) return 'magenta'
  if (percent >= 50) return 'blue'
  if (percent >= 25) return 'gray'
  return 'yellow'
}

function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function spark(history: Reading[]): string {
  return history
    .map(r => BARS[Math.min(BARS.length - 1, Math.floor((r.percent / 100) * BARS.length))])
    .join('')
}

async function takeReading($: EngineInterface) {
  const { context } = await $.session.usage()
  if (!context?.window) return
  const window = context.window
  const tokens = context.tokens ?? 0
  const percent = context.percent ?? Math.round((tokens / window) * 100)
  await update($, readings, h => [...h, { tokens, window, percent }].slice(-HISTORY))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await takeReading($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await takeReading($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const history = await read($, readings)
    if (e.props.hasSurvey || history.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = history[history.length - 1]
    const isNarrow = e.props.bodyColumns < 60

    return (
      <Box paddingX={1}>
        <Text color={color(now.percent)} bold>{forecast(now.percent)}</Text>
        <Text>  {now.percent}% · {short(now.tokens)}/{short(now.window)}</Text>
        {isNarrow ? null : <Text dimColor>  {spark(history)}</Text>}
      </Box>
    )
  })
}
