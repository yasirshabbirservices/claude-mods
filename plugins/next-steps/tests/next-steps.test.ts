import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const band = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
}

const LONG = 'I changed the login handler to refresh the token before it expires, and added a retry around the call.'

type World = { box: string; filled: { text: string; mode?: string }[]; submitted: string[]; asked: number }

// Stand-ins for the engine beneath the plugin: a prompt box, two commands of
// the person's, and a model that always answers with `reply`.
const engine = (on: On, reply: string): World => {
  const world: World = { box: '', filled: [], submitted: [], asked: 0 }
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('prompt.submit', (_$, e) => {
    world.submitted.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.list', () => ({ value: [
    { name: 'review-pr', description: 'Review a pull request', source: 'user' },
    { name: 'compact', description: 'Compact the conversation', source: 'builtin' },
  ] }) as never)
  on('model.complete', () => {
    world.asked += 1
    return { value: { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  on('prompt.read', () => ({ value: { text: world.box, cursor: world.box.length } }))
  on('prompt.fill', (_$, e) => {
    world.filled.push({ text: e.text, mode: e.mode })
    world.box = e.mode === 'append' ? world.box + e.text : e.text
    return { isFilled: true }
  })
  return world
}

const turn = async ($: Engine, prompt: string, answer: string) => {
  await $.prompt.submit({ text: prompt, wait: false } as never)
  await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
}

test('offers up to three suggestions and drops commands the person does not have', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, 'Sure: ["Run the tests for the login handler", "/review-pr 12", "/ghost-command", "Commit it", "One more"]')
  await turn($, 'fix the login bug', LONG)
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'next-steps', surface, ...band })
    expect(await ui.find({ key: 'step-1' })).toBeDefined()
    expect(await ui.find({ key: 'step-3' })).toBeDefined()
    expect(await ui.find({ key: 'step-4' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: '/review-pr 12' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /ghost/ })).toBeUndefined()
    await ui.unmount()
  }
  expect(world.asked).toBe(1)
})

test('pressing one drafts it in the prompt box and never sends it', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, '["Run the tests", "/review-pr 12", "Commit it"]')
  await turn($, 'fix the login bug', LONG)
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', ...band })
  await ui.press({ key: 'step-2' })
  expect(world.filled).toEqual([{ text: '/review-pr 12', mode: 'replace' }])
  expect(world.submitted).toEqual(['fix the login bug'])
  expect(await ui.find({ key: 'step-1' })).toBeUndefined()
  await ui.unmount()
})

test('keeps a draft the person already typed and adds the suggestion after it', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, '["Run the tests"]')
  await turn($, 'fix the login bug', LONG)
  await clock.settle()
  world.box = 'also check'

  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'desktop', ...band })
  await ui.press({ key: 'step-1' })
  expect(world.box).toBe('also check\nRun the tests')
  await ui.unmount()
})

test('skips answers shorter than 80 characters', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, '["Run the tests"]')
  await turn($, 'hi', 'Hello! What would you like to work on?')
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', ...band })
  expect(await ui.find({ key: 'step-1' })).toBeUndefined()
  await ui.unmount()
  expect(world.asked).toBe(0)
})
