import { expect, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { MASK, maskText } from '../hooks/secrets'

// Fake secrets, built in pieces so no scanner mistakes this file for a leak.
const GITHUB = 'gh' + 'p_' + 'FAKE0123456789abcdefghijklmnopqrstuv'
const ANTHROPIC = 'sk-' + 'ant-' + 'test-FAKEabcdefghijklmnopqrstuvwxyz'
const PASSWORD = 'hunter2hunter2'

// The engine's own rows beneath the plugin: they draw 'engine' and record
// the props they were handed.
const engine = (on: On) => {
  const seen: Record<string, unknown>[] = []
  on('ui.render', ($, e) => {
    seen.push(e.props as Record<string, unknown>)
    const { Box, Text } = $.ui.resolve(e)
    return h(Box, {}, h(Text, {}, 'engine')) as RenderElement
  })
  return seen
}

const reply = (text: string) => ({ component: 'AssistantMessage' as const, props: { text, isFirstOfReply: true } })

test('masks secrets in a reply on the desktop and reveals them only on hover', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'hover-reveal',
    surface: 'desktop',
    ...reply(`Set \`GITHUB_TOKEN=${GITHUB}\` and use the key ${ANTHROPIC} for the call.`),
  })

  const md = await ui.find({ type: 'Markdown' } as never)
  const text = String((md as { props: { text: string } }).props.text)
  expect(text).toContain(MASK)
  expect(text).not.toContain(GITHUB)
  expect(text).not.toContain(ANTHROPIC)

  expect(await ui.find({ type: 'Text', text: /2 hidden values · hover to show/ })).toBeDefined()
  const row = (await ui.find({ key: 'hover-reveal' })) as { children: { props: Record<string, unknown>; hover?: unknown }[] }
  const card = row.children[1]
  expect(card?.props.display).toBe('none')
  expect(card?.hover).toEqual({ display: 'flex' })
  expect(await ui.find({ type: 'Text', text: new RegExp(GITHUB) })).toBeDefined()
  await ui.unmount()
})

test('leaves the terminal and secret-free replies to the engine', async ($, on) => {
  engine(on)
  const terminal = await $.ui.mount({ plugin: 'hover-reveal', surface: 'terminal', ...reply(`key ${ANTHROPIC}`) })
  expect(await terminal.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await terminal.unmount()

  const plain = await $.ui.mount({ plugin: 'hover-reveal', surface: 'desktop', ...reply('Commit 3f2a9c1e8b7d6f5a4c3b2a1908f7e6d5c4b3a291 and id 123e4567-e89b-12d3-a456-426614174000 are fine.') })
  expect(await plain.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await plain.unmount()
})

test('masks a command holding a token in the engine\'s own tool row', async ($, on) => {
  const seen = engine(on)
  const ui = await $.ui.mount({
    plugin: 'hover-reveal',
    surface: 'desktop',
    component: 'ToolUse',
    props: {
      tool_use_id: 't1',
      tool: 'Bash',
      input: { command: `curl -H "Authorization: Bearer ${ANTHROPIC}" https://api.example.com` },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  } as never)
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  const command = (seen[seen.length - 1]?.input as { command: string }).command
  expect(command).toContain(MASK)
  expect(command).not.toContain(ANTHROPIC)
  await ui.unmount()
})

test('draws a tool result holding secrets itself, masked, with the hover line', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'hover-reveal',
    surface: 'desktop',
    component: 'ToolResult',
    props: {
      tool_use_id: 't2',
      tool: 'Bash',
      output: { stdout: `DATABASE_URL=postgres://app:${PASSWORD}@db:5432/app\nAPI_KEY=${GITHUB}\nDEBUG=true`, stderr: '', interrupted: false },
      isErrored: false,
    },
  } as never)
  const code = (await ui.find({ type: 'Code' } as never)) as { props: { source: string } }
  expect(code.props.source).not.toContain(PASSWORD)
  expect(code.props.source).not.toContain(GITHUB)
  expect(code.props.source).toContain('DEBUG=true')
  expect(await ui.find({ type: 'Text', text: /2 hidden values/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
  await ui.unmount()
})

test('detects common secrets and skips references and ordinary ids', async () => {
  const hits = [
    'AKIA' + 'ABCDEFGHIJKLMNOP',
    'xox' + 'b-123456789012-abcdefghij',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop',
    `password: "${PASSWORD}"`,
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  ]
  for (const text of hits) expect(maskText(text).secrets.length).toBe(1)

  const misses = ['API_KEY=$API_KEY', 'TOKEN=${TOKEN}', 'api_key: process.env.API_KEY', 'the token is short', 'git sha 9fceb02d0ae598e95dc970b74767f19372d61af8']
  for (const text of misses) expect(maskText(text).secrets).toEqual([])
})
