import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { draftReply, findDecisions } from '../hooks/decisions'

const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}

const AUDIT = [
  'I audited the pricing page. Five decisions:',
  '',
  '- **D1** — Tighten the hero spacing on short screens.',
  '- **D2**: Move the FAQ above the footer CTA.',
  '- **D3** — Replace the static year with a live tag.',
  '- **D4** — Shorten the card copy to two lines.',
  '- **D5** — Keep the old badge as is.',
  '',
  'I recommend all five. Which do you approve?',
].join('\n')

const DONE = 'All five fixes (D1–D5) are in and verified.\n- **D1** — spacing fixed\n- **D2** — FAQ moved'

type World = { box: string; filled: string[]; submitted: string[] }

const engine = (on: On): World => {
  const w: World = { box: '', filled: [], submitted: [] }
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'below' }) as RenderElement)
  on('prompt.submit', (_$, e) => {
    w.submitted.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.read', () => ({ value: { text: w.box, cursor: w.box.length } }))
  on('prompt.fill', (_$, e) => {
    w.box = e.mode === 'append' ? w.box + e.text : e.text
    w.filled.push(e.text)
    return { isFilled: true }
  })
  return w
}

const answer = ($: Engine, text: string) =>
  $.turn.complete({ answer: text, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)

test('finds the decisions a reply asks about, and ignores a report of finished ones', async () => {
  const found = findDecisions(AUDIT)
  expect(found.map(d => d.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5'])
  expect(found[0]?.label).toBe('Tighten the hero spacing on short s…')
  expect(found[1]?.label).toBe('Move the FAQ above the footer CTA.')
  expect(findDecisions(DONE)).toEqual([])
})

test('writes the reply the way it is usually typed', async () => {
  const all = findDecisions(AUDIT)
  expect(draftReply(all)).toBe('approved all, implement D1 to D5')
  const some = all.map(d => (d.id === 'D2' || d.id === 'D5' ? { ...d, isOn: false } : d))
  expect(draftReply(some)).toBe('approved, implement D1, D3 and D4; skip D2 and D5')
  expect(draftReply(all.map(d => ({ ...d, isOn: false })))).toBe('skip all of D1 to D5 for now')
})

test('toggles above the prompt; Approve drafts the reply and never sends it', async ($, on) => {
  const w = engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    w.box = ''
    await answer($, AUDIT)
    const ui = await $.ui.mount({ plugin: 'decision-picker', surface, ...band })
    expect(await ui.find({ type: 'Button', text: /☑ D3/ })).toBeDefined()
    expect(await ui.find({ key: 'below' })).toBeDefined()
    await ui.press({ key: 'toggle-D3' })
    expect(await ui.find({ type: 'Button', text: /☐ D3/ })).toBeDefined()
    await ui.press({ key: 'approve' })
    expect(w.box).toBe('approved, implement D1, D2, D4 and D5; skip D3')
    expect(w.submitted).toEqual([])
    expect(await ui.find({ key: 'approve' })).toBeUndefined()
    await ui.unmount()
  }
})

test('keeps a draft already typed, and clears when a prompt is sent', async ($, on) => {
  const w = engine(on)
  await answer($, AUDIT)
  w.box = 'one note:'
  const ui = await $.ui.mount({ plugin: 'decision-picker', surface: 'desktop', ...band })
  await ui.press({ key: 'approve' })
  expect(w.box).toBe('one note:\napproved all, implement D1 to D5')
  await ui.unmount()

  await answer($, AUDIT)
  await $.prompt.submit({ text: 'something else', wait: false } as never)
  const after = await $.ui.mount({ plugin: 'decision-picker', surface: 'terminal', ...band })
  expect(await after.find({ key: 'approve' })).toBeUndefined()
  await after.unmount()
})
