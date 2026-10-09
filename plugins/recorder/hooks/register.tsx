import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RecordedCall, RecordedTurn } from '../types'
import { COLORS, barLength, categoryOf, middle, seconds, targetOf, toastLine } from './calls'

// Records every tool call of a turn (name, short target, duration, error or
// not) and draws it as a timeline in a pane: /recorder opens it. Observe only:
// a call is never changed or held, and no file contents or output are kept.

const PANE = 'recorder'
const MAX_TURNS = 10
const MAX_CALLS = 300

const turns = atom({ plugin: 'recorder', key: 'turns' } as const, [] as RecordedTurn[])
const view = atom({ plugin: 'recorder', key: 'view' } as const, 0)

async function startTurn($: EngineInterface, id: string) {
  const startedAt = await $.clock.now()
  await update($, turns, list => [...list, { id, startedAt, calls: [] }].slice(-MAX_TURNS))
  await update($, view, () => 0)
}

export const register: Register = on => {
  let turnSeq = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'recorder', description: 'Open the tool-call timeline of the last 10 turns', immediate: true })
    return next(e)
  })

  on('command.run', { command: 'recorder' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Recorder' })
    return { text: 'Recorder opened.' }
  })

  on('turn.start', async ($, e, next) => {
    turnSeq += 1
    await startTurn($, e.turnId ?? `turn-${turnSeq}`)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const { target, path } = targetOf(e.tool, e as unknown as Record<string, unknown>)
    const call: RecordedCall = { id: e.tool_use_id, tool: e.tool, target, ...(path === undefined ? {} : { path }), startedAt, isError: false }
    if ((await read($, turns)).length === 0) await startTurn($, `turn-${(turnSeq += 1)}`)
    await update($, turns, list => list.map((t, i) => (i === list.length - 1 ? { ...t, calls: [...t.calls, call].slice(-MAX_CALLS) } : t)))

    const result = await next(e)

    const durationMs = (await $.clock.now()) - startedAt
    const isError = result.deny !== undefined || result.isError === true
    await update($, turns, list => list.map(t => ({ ...t, calls: t.calls.map(c => (c.id === call.id ? { ...c, durationMs, isError } : c)) })))
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const endedAt = await $.clock.now()
    const list = await update($, turns, ts => ts.map((t, i) => (i === ts.length - 1 ? { ...t, endedAt } : t)))
    const last = list[list.length - 1]
    if (last !== undefined) $.ui.toast(toastLine(last.calls, endedAt - last.startedAt))
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, turns)
    const back = Math.min(await read($, view), Math.max(0, list.length - 1))
    const turn = list[list.length - 1 - back]
    const width = e.props.bodyColumns

    const nav = (
      <Box flexDirection="row" gap={1}>
        <Button key="prev" label="◀ Prev" onPress={() => update($, view, v => Math.min(v + 1, list.length - 1))} />
        <Button key="next" label="Next ▶" onPress={() => update($, view, v => Math.max(v - 1, 0))} />
        <Text dimColor>
          {turn === undefined
            ? 'No turns yet'
            : `Turn ${list.length - back} of ${list.length} · ${turn.calls.length} call${turn.calls.length === 1 ? '' : 's'}${turn.endedAt === undefined ? ' · running' : ` · ${seconds(turn.endedAt - turn.startedAt)}`}`}
        </Text>
      </Box>
    )
    if (turn === undefined || turn.calls.length === 0) {
      return (
        <Box flexDirection="column">
          {nav}
          <Text dimColor>No tool calls in this turn.</Text>
        </Box>
      )
    }

    const slowest = Math.max(...turn.calls.map(c => c.durationMs ?? 0))
    const barWidth = Math.max(4, Math.min(20, Math.floor(width * 0.2)))
    const nameWidth = 11
    const targetWidth = Math.max(10, width - nameWidth - barWidth - 22)
    const fill = async (path: string) => {
      const box = await $.prompt.read()
      await $.prompt.fill(box.text === '' ? { text: path, mode: 'replace' } : { text: ` ${path}`, mode: 'append' })
    }

    return (
      <Box flexDirection="column">
        {nav}
        {turn.calls.map(c => {
          const color = COLORS[categoryOf(c.tool)]
          const name = c.tool.startsWith('mcp__') ? 'MCP' : c.tool
          const n = c.durationMs === undefined ? 0 : barLength(c.durationMs, slowest, barWidth)
          return (
            <Box key={`call-${c.id}`} flexDirection="row" gap={1}>
              <Text color={color}>●</Text>
              <Text>{name.padEnd(nameWidth).slice(0, nameWidth)}</Text>
              <Text dimColor={!c.isError} color={c.isError ? '#E5484D' : undefined}>
                {middle(c.target, targetWidth).padEnd(targetWidth)}
              </Text>
              <Text color={color}>{'█'.repeat(n)}</Text>
              <Text dimColor>{c.durationMs === undefined ? 'running' : `${seconds(c.durationMs)}${c.isError ? ' ✕' : ''}`}</Text>
              {c.path === undefined ? null : <Button key={`copy-${c.id}`} label="Copy path" plain onPress={() => fill(c.path as string)} />}
            </Box>
          )
        })}
      </Box>
    )
  })
}
