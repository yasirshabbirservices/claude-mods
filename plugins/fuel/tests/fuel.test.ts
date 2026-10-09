import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { AMBER, CLAY, RED, barCells, countdown, gauges, rampColor } from '../hooks/gauges'

const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 110, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

const NOW = Date.parse('2026-01-01T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

const engine = (on: On) => {
  const w = { compacts: 0 }
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'below' }) as RenderElement)
  on('command.run', () => ({ text: '' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('session.compact', () => {
    w.compacts += 1
    return { skip: 'test' } as never
  })
  return w
}

const measure = ($: Engine, percent: number | undefined, limits: unknown[] = [], changed = ['context', 'rateLimits']) =>
  $.session.measure({
    context: { window: 200_000, ...(percent === undefined ? {} : { tokens: percent * 2000, percent }) },
    rateLimits: limits,
    changed,
  } as never)

const LIMITS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: iso(NOW + (2 * 60 + 14) * 60_000) },
  { kind: 'seven_day', percentUsed: 73.5, resetsAt: iso(NOW + (3 * 24 + 4) * 3_600_000) },
]

test('the band shows every gauge that has a number, on the terminal and the desktop', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await measure($, 42, LIMITS)

  const term = await $.ui.mount({ plugin: 'fuel', surface: 'terminal', ...band })
  for (const key of ['bar-context', 'bar-limit-five_hour', 'bar-limit-seven_day', 'bar-cache']) expect(await term.find({ key })).toBeDefined()
  expect(await term.find({ type: 'Text', text: '84k / 200k tokens' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: 'resets in 2h 14m' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: 'resets in 3d 4h' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /of 5m warm window \(estimate\)/ })).toBeDefined()
  expect(await term.find({ key: 'below' })).toBeDefined()
  await term.unmount()

  const desk = await $.ui.mount({ plugin: 'fuel', surface: 'desktop', ...band })
  const svg = (await desk.find({ type: 'Svg' } as never)) as { props: { source: string; alt: string } }
  expect(svg.props.source).toContain('linearGradient')
  expect(svg.props.source).toContain('#d97757')
  expect(svg.props.alt).toContain('Context 42% (84k / 200k tokens)')
  expect(await desk.find({ key: 'compact' })).toBeDefined()
  await desk.unmount()
})

test('a gauge without a number is left out, and no numbers means no band', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  const empty = await $.ui.mount({ plugin: 'fuel', surface: 'terminal', ...band })
  expect(await empty.find({ key: 'compact' })).toBeUndefined()
  await empty.unmount()

  await measure($, undefined, [LIMITS[0]], ['rateLimits'])
  const ui = await $.ui.mount({ plugin: 'fuel', surface: 'terminal', ...band })
  expect(await ui.find({ key: 'bar-limit-five_hour' })).toBeDefined()
  expect(await ui.find({ key: 'bar-context' })).toBeUndefined()
  expect(await ui.find({ key: 'bar-cache' })).toBeUndefined()
  await ui.unmount()
})

test('Compact runs only when pressed', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = engine(on)
  await measure($, 80)
  const ui = await $.ui.mount({ plugin: 'fuel', surface: 'terminal', ...band })
  expect(w.compacts).toBe(0)
  await ui.press({ key: 'compact' })
  expect(w.compacts).toBe(1)
  await ui.unmount()
})

test('/fuel is one line, and the cache gauge goes cold after the warm window', { options: { cache_warm_minutes: 5 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  await measure($, 42, LIMITS)
  const line = (await $.command.run({ command: 'fuel', args: '' } as Parameters<Engine['command']['run']>[0])) as { text: string }
  expect(line.text).toBe('Context 42% (84k / 200k tokens) · 5-hour 18% (resets in 2h 14m) · 7-day 74% (resets in 3d 4h) · Cache <1m (of 5m warm window (estimate))')
  expect(line.text.includes('\n')).toBe(false)
  await clock.advance(6 * 60_000)
  const later = (await $.command.run({ command: 'fuel', args: '' } as Parameters<Engine['command']['run']>[0])) as { text: string }
  expect(later.text).toContain('Cache cold (older than the 5m warm window (estimate))')
})

test('gauge colours run clay to amber to red, drawn in eighth blocks', async () => {
  expect(rampColor(0)).toBe(CLAY)
  expect(rampColor(0.5)).toBe(AMBER)
  expect(rampColor(1)).toBe(RED)
  const cells = barCells(0.5, 8)
  expect(cells.slice(0, 4).every(c => c[0] === 0x2588)).toBe(true)
  expect(cells.slice(4).every(c => c[0] === 0x20)).toBe(true)
  expect(barCells(0.0625, 8)[0]?.[0]).toBe(0x258c)
  expect(countdown(30_000)).toBe('under a minute')
  expect(gauges(null, null, NOW, 5)).toEqual([])
})
