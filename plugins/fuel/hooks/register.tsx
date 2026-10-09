import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { FuelUsage } from '../types'
import { barCells, gauges, isNearLimit, pack, summary, svgCard } from './gauges'

// A band above the prompt, shown only once the context window (70%) or a plan
// limit (80%) is near its end, both set in /config: the context window, each plan limit with its
// reset countdown, and the cache's age against its warm window (an estimate),
// as gradient gauges that turn from clay to amber to red as they fill. A gauge
// with no number is left out. Compact runs only when pressed. /fuel prints
// the same in one line.

const usageAtom = atom({ plugin: 'fuel', key: 'usage' } as const, null as FuelUsage | null)
const lastResponse = atom({ plugin: 'fuel', key: 'lastResponseAt' } as const, null as number | null)
const nowAtom = atom({ plugin: 'fuel', key: 'now' } as const, 0)

const TICK_MS = 15_000
const BAR_COLUMNS = 24

const toUsage = (context: SessionContextUsage, limits: SessionRateLimit[]): FuelUsage => ({
  ...(context.tokens === undefined ? {} : { tokens: context.tokens }),
  window: context.window,
  ...(context.percent === undefined ? {} : { percent: context.percent }),
  limits: limits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt === undefined ? {} : { resetsAt: l.resetsAt }) })),
})

async function refresh($: EngineInterface) {
  const u = await $.session.usage()
  await update($, usageAtom, () => toUsage(u.context, u.rateLimits))
}

async function tick($: EngineInterface) {
  const t = await $.clock.now()
  await update($, nowAtom, () => t)
}

async function responded($: EngineInterface) {
  const t = await $.clock.now()
  await update($, lastResponse, () => t)
  await update($, nowAtom, () => t)
}

export const register: Register = (on, options) => {
  const o = options as Record<string, unknown>
  const warm = Number(o.cache_warm_minutes ?? 5)
  const contextAt = Number(o.context_threshold ?? 70)
  const limitAt = Number(o.limit_threshold ?? 80)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'fuel', description: 'One-line runway: context, plan limits, cache age', immediate: true })
    const t0 = await $.clock.now()
    await update($, nowAtom, () => t0)
    $.clock.every(TICK_MS, () => {
      void tick($)
    })
    try {
      await refresh($)
    } catch {
      // No reading yet; the band waits for the first response.
    }
    return started
  })

  on('session.measure', async ($, e, next) => {
    await update($, usageAtom, () => toUsage(e.context, e.rateLimits))
    if (e.changed.includes('context')) {
      await responded($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.usage !== undefined) {
      await responded($)
    }
    return result
  })

  on('command.run', { command: 'fuel' }, async $ => {
    const list = gauges(await read($, usageAtom), await read($, lastResponse), await $.clock.now(), warm)
    return { text: summary(list) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const usage = await read($, usageAtom)
    // Quiet until something is near its limit; /fuel answers any time.
    if (!isNearLimit(usage, contextAt, limitAt)) return next(e)
    const list = gauges(usage, await read($, lastResponse), Math.max(await read($, nowAtom), 1), warm)
    if (list.length === 0) return next(e)

    const below = await next(e)
    const compactNow = async () => {
      await $.session.compact()
      await refresh($)
    }

    if (e.surface === 'desktop') {
      const { Box, Button, Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={svgCard(list)} alt={summary(list)} />
            {e.props.isWorking ? null : <Button key="compact" label="Compact" onPress={compactNow} />}
          </Box>
          {below}
        </Box>
      )
    }
    if (e.surface !== 'terminal') return next(e)

    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {list.map(g => (
          <Box key={`row-${g.key}`} flexDirection="row" gap={1}>
            <Text dimColor>{g.label.padEnd(8)}</Text>
            <Raster key={`bar-${g.key}`} columns={BAR_COLUMNS} rows={1} cells={pack(barCells(g.fraction, BAR_COLUMNS))} />
            <Text bold>{g.percent.padStart(5)}</Text>
            <Text dimColor>{g.detail}</Text>
          </Box>
        ))}
        {e.props.isWorking ? null : <Button key="compact" label="Compact" onPress={compactNow} />}
        {below}
      </Box>
    )
  })
}
