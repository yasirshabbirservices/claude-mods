import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Celebration } from '../types'
import { BRANDS, brandFor, identify, lookup, serverOf } from './brands'
import { FRAMES, confettiCells, svgCard } from './confetti'
import { LOGOS } from './logos'
import { logoCells, pack } from './raster'

// When an MCP tool call finishes, the band above the prompt shows that
// plugin's logo with a short burst of confetti, then clears. /confetti <name>
// previews any logo without a tool call.

const now = atom({ plugin: 'plugin-confetti', key: 'now' } as const, null as Celebration | null)
const frame = atom({ plugin: 'plugin-confetti', key: 'frame' } as const, 0)

const SHOW_MS = 2400
const FRAME_MS = 90
const LOGO_COLUMNS = 12

type Timers = { seq: number; every?: Timer; after?: Timer }

async function describeTool($: EngineInterface, tool: string): Promise<string> {
  const tools = await $.tool.list()
  return tools.find(t => t.name === tool)?.description ?? ''
}

async function celebrate($: EngineInterface, slug: string | undefined, timers: Timers) {
  timers.every?.cancel()
  timers.after?.cancel()
  timers.seq += 1
  const seq = timers.seq
  await update($, frame, () => 0)
  await update($, now, () => ({ brand: slug ?? 'plug', seq }))
  timers.every = $.clock.every(FRAME_MS, () => {
    void update($, frame, n => Math.min(n + 1, FRAMES))
  })
  timers.after = $.clock.after(SHOW_MS, () => {
    timers.every?.cancel()
    void update($, now, c => (c?.seq === seq ? null : c))
  })
}

const logoCache = new Map<string, string>()

export const register: Register = on => {
  const timers: Timers = { seq: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'confetti',
      description: 'Preview a plugin logo with confetti',
      argumentHint: '[plugin name]',
      immediate: true,
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (serverOf(e.tool) === undefined || result.deny !== undefined || result.isError === true) return result
    try {
      const slug = identify(e.tool) ?? identify(e.tool, await describeTool($, e.tool))
      await celebrate($, slug, timers)
    } catch {
      // A burst that cannot be drawn is skipped; the call's result stands.
    }
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'confetti' }, async ($, e) => {
    const query = e.args.trim()
    if (query === '') {
      const names = BRANDS.filter(b => LOGOS[b.slug] !== undefined).map(b => b.slug)
      return { text: names.length === 0 ? 'No logos are bundled yet; /confetti <name> shows the plug mark.' : `Logos: ${names.join(', ')}. Try /confetti ${names[0]}.` }
    }
    const slug = lookup(query)
    const brand = brandFor(slug ?? 'plug')
    await celebrate($, slug, timers)
    return { text: brand.isKnown ? `🎉 ${brand.name}` : `No logo for "${query}": showing the neutral plug mark.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, now)
    if (c === null || e.props.hasSurvey) return next(e)
    const brand = brandFor(c.brand)

    if (e.surface === 'desktop') {
      const { Box, Svg } = $.ui.resolve(e)
      return (
        <Box>
          <Svg source={svgCard(brand, c.seq)} alt={`${brand.name} finished`} width={360} height={72} isInteractive />
        </Box>
      )
    }
    if (e.surface !== 'terminal') return next(e)

    const f = await read($, frame)
    const { Box, Raster, Text } = $.ui.resolve(e)
    let logo = logoCache.get(brand.id)
    if (logo === undefined) {
      logo = pack(logoCells(brand.path, parseInt(brand.hex, 16), LOGO_COLUMNS))
      logoCache.set(brand.id, logo)
    }
    return (
      <Box flexDirection="row" gap={2}>
        <Raster key="logo" columns={LOGO_COLUMNS} rows={LOGO_COLUMNS / 2} cells={logo} />
        <Box flexDirection="column">
          <Text bold>{brand.name} finished ✓</Text>
          <Raster key="confetti" columns={36} rows={3} cells={confettiCells(f, c.seq, brand.hex)} />
        </Box>
      </Box>
    )
  })
}
