import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COLORS, barLength, categoryOf, middle, targetOf, toastLine } from '../hooks/calls'

const pane = { component: 'Pane' as const, requestId: 'recorder', props: { title: 'Recorder', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } }

type World = { inputs: Record<string, unknown>[]; toasts: string[]; opened: string[]; box: string; submitted: number }

// The engine beneath: each tool takes `ms` on the mocked clock, Bash fails when
// its command says so, and every result carries output the recorder must not keep.
const engine = (on: On, clock: { advance: (ms: number) => Promise<void> }): World => {
  const w: World = { inputs: [], toasts: [], opened: [], box: '', submitted: 0 }
  on('command.run', () => ({ text: '' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', async (_$, e) => {
    const input = e as unknown as Record<string, unknown>
    w.inputs.push(input)
    await clock.advance(Number(input.ms ?? 100))
    const isError = String(input.command ?? '').includes('fail')
    return { result: { stdout: 'OUTPUT-XYZ', stderr: '' }, isError } as never
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.open', (_$, e) => {
    w.opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('prompt.read', () => ({ value: { text: w.box, cursor: w.box.length } }))
  on('prompt.fill', (_$, e) => {
    w.box = e.mode === 'append' ? w.box + e.text : e.text
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    w.submitted += 1
    return { text: e.text } as never
  })
  return w
}

const call = ($: Engine, tool: string, input: Record<string, unknown>) => $.tool.call({ tool, tool_use_id: `u${Math.random().toString(36).slice(2, 8)}`, ...input } as never)

const oneTurn = async ($: Engine, id: string) => {
  await $.turn.start({ text: 'go', turnId: id } as never)
  await call($, 'Read', { file_path: 'C:/work/app/src/components/very/deep/folder/app.ts', ms: 200 })
  await call($, 'Write', { file_path: 'C:/work/app/notes.md', content: 'SECRET-CONTENT', ms: 300 })
  await call($, 'Bash', { command: 'npm test -- --fail-fast', ms: 4000 })
  await call($, 'Grep', { pattern: 'useState', path: 'src', ms: 150 })
  await call($, 'mcp__claude_ai_Zapier__run_action', { ms: 1200 })
  await call($, 'Agent', { description: 'Find the flaky test', prompt: 'long prompt text', ms: 2000 })
  await $.turn.complete({ answer: 'done', durationMs: 8000, isAborted: false, turnId: id, reason: 'answer' } as never)
}

test('records each call of a turn and draws the timeline on terminal and desktop', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const w = engine(on, clock)
  await oneTurn($, 't1')
  expect(w.toasts).toEqual(['Turn done: 6 tool calls in 7.8s · 1 error · slowest Bash 4.0s'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'recorder', surface, ...pane } as never)
    const has = async (text: string | RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
    expect([
      await has(/Turn 1 of 1 · 6 calls · 7.8s/),
      await has(/^C:\/work\/app.*….*folder\/app\.ts/),
      await has(/useState in src/),
      await has(/Zapier · run_action/),
      await has(/4\.0s ✕/),
      await has('█'.repeat(20)),
    ]).toEqual([true, true, true, true, true, true])
    await ui.unmount()
  }
})

test('observe only: inputs and results pass untouched, and no contents or output are kept', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = engine(on, clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  const r = (await call($, 'Write', { file_path: '/repo/a.txt', content: 'SECRET-CONTENT', ms: 10 })) as { result: { stdout: string } }
  expect(r.result.stdout).toBe('OUTPUT-XYZ')
  expect(w.inputs[0]?.content).toBe('SECRET-CONTENT')
  await call($, 'Bash', { command: 'cat secrets.env', ms: 10 })
  const ui = await $.ui.mount({ plugin: 'recorder', surface: 'terminal', ...pane } as never)
  expect(await ui.find({ type: 'Text', text: /SECRET-CONTENT|OUTPUT-XYZ/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /cat secrets.env/ })).toBeDefined()
  await ui.unmount()
  const kept = JSON.stringify(targetOf('Write', { file_path: '/repo/a.txt', content: 'SECRET-CONTENT', new_string: 'x', old_string: 'y' }))
  expect(kept).toBe('{"target":"/repo/a.txt","path":"/repo/a.txt"}')
})

test('keeps the last 10 turns, with Prev and Next', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, clock)
  for (let i = 1; i <= 12; i += 1) {
    await $.turn.start({ text: 'go', turnId: `t${i}` } as never)
    await call($, 'Bash', { command: `echo turn ${i}`, ms: 10 })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${i}`, reason: 'answer' } as never)
  }
  const ui = await $.ui.mount({ plugin: 'recorder', surface: 'terminal', ...pane } as never)
  expect(await ui.find({ type: 'Text', text: /Turn 10 of 10/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /echo turn 12/ })).toBeDefined()
  await ui.press({ key: 'prev' })
  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: /Turn 8 of 10/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /echo turn 10/ })).toBeDefined()
  for (let i = 0; i < 20; i += 1) await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: /echo turn 3/ })).toBeDefined()
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /Turn 2 of 10/ })).toBeDefined()
  await ui.unmount()
})

test('Copy path drafts the path in the prompt box and never sends; /recorder opens the pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = engine(on, clock)
  await oneTurn($, 't1')
  const ui = await $.ui.mount({ plugin: 'recorder', surface: 'desktop', ...pane } as never)
  const copy = (await ui.find({ type: 'Button', text: 'Copy path' })) as { key: string }
  await ui.press({ key: copy.key })
  expect(w.box).toBe('C:/work/app/src/components/very/deep/folder/app.ts')
  expect(w.submitted).toBe(0)
  await ui.unmount()

  const r = (await $.command.run({ command: 'recorder', args: '' } as Parameters<Engine['command']['run']>[0])) as { text: string }
  expect(r.text).toBe('Recorder opened.')
  expect(w.opened).toEqual(['recorder'])
})

test('colours, shortening and bar scale', async () => {
  expect(COLORS[categoryOf('Read')]).toBe('#4A9EFF')
  expect(COLORS[categoryOf('Edit')]).toBe(COLORS[categoryOf('Write')])
  expect(COLORS[categoryOf('Bash')]).toBe('#F5A524')
  expect(COLORS[categoryOf('Grep')]).toBe('#2BB3A3')
  expect(COLORS[categoryOf('mcp__x__y')]).toBe('#8B5CF6')
  expect(COLORS[categoryOf('Agent')]).toBe('#EC4899')
  expect(middle('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abc…uvwxyz')
  expect(barLength(4000, 4000, 20)).toBe(20)
  expect(barLength(10, 4000, 20)).toBe(1)
  expect(toastLine([], 1500)).toBe('Turn done in 1.5s, no tool calls')
})
