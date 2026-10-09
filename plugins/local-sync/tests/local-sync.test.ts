import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { copyCommands, isExcluded, parseExclude, relative } from '../hooks/paths'

// Made-up folders: nothing here names a real machine.
const WIN = { source_dir: 'C:\\work\\repo\\theme', target_dir: 'C:\\sites\\demo\\theme', exclude: '.git,node_modules,data/backup' }
const POSIX = { source_dir: '/home/dev/repo/theme', target_dir: '/srv/demo/theme', exclude: '.git,node_modules' }

type Entry = { name: string; kind: 'file' | 'dir'; mtimeMs: number }
type World = { runs: string[][]; statuses: (string | undefined)[]; failCopy: boolean; tree: Record<string, Entry[]> }

const engine = (on: On): World => {
  const w: World = { runs: [], statuses: [], failCopy: false, tree: {} }
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('command.run', () => ({ text: '' }))
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    w.runs.push(argv)
    const exitCode = w.failCopy ? 16 : argv[0] === 'robocopy' ? 1 : 0
    return { value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('fs.list', (_$, e) => {
    // The kit resolves a POSIX path against this machine's drive on Windows.
    const path = String((e as { path?: string }).path ?? '').replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/home\/)/, '')
    const entries = w.tree[path] ?? []
    return { value: entries.map(x => ({ ...x, size: 1, isLink: false })) } as never
  })
  on('ui.status', (_$, e) => {
    w.statuses.push((e as { text?: string }).text)
    return { value: undefined } as never
  })
  return w
}

const edit = ($: Engine, tool: string, file_path: string) => $.tool.call({ tool, tool_use_id: `u-${file_path}`, file_path, old_string: 'a', new_string: 'b', content: 'x' } as never)
const shell = ($: Engine) => $.tool.call({ tool: 'Bash', tool_use_id: 'u-bash', command: 'node edit.js' } as never)
const command = ($: Engine, args: string) => $.command.run({ command: 'local-sync', args } as Parameters<Engine['command']['run']>[0]) as Promise<{ text?: string }>

test('an edit under the source folder is copied, that one file, to the same path', { options: WIN }, async ($, on) => {
  mock.clock(on)
  const w = engine(on)
  const r = (await edit($, 'Edit', 'C:\\work\\repo\\theme\\assets\\css\\site.css')) as { context?: string[] }
  expect(w.runs).toEqual([['robocopy', 'C:\\work\\repo\\theme\\assets\\css', 'C:\\sites\\demo\\theme\\assets\\css', 'site.css', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']])
  expect(r.context?.[0]).toContain('local-sync copied assets/css/site.css')
  expect(w.statuses.at(-1)).toBe('local-sync: 1 file copied · not checked in a browser yet')
})

test('edits outside the source, excluded paths and failed calls are left alone', { options: WIN }, async ($, on) => {
  mock.clock(on)
  const w = engine(on)
  await edit($, 'Edit', 'C:\\work\\repo\\README.md')
  await edit($, 'Write', 'C:\\work\\repo\\theme\\data\\backup\\dump.json')
  await edit($, 'Edit', 'C:\\work\\repo\\theme\\..\\secrets.txt')
  expect(w.runs).toEqual([])
})

test('after a shell command, the files it changed are copied one by one', { options: POSIX }, async ($, on) => {
  const clock = mock.clock(on, { now: 10_000 })
  const w = engine(on)
  w.tree['/home/dev/repo/theme'] = [
    { name: 'style.css', kind: 'file', mtimeMs: 50_000 },
    { name: 'old.php', kind: 'file', mtimeMs: 1_000 },
    { name: 'inc', kind: 'dir', mtimeMs: 1_000 },
    { name: 'node_modules', kind: 'dir', mtimeMs: 50_000 },
  ]
  w.tree['/home/dev/repo/theme/inc'] = [{ name: 'setup.php', kind: 'file', mtimeMs: 50_000 }]
  await clock.set(10_000)
  await shell($)
  expect(w.runs).toEqual([
    ['mkdir', '-p', '/srv/demo/theme'],
    ['cp', '-p', '/home/dev/repo/theme/style.css', '/srv/demo/theme/style.css'],
    ['mkdir', '-p', '/srv/demo/theme/inc'],
    ['cp', '-p', '/home/dev/repo/theme/inc/setup.php', '/srv/demo/theme/inc/setup.php'],
  ])
})

test('a mass change is not copied at all', { options: POSIX }, async ($, on) => {
  mock.clock(on, { now: 0 })
  const w = engine(on)
  w.tree['/home/dev/repo/theme'] = Array.from({ length: 60 }, (_, i) => ({ name: `f${i}.php`, kind: 'file' as const, mtimeMs: 5_000 }))
  const r = (await shell($)) as { context?: string[] }
  expect(w.runs).toEqual([])
  expect(r.context?.[0]).toContain('none were copied')
})

test('a browser look marks the copies checked; a failed copy says so', { options: WIN }, async ($, on) => {
  mock.clock(on)
  const w = engine(on)
  await edit($, 'Write', 'C:\\work\\repo\\theme\\functions.php')
  await $.tool.call({ tool: 'mcp__Claude_Browser__navigate', tool_use_id: 'u-nav', url: 'https://demo.local' } as never)
  expect(w.statuses.at(-1)).toBe('local-sync: 1 file copied · checked in a browser')
  w.failCopy = true
  await edit($, 'Edit', 'C:\\work\\repo\\theme\\style.css')
  expect(w.statuses.at(-1)).toBe('local-sync: 1 copy failed (style.css)')
})

test('/local-sync reports and turns it off and on', { options: WIN }, async ($, on) => {
  mock.clock(on)
  const w = engine(on)
  await edit($, 'Edit', 'C:\\work\\repo\\theme\\style.css')
  expect((await command($, '')).text).toContain('Copied this session (1): style.css')
  expect((await command($, 'off')).text).toBe('local-sync off.')
  await edit($, 'Edit', 'C:\\work\\repo\\theme\\other.css')
  expect(w.runs.length).toBe(1)
  await command($, 'on')
  await edit($, 'Edit', 'C:\\work\\repo\\theme\\other.css')
  expect(w.runs.length).toBe(2)
})

test('does nothing until both folders are set', async ($, on) => {
  mock.clock(on)
  const w = engine(on)
  await edit($, 'Edit', 'C:\\work\\repo\\theme\\style.css')
  expect(w.runs).toEqual([])
  expect((await command($, '')).text).toContain('/plugin configure local-sync@yasir-mods')
})

test('path rules', async () => {
  expect(relative('C:\\Work\\Repo\\theme', 'c:\\work\\repo\\theme\\a\\b.css')).toBe('a/b.css')
  expect(relative('/a/theme', '/a/theme-two/x.css')).toBeUndefined()
  expect(isExcluded('data/backup/x.json', parseExclude('data/backup'))).toBe(true)
  expect(isExcluded('assets/node_modules/x.js', parseExclude('node_modules'))).toBe(true)
  expect(isExcluded('data/blog.json', parseExclude('data/backup'))).toBe(false)
  expect(copyCommands('/a/x.css', '/b/x.css')).toEqual([['mkdir', '-p', '/b'], ['cp', '-p', '/a/x.css', '/b/x.css']])
})
