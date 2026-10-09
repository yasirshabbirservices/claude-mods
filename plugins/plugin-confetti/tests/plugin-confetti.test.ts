import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { BRANDS, PLUG, brandFor, identify } from '../hooks/brands'
import { LOGOS } from '../hooks/logos'
import { pixels } from '../hooks/raster'

const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}

// The engine beneath: every tool call succeeds (or fails, for `failing`), the
// tool list describes the desktop app's id-named Gmail server, and the band
// is empty unless the plugin draws.
const engine = (on: On, failing = false) => {
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('command.run', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'done', isError: failing }) as never)
  on('tool.list', () => ({ value: [{ name: 'mcp__31ded475-b254__send_message', description: 'Gmail API: send a message', mcp: true }] }) as never)
}

const call = ($: Engine, tool: string) => $.tool.call({ tool, tool_use_id: `u-${tool}` } as never)
const command = ($: Engine, args: string) =>
  $.command.run({ command: 'confetti', args } as Parameters<Engine['command']['run']>[0]) as Promise<{ text?: string }>

test('an MCP call that finishes shows its plugin, on the desktop and in the terminal, then clears', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  await call($, 'mcp__claude_ai_Zapier__run_action')
  const zapier = brandFor('zapier')

  const desk = await $.ui.mount({ plugin: 'plugin-confetti', surface: 'desktop', ...band })
  const svg = (await desk.find({ type: 'Svg' } as never)) as { props: { alt: string; source: string; isInteractive: boolean } }
  expect(svg.props.alt).toBe(`${zapier.name} finished`)
  expect(svg.props.source).toContain('<animateTransform')
  expect(svg.props.source).toContain(`fill="#${zapier.hex}"`)
  expect(svg.props.isInteractive).toBe(true)
  await desk.unmount()

  const term = await $.ui.mount({ plugin: 'plugin-confetti', surface: 'terminal', ...band })
  expect(await term.find({ key: 'logo' })).toBeDefined()
  expect(await term.find({ key: 'confetti' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: `${zapier.name} finished ✓` })).toBeDefined()
  await term.unmount()

  await clock.advance(2500)
  const after = await $.ui.mount({ plugin: 'plugin-confetti', surface: 'desktop', ...band })
  expect(await after.find({ type: 'Svg' } as never)).toBeUndefined()
  await after.unmount()
})

test('a server named by id is identified from its tool description', async ($, on) => {
  mock.clock(on)
  engine(on)
  await call($, 'mcp__31ded475-b254__send_message')
  const ui = await $.ui.mount({ plugin: 'plugin-confetti', surface: 'desktop', ...band })
  const svg = (await ui.find({ type: 'Svg' } as never)) as { props: { alt: string } }
  expect(svg.props.alt).toBe(`${brandFor('gmail').name} finished`)
  await ui.unmount()
})

test('built-in tools, failed calls and unknown plugins', async ($, on) => {
  mock.clock(on)
  engine(on, true)
  await call($, 'Read')
  await call($, 'mcp__claude_ai_Slack__post')
  const quiet = await $.ui.mount({ plugin: 'plugin-confetti', surface: 'desktop', ...band })
  expect(await quiet.find({ type: 'Svg' } as never)).toBeUndefined()
  await quiet.unmount()
})

test('an unknown plugin gets the neutral plug mark', async ($, on) => {
  mock.clock(on)
  engine(on)
  await call($, 'mcp__acme-internal__sync')
  const ui = await $.ui.mount({ plugin: 'plugin-confetti', surface: 'desktop', ...band })
  const svg = (await ui.find({ type: 'Svg' } as never)) as { props: { alt: string; source: string } }
  expect(svg.props.alt).toBe('Plugin finished')
  expect(svg.props.source).toContain(PLUG.path)
  await ui.unmount()
})

test('/confetti previews a logo, lists the logos, and falls back to the plug', async ($, on) => {
  mock.clock(on)
  engine(on)
  expect((await command($, '')).text).toMatch(/Logos:|No logos are bundled yet/)
  expect((await command($, 'definitely-not-a-brand')).text).toBe('No logo for "definitely-not-a-brand": showing the neutral plug mark.')
  const ui = await $.ui.mount({ plugin: 'plugin-confetti', surface: 'desktop', ...band })
  expect(await ui.find({ type: 'Svg' } as never)).toBeDefined()
  await ui.unmount()
})

test('every bundled logo is a real Simple Icons entry for a listed brand', async () => {
  for (const [slug, logo] of Object.entries(LOGOS)) {
    expect(BRANDS.some(b => b.slug === slug)).toBe(true)
    expect(logo.hex).toMatch(/^[0-9A-F]{6}$/i)
    expect(logo.path.length).toBeGreaterThan(20)
  }
})

test('identifies plugins by server name and description', async () => {
  expect(identify('mcp__claude_ai_Gmail__create_draft')).toBe('gmail')
  expect(identify('mcp__plugin_small-business_google-calendar__list_events')).toBe('googlecalendar')
  expect(identify('mcp__abc__x', 'This is an MCP server provided by Google Calendar API')).toBe('googlecalendar')
  expect(identify('mcp__abc__x', 'Hostinger Email API access')).toBe('hostinger')
  expect(identify('mcp__abc__x', 'internal widgets')).toBeUndefined()
})

test('the rasterizer fills shapes from SVG paths', async () => {
  const square = pixels('M0 0h24v24H0z', 8)
  expect(square.flat().every(Boolean)).toBe(true)
  const ring = pixels('M12 0a12 12 0 1 1 0 24a12 12 0 1 1 0-24zm0 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12z', 12)
  expect(ring[6]?.[6]).toBe(false) // the hole
  expect(ring[6]?.[1]).toBe(true) // the ring
  expect(ring[0]?.[0]).toBe(false) // outside the circle
})
