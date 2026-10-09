import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { COLORS, describe, intensity, isAnimating, rowCells, svgBar } from '../hooks/glow'

const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}

type World = { seen: string[]; inputs: Record<string, unknown>[] }

// The engine beneath: while a tool runs, the stand-in reads the band so the
// test sees what it said mid-call.
const engine = (on: On, probe: { $?: Engine }): World => {
  const w: World = { seen: [], inputs: [] }
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'below' }) as RenderElement)
  on('command.run', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ ...e }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', async (_$, e) => {
    const input = e as unknown as Record<string, unknown>
    w.inputs.push(input)
    if (probe.$ !== undefined) w.seen.push(await label(probe.$, 'terminal'))
    return { result: 'ok', isError: String(input.command ?? '').includes('fail') } as never
  })
  return w
}

async function label($: Engine, surface: 'terminal' | 'desktop'): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'pulse', surface, ...band })
  const text = (await ui.find({ type: 'Text', text: /\S/ })) as { text?: string } | undefined
  await ui.unmount()
  return (text?.text ?? '').trim()
}

const call = ($: Engine, tool: string, input: Record<string, unknown>) => $.tool.call({ tool, tool_use_id: `u-${tool}-${Math.random()}`, ...input } as never)
const done = ($: Engine, reason = 'answer') => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', reason } as never)

test('says what Claude is doing in plain words, through a whole turn', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const probe: { $?: Engine } = {}
  const w = engine(on, probe)
  expect(await label($, 'terminal')).toBe('Ready')
  await $.prompt.submit({ text: 'fix it', wait: false } as never)
  expect(await label($, 'desktop')).toBe('Thinking')

  probe.$ = $
  await call($, 'Read', { file_path: 'C:/work/app/src/app.ts' })
  await call($, 'mcp__claude_ai_Zapier__run_action', {})
  await call($, 'Bash', { command: 'npm test' })
  expect(w.seen).toEqual(['Reading C:/work/app/src/app.ts', 'Calling Zapier', 'Running npm test'])
  expect(await label($, 'terminal')).toBe('Thinking')

  await done($)
  expect(await label($, 'terminal')).toBe('Done')
  await clock.advance(1300)
  expect(await label($, 'terminal')).toBe('Ready')
})

test('an error pulses once, then the bar goes back to what is running', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, {})
  await $.prompt.submit({ text: 'go', wait: false } as never)
  await call($, 'Bash', { command: 'make fail' })
  expect(await label($, 'terminal')).toBe('Error in Bash')
  await clock.advance(1000)
  expect(await label($, 'terminal')).toBe('Thinking')
  await done($, 'error')
  expect(await label($, 'desktop')).toBe('Turn ended with an error')
})

test('observe only: the call and its result pass through unchanged', async ($, on) => {
  mock.clock(on, { now: 0 })
  const w = engine(on, {})
  const r = (await call($, 'Edit', { file_path: '/a/b.ts', old_string: 'x', new_string: 'y' })) as { result: string }
  expect(r.result).toBe('ok')
  expect(w.inputs[0]?.old_string).toBe('x')
  expect(w.inputs[0]?.new_string).toBe('y')
})

test('draws a cell bar in the terminal and a self-animating SVG on the desktop', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, {})
  const term = await $.ui.mount({ plugin: 'pulse', surface: 'terminal', ...band })
  const raster = (await term.find({ key: 'pulse' })) as { props: { columns: number; rows: number } }
  expect(raster.props.columns).toBe(65)
  expect(raster.props.rows).toBe(1)
  expect(await term.find({ key: 'below' })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'pulse', surface: 'desktop', ...band })
  const svg = (await desk.find({ type: 'Svg' } as never)) as { props: { source: string; isInteractive: boolean } }
  expect(svg.props.source).toContain('<animate attributeName="opacity" values="0.12;0.3;0.12" dur="4s" repeatDur="60.0s"')
  expect(svg.props.isInteractive).toBe(true)
  await desk.unmount()
})

test('/pulse off hides the bar and /pulse shows it again', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, {})
  const run = (args: string) => $.command.run({ command: 'pulse', args } as Parameters<Engine['command']['run']>[0]) as Promise<{ text: string }>
  expect((await run('off')).text).toBe('Pulse hidden. /pulse shows it again.')
  expect(await label($, 'terminal')).toBe('')
  expect((await run('')).text).toBe('Pulse shown.')
  expect(await label($, 'terminal')).toBe('Ready')
})

test('motion: idle stops after a minute, one-shots stop, colours per tool', async () => {
  expect(isAnimating('idle', 59_000)).toBe(true)
  expect(isAnimating('idle', 61_000)).toBe(false)
  expect(isAnimating('done', 1300)).toBe(false)
  expect(isAnimating('tool', 1e9)).toBe(true)
  expect(intensity('idle', 120_000, 0.5)).toBe(intensity('idle', 999_999, 0.1))
  expect(svgBar('idle', COLORS.idle, 0)).not.toContain('<animate')
  expect(svgBar('tool', COLORS.bash, 0)).toContain('animateTransform')
  expect(describe('Read', { file_path: 'src/app.ts' })).toEqual({ label: 'Reading src/app.ts', color: COLORS.read })
  expect(describe('Edit', { file_path: 'a.ts' }).color).toBe('#D97757')
  expect(describe('Bash', { command: 'ls' }).color).toBe('#F5A524')
  expect(describe('Grep', { pattern: 'x' }).color).toBe('#2BB3A3')
  expect(describe('mcp__plugin_small-business_gmail__send', {}).label).toBe('Calling Gmail')
  expect(describe('mcp__0a1b2c3d-e4f5-6789__send_message', {}).label).toBe('Calling send message')
  expect(rowCells('thinking', COLORS.thinking, 0, 10).length).toBe(10)
})
