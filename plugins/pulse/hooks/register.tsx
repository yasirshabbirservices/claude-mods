import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { PulseMode, PulseState } from '../types'
import { COLORS, DONE_MS, ERROR_MS, IDLE_STOP_MS, describe, isAnimating, rowCells, svgBar } from './glow'

// A slim glowing bar above the prompt with what Claude is doing in plain
// words beside it. Observe only: tool calls pass through unchanged. The bar
// stops moving after a minute idle. /pulse shows it, /pulse off hides it.

const stateAtom = atom({ plugin: 'pulse', key: 'state' } as const, { mode: 'idle', label: 'Ready', color: COLORS.idle, since: 0 } as PulseState)
const nowAtom = atom({ plugin: 'pulse', key: 'now' } as const, 0)
const offAtom = atom({ plugin: 'pulse', key: 'isOff' } as const, false)

const FRAME_MS = 140
const LABEL_WIDTH = 34

type Clock = { tick?: Timer; after?: Timer }
type Running = { id: string; label: string; color: string }
type Ctx = { clock: Clock; running: Running[]; isTurnActive: boolean }

async function frame($: EngineInterface, clock: Clock) {
  const now = await $.clock.now()
  const s = await read($, stateAtom)
  await update($, nowAtom, () => now)
  if (!isAnimating(s.mode, now - s.since)) {
    clock.tick?.cancel()
    clock.tick = undefined
  }
}

async function show($: EngineInterface, clock: Clock, mode: PulseMode, label: string, color: string, then?: () => Promise<void>) {
  const now = await $.clock.now()
  clock.after?.cancel()
  clock.after = undefined
  await update($, stateAtom, () => ({ mode, label, color, since: now }))
  await update($, nowAtom, () => now)
  if (clock.tick === undefined) {
    clock.tick = $.clock.every(FRAME_MS, () => {
      void frame($, clock)
    })
  }
  if (then !== undefined) {
    clock.after = $.clock.after(mode === 'done' ? DONE_MS : ERROR_MS, () => {
      void then()
    })
  }
}

// What the bar shows once a tool or a one-shot is over.
async function settle($: EngineInterface, ctx: Ctx) {
  const top = ctx.running[ctx.running.length - 1]
  if (top !== undefined) return show($, ctx.clock, 'tool', top.label, top.color)
  if (ctx.isTurnActive) return show($, ctx.clock, 'thinking', 'Thinking', COLORS.thinking)
  return show($, ctx.clock, 'idle', 'Ready', COLORS.idle)
}

export const register: Register = on => {
  const ctx: Ctx = { clock: {}, running: [], isTurnActive: false }
  const { clock, running } = ctx

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pulse', description: 'Show the pulse bar; /pulse off hides it', argumentHint: '[off]', immediate: true })
    await show($, clock, 'idle', 'Ready', COLORS.idle)
    return next(e)
  })

  on('command.run', { command: 'pulse' }, async ($, e) => {
    const isOff = e.args.trim().toLowerCase() === 'off'
    await update($, offAtom, () => isOff)
    return { text: isOff ? 'Pulse hidden. /pulse shows it again.' : 'Pulse shown.' }
  })

  on('prompt.submit', async ($, e, next) => {
    ctx.isTurnActive = true
    await show($, clock, 'thinking', 'Thinking', COLORS.thinking)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const { label, color } = describe(e.tool, e as unknown as Record<string, unknown>)
    const mine: Running = { id: e.tool_use_id, label, color }
    running.push(mine)
    await show($, clock, 'tool', label, color)

    const result = await next(e)

    const at = running.findIndex(r => r.id === mine.id)
    if (at >= 0) running.splice(at, 1)
    if (result.deny !== undefined || result.isError === true) {
      await show($, clock, 'error', `${e.tool.startsWith('mcp__') ? label.replace(/^Calling/, 'Error from') : `Error in ${e.tool}`}`, COLORS.error, () => settle($, ctx))
    } else {
      await settle($, ctx)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    ctx.isTurnActive = false
    running.length = 0
    if (e.reason === 'answer') await show($, clock, 'done', 'Done', COLORS.done, () => settle($, ctx))
    else if (e.reason === 'aborted') await show($, clock, 'idle', 'Stopped', COLORS.idle)
    else await show($, clock, 'error', e.reason === 'refusal' ? 'Turn refused' : 'Turn ended with an error', COLORS.error, () => settle($, ctx))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, offAtom))) return next(e)
    const s = await read($, stateAtom)
    const below = await next(e)
    const label = s.label.length > LABEL_WIDTH ? `${s.label.slice(0, LABEL_WIDTH - 1)}…` : s.label

    if (e.surface === 'desktop') {
      const { Box, Svg, Text } = $.ui.resolve(e)
      const idleLeft = s.mode === 'idle' ? IDLE_STOP_MS - Math.max(0, (await $.clock.now()) - s.since) : IDLE_STOP_MS
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text dimColor={s.mode === 'idle'} color={s.mode === 'idle' ? undefined : s.color}>
              {label.padEnd(LABEL_WIDTH)}
            </Text>
            <Svg source={svgBar(s.mode, s.color, idleLeft)} alt={label} height={6} isInteractive />
          </Box>
        </Box>
      )
    }
    if (e.surface !== 'terminal') return next(e)

    const now = await read($, nowAtom)
    const { Box, Raster, Text } = $.ui.resolve(e)
    const columns = Math.max(8, e.props.bodyColumns - LABEL_WIDTH - 1)
    const cells = rowCells(s.mode, s.color, Math.max(0, now - s.since), columns)
    const words = new Uint32Array(cells.length * 3)
    cells.forEach((c, i) => words.set(c, i * 3))
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" gap={1}>
          <Text dimColor={s.mode === 'idle'} color={s.mode === 'idle' ? undefined : s.color}>
            {label.padEnd(LABEL_WIDTH)}
          </Text>
          <Raster key="pulse" columns={columns} rows={1} cells={base64(new Uint8Array(words.buffer))} />
        </Box>
      </Box>
    )
  })
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}
