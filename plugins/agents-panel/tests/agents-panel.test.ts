import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const FILES: Record<string, string> = {
  'code-reviewer.md': '---\nname: code-reviewer\ndescription: Reviews the current diff for correctness bugs\nmodel: sonnet\ncolor: blue\n---\nYou review code.',
  'docs-writer.md': '---\nname: docs-writer\ndescription: "Keeps README and inline docs in sync"\nmodel: haiku\n---\nYou write docs.',
  'notes.txt': 'not an agent',
}

const pane = {
  component: 'Pane' as const,
  requestId: 'agents-panel',
  props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never,
}

// Stand-ins for the engine beneath the plugin.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const spawned: Array<{ subagentType?: string; prompt: string }> = []
  const toasts: string[] = []
  let isOpen = false
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('command.run', () => ({ text: '' }))
  on('turn.complete', (_, e) => ({ text: e.answer, reason: 'answer' as const }))
  on('ui.open', () => {
    isOpen = true
    return { value: {} } as never
  })
  on('ui.close', () => {
    isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'agents-panel' }] : [] }) as never)
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: Object.keys(FILES).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0 })) }) as never)
  on('fs.read', (_, e) => ({ value: FILES[String(e.path).split(/[\\/]/).pop()!]! }) as never)
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: 'sonnet', agentId: 'agent-1' }
  })
  on('agent.list', () => ({
    value: [{ id: 'agent-1', description: 'code-reviewer (agents panel)', type: 'code-reviewer', status: 'running' }],
  }) as never)

  return { clock, spawned, toasts }
}

const command = ($: Engine) =>
  $.command.run({ command: 'agents-panel', args: '' } as Parameters<Engine['command']['run']>[0]) as Promise<{ text?: string }>

test('lists the agent files with their model, and toggles', async ($, on) => {
  engine(on)
  expect((await command($)).text).toBe('Agents panel open.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agents-panel', surface, ...pane })
    expect(await ui.find({ type: 'Text', text: /\.claude\/agents · 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^code-reviewer$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ haiku$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Keeps README and inline docs in sync/ })).toBeDefined()
    await ui.unmount()
  }

  expect((await command($)).text).toBe('Agents panel closed.')
})

test('run starts the agent, shows it running, then its answer', async ($, on) => {
  const { clock, spawned, toasts } = engine(on)
  await command($)
  const ui = await $.ui.mount({ plugin: 'agents-panel', surface: 'terminal', ...pane })

  await ui.press({ key: 'run-code-reviewer' })
  const first = spawned[0] as { subagentType?: string; subagent_type?: string } | undefined
  expect(first?.subagentType ?? first?.subagent_type).toBe('code-reviewer')
  await clock.advance(3000)
    expect(await ui.find({ type: 'Text', text: /running · 3s/ })).toBeDefined()

  await $.turn.complete({ agentId: 'agent-1', reason: 'answer', answer: 'Found 2 bugs in auth.ts\nDetails...', durationMs: 3000, isAborted: false, turnId: 't1', text: '' } as never)
  expect(await ui.find({ type: 'Text', text: /↳ Found 2 bugs in auth\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✔ 3s/ })).toBeDefined()
  expect(toasts).toContain('code-reviewer finished · 3s')
  await ui.unmount()
})

test('the task typed into the pane is what the next run is asked', async ($, on) => {
  const { spawned } = engine(on)
  await command($)
  const ui = await $.ui.mount({ plugin: 'agents-panel', surface: 'terminal', ...pane })

  await ui.input({ key: 'task', text: 'Only review src/auth' })
  await ui.press({ key: 'run-docs-writer' })
  expect(spawned[0]?.prompt).toBe('Only review src/auth')
  await ui.unmount()
})
