import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const pane = {
  component: 'Pane' as const,
  requestId: 'blast-radius',
  props: { title: 'Blast Radius', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never,
}

// The engine may hand hooks absolute paths: keep the part from build/ on.
const rel = (p: unknown) => String(p).replace(/\\/g, '/').replace(/^.*?(build(\/lib)?(\/[^/]+)?)$/, '$1')
const TREE: Record<string, string[]> = { build: ['a.js', 'b.js', 'lib'], 'build/lib': ['c.js'] }

// Stand-ins for the engine: a repo two files dirty against HEAD~1, one commit ahead.
const engine = (on: On) => {
  const ran: string[] = []
  const sleeps: Array<() => void> = []
  let isOpen = false
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('ui.open', () => {
    isOpen = true
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', () => {
    isOpen = false
    return { value: undefined } as never
  })
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'blast-radius', isPlaced: true }] : [] }) as never)
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv.join(' ')
    if (argv.startsWith('sleep')) return new Promise(r => sleeps.push(() => r({ value: { exitCode: 0, stdout: '', stderr: '' } }))) as never
    const out = argv.startsWith('git diff') ? 'src/a.ts\nsrc/b.ts\n' : argv.startsWith('git log') ? 'abc123 Add login\n' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '' } } as never
  })
  on('fs.exists', (_, e) => ({ value: rel(e.path) in TREE || /\.js$/.test(rel(e.path)) }) as never)
  on('fs.stat', (_, e) => ({ value: { kind: rel(e.path) in TREE ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('fs.list', (_, e) => ({
    value: (TREE[rel(e.path)] ?? []).map(name => ({ name, kind: name.endsWith('.js') ? 'file' : 'dir', size: 1, mtimeMs: 0 })),
  }) as never)
  on('tool.call', (_, e) => {
    ran.push((e as { command: string }).command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
  })
  const release = async (until: Promise<unknown>) => {
    let isDone = false
    void until.then(() => (isDone = true))
    for (let i = 0; i < 500 && !isDone; i++) {
      sleeps.splice(0).forEach(wake => wake())
      await new Promise(r => r(undefined))
    }
    return until
  }
  return { ran, isOpen: () => isOpen, release }
}

const bash = ($: Engine, command: string) =>
  $.tool.call({ tool: 'Bash', command, tool_use_id: `t-${command.length}` } as never) as Promise<{ deny?: string; text?: string }>

// Waits until the plugin has opened its pane, then mounts it.
async function mountHeld($: Engine, isOpen: () => boolean) {
  for (let i = 0; i < 200 && !isOpen(); i++) await Promise.resolve()
  return $.ui.mount({ plugin: 'blast-radius', surface: 'terminal', ...pane })
}

test('other commands run untouched', async ($, on) => {
  const { ran, isOpen } = engine(on)
  await bash($, 'git status && rm file.txt && git push')
  expect(ran).toEqual(['git status && rm file.txt && git push'])
  expect(isOpen()).toBe(false)
})

test('Cancel refuses git reset --hard and tells Claude why', async ($, on) => {
  const { ran, isOpen, release } = engine(on)
  const call = bash($, 'git reset --hard HEAD~1')
  const ui = await mountHeld($, isOpen)

  expect(await ui.find({ type: 'Text', text: /3 files and commits/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /commit dropped: abc123 Add login/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /changes lost: src\/a\.ts/ })).toBeDefined()

  await ui.press({ key: 'cancel' })
  const answer = (await release(call)) as { deny?: string }
  expect(answer.deny).toMatch(/pressed Cancel on `git reset --hard HEAD~1`/)
  expect(ran).toEqual([])
})

test('Proceed lets rm -r run, after listing every file', async ($, on) => {
  const { ran, isOpen, release } = engine(on)
  const call = bash($, 'rm -rf build/')
  const ui = await mountHeld($, isOpen)

  expect(await ui.find({ type: 'Text', text: /3 files/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /build\/lib\/c\.js/ })).toBeDefined()

  await ui.press({ key: 'proceed' })
  await release(call)
  expect(ran).toEqual(['rm -rf build/'])
})
