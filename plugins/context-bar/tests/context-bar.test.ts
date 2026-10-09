import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const band = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
}

const row = (name: string, tokens: number, kind = 'used') => ({ name, tokens, kind, color: 'x', isDeferred: false })

// Stand-ins for the engine beneath the plugin: a 1M window, 90k used.
const engine = (on: On) => {
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('command.run', () => ({ text: '' }))
  on('session.usage', () => ({
    value: {
      context: {
        window: 1_000_000,
        breakdown: {
          categories: [
            row('System prompt', 4200),
            row('Tools', 17_000),
            row('MCP tools', 52_000),
            row('Memory files', 8600),
            row('Messages', 8200),
            row('Free space', 897_000, 'free'),
            row('Autocompact buffer', 13_000, 'buffer'),
          ],
          totalTokens: 90_000,
          rawMaxTokens: 1_000_000,
          percentage: 9,
          autoCompactThreshold: 987_000,
          isAutoCompactEnabled: true,
        },
      },
    },
  }) as never)
}

const command = ($: Engine, args: string) =>
  $.command.run({ command: 'context-bar', args } as Parameters<Engine['command']['run']>[0]) as Promise<{ text?: string }>

test('draws the window, the compaction point and a legend by category', async ($, on) => {
  engine(on)
  await command($, 'refresh')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-bar', surface, ...band })
    expect(await ui.find({ type: 'Text', text: /^90k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /of 1M · compacts at 987k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^9%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^mcp tools 52k 5%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^free space 897k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /buffer/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('/context-bar hides and shows it', async ($, on) => {
  engine(on)
  await command($, 'refresh')

  expect((await command($, '')).text).toBe('Context bar hidden.')
  const hidden = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...band })
  expect(await hidden.find({ type: 'Text', text: /context/ })).toBeUndefined()
  await hidden.unmount()

  expect((await command($, '')).text).toBe('Context bar shown.')
  const shown = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...band })
  expect(await shown.find({ type: 'Text', text: /^context$/ })).toBeDefined()
  await shown.unmount()
})
