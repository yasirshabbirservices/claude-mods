import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Sent = { model: string; effort?: unknown; agentId?: string }

// The engine beneath the plugin: a classifier that answers `reply` (or fails),
// a model loop that records each request as it was sent, and the transcript.
const engine = (on: On, reply: string | { fails: true }) => {
  const sent: Sent[] = []
  const logs: string[] = []
  let classified = 0
  on('model.complete', () => {
    classified += 1
    if (typeof reply !== 'string') return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: null } } as never
    return { value: { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  on('ui.log', (_$, e) => {
    logs.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    sent.push({ model: e.model, effort: e.effort, ...(e.agentId === undefined ? {} : { agentId: e.agentId }) })
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  return { sent, logs, classified: () => classified }
}

const step = async ($: Engine, turnId: string, index: number, extra: Partial<Sent> = {}) => {
  const stream = $.turn.step({ turnId, index, model: 'claude-sonnet-5-5', effort: 'xhigh', messageCount: 3, ...extra } as never)
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

const turn = async ($: Engine, text: string, steps = 1, extra: Partial<Sent> = {}) => {
  await $.turn.start({ text, turnId: `t-${text.length}` } as never)
  for (let i = 0; i < steps; i += 1) await step($, `t-${text.length}`, i, extra)
}

test('hard work gets high effort; the main model stays put by default and the log says what it would use', async ($, on) => {
  const w = engine(on, '{"tier":"hard","confidence":0.9,"why":"concurrency bug in the scheduler"}')
  await turn($, 'find the race in the job scheduler', 2)
  expect(w.sent).toEqual([
    { model: 'claude-sonnet-5-5', effort: 'high' },
    { model: 'claude-sonnet-5-5', effort: 'high' },
  ])
  expect(w.logs.length).toBe(1)
  expect(w.logs[0]).toContain('router: hard')
  expect(w.logs[0]).toContain('model kept claude-sonnet-5-5 (main-model switching off; would use claude-opus-5-5)')
  expect(w.logs[0]).toContain('effort xhigh → high')
})

test('confident mechanical work goes to the cheap model when main-model switching is on', { options: { switch_main_model: true } }, async ($, on) => {
  const w = engine(on, '{"tier":"mechanical","confidence":0.95,"why":"rename one variable"}')
  await turn($, 'rename foo to bar in utils.ts')
  expect(w.sent).toEqual([{ model: 'claude-haiku-5-5', effort: 'low' }])
  expect(w.logs[0]).toContain('model claude-sonnet-5-5 → claude-haiku-5-5')
})

test('moves down only when confident, and up when the evidence is weak', async ($, on) => {
  const w = engine(on, '{"tier":"mechanical","confidence":0.7}')
  await turn($, 'tidy the imports')
  expect(w.sent[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  expect(w.logs[0]).toContain('router: ordinary (classified mechanical, not sure enough to move down')
})

test('weak evidence for ordinary work moves it up to hard', async ($, on) => {
  const w = engine(on, '{"tier":"ordinary","confidence":0.4}')
  await turn($, 'make the checkout flow better')
  expect(w.sent[0]?.effort).toBe('high')
  expect(w.logs[0]).toContain('router: hard (classified ordinary, weak evidence')
})

test('risky words keep a prompt off the cheap model', { options: { switch_main_model: true } }, async ($, on) => {
  const w = engine(on, '{"tier":"mechanical","confidence":0.99}')
  await turn($, 'delete the old rows in the production table')
  expect(w.sent[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  expect(w.logs[0]).toContain('risky words')
})

test('subagents are routed even with main-model switching off', async ($, on) => {
  const w = engine(on, '{"tier":"mechanical","confidence":0.95}')
  await turn($, 'list the files in src', 1, { agentId: 'a1' })
  expect(w.sent).toEqual([{ model: 'claude-haiku-5-5', effort: 'low', agentId: 'a1' }])
  expect(w.logs[0]).toContain('subagent a1')
})

test('a failed classifier sends every request unchanged and says so', async ($, on) => {
  const w = engine(on, { fails: true })
  await turn($, 'rename foo to bar', 2)
  expect(w.sent).toEqual([
    { model: 'claude-sonnet-5-5', effort: 'xhigh' },
    { model: 'claude-sonnet-5-5', effort: 'xhigh' },
  ])
  expect(w.logs).toEqual(['router: classifier api-error; requests sent unchanged'])
})

test('an unreadable classification sends the request unchanged', async ($, on) => {
  const w = engine(on, 'I think it is fairly hard?')
  await turn($, 'rename foo to bar')
  expect(w.sent).toEqual([{ model: 'claude-sonnet-5-5', effort: 'xhigh' }])
  expect(w.logs[0]).toContain('could not read the classification')
})

test('leaves effort alone when effort setting is off', { options: { set_effort: false } }, async ($, on) => {
  const w = engine(on, '{"tier":"hard","confidence":0.9}')
  await turn($, 'design the sharding scheme')
  expect(w.sent[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'xhigh' })
  expect(w.logs[0]).toContain('effort unchanged (off)')
})

test('leaves effort alone for a model that has none', async ($, on) => {
  const w = engine(on, '{"tier":"hard","confidence":0.9}')
  await $.turn.start({ text: 'design it', turnId: 'tx' } as never)
  const stream = $.turn.step({ turnId: 'tx', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 } as never)
  for await (const _ of stream) {
    // drain
  }
  expect(w.sent[0]?.effort).toBeUndefined()
  expect(w.logs[0]).toContain('effort n/a for this model')
})
