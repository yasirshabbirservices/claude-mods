import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentDef, AgentRun } from '../types'

const agents = atom({ plugin: 'agents-panel', key: 'agents' } as const, [] as AgentDef[])
const runs = atom({ plugin: 'agents-panel', key: 'runs' } as const, {} as Record<string, AgentRun>)
const task = atom({ plugin: 'agents-panel', key: 'task' } as const, '')

const PANE = 'agents-panel'
const DIR = '.claude/agents'
const PALETTE = ['#6b8fd6', '#5fb3b3', '#e3b95c', '#e07a52', '#b48ead', '#e06c75', '#8cc265', '#7fb8e6']
const NAMED: Record<string, string> = {
  red: '#e06c75', blue: '#6b8fd6', green: '#8cc265', yellow: '#e3b95c',
  purple: '#b48ead', orange: '#e07a52', pink: '#e88fb5', cyan: '#5fb3b3',
}
const DEFAULT_TASK = 'Do your job on this project now, then report what you found or changed.'

// Module state: reset on a hot reload, which only stops the running clock.
let ticker: Timer | undefined

const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const label = (name: string) => `${name} (agents panel)`

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\\n/g, ' ')

// Reads an agent file's frontmatter: name, description, model, color.
const parse = (file: string, text: string): AgentDef | undefined => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return undefined
  const fields: Record<string, string> = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (kv) fields[kv[1]!.toLowerCase()] = unquote(kv[2]!)
  }
  return {
    name: fields.name || file.replace(/\.md$/, ''),
    description: fields.description || '',
    model: fields.model || 'inherit',
    color: fields.color,
  }
}

async function load($: EngineInterface) {
  const found: AgentDef[] = []
  if (await $.fs.exists(DIR)) {
    for (const entry of await $.fs.list(DIR)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
      const def = parse(entry.name, await $.fs.read(`${DIR}/${entry.name}`))
      if (def) found.push(def)
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name))
  await update($, agents, () => found)
}

// A one-second tick keeps the running timers moving while any agent runs.
async function tick($: EngineInterface) {
  const isRunning = Object.values(await read($, runs)).some(r => r.status === 'running')
  if (isRunning && ticker === undefined) {
    ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  } else if (!isRunning && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}

async function run($: EngineInterface, name: string) {
  const asked = (await read($, task)).trim()
  const spawned = await $.agent.spawn({
    subagentType: name,
    description: label(name),
    prompt: asked || DEFAULT_TASK,
  })
  if (spawned.deny !== undefined) {
    $.ui.toast(`${name} did not start: ${spawned.deny}`)
    return
  }
  // No id means it is matched by its description when it finishes.
  const started: AgentRun = { agentId: spawned.agentId ?? '', startedAt: await $.clock.now(), status: 'running' }
  await update($, runs, all => ({ ...all, [name]: started }))
  await tick($)
}

async function open($: EngineInterface) {
  await load($)
  await $.ui.open({ id: PANE, title: 'Agents' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agents-panel',
      description: 'Show or hide the panel of project agents (.claude/agents)',
    })

    return next(e)
  })

  on('command.run', { command: 'agents-panel' }, async $ => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Agents panel closed.' }
    }
    await open($)

    return { text: 'Agents panel open.' }
  })

  // A run ends with its agent's last turn: keep the answer and say so.
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) return ran

    const all = await read($, runs)
    let name = Object.keys(all).find(n => all[n]!.agentId === e.agentId)
    if (name === undefined) {
      const info = (await $.agent.list()).find(a => a.id === e.agentId)
      name = Object.keys(all).find(n => all[n]!.status === 'running' && info?.description === label(n))
    }
    if (name === undefined) return ran

    const endedAt = await $.clock.now()
    const isFailed = e.reason !== 'answer'
    const ended: AgentRun = { ...all[name]!, status: isFailed ? 'failed' : 'done', endedAt, answer: e.answer }
    await update($, runs, cur => ({ ...cur, [name]: ended }))
    $.ui.toast(`${name} ${isFailed ? 'stopped' : 'finished'} · ${duration(endedAt - all[name]!.startedAt)}`)
    await tick($)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Input = 'Input' in els ? els.Input : undefined
    const asked = await read($, task)
    const list = await read($, agents)
    const all = await read($, runs)
    const now = await $.clock.now()
    const running = Object.values(all).filter(r => r.status === 'running').length

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color="#e3b95c">◆ </Text>
            <Text bold>Agents</Text>
            <Text dimColor> in this project</Text>
          </Text>
          <Text dimColor>{running > 0 ? `◌ ${running} running` : ''}</Text>
        </Box>
        <Text>
          <Text color="#6b8fd6" bold>PROJECT </Text>
          <Text dimColor>{`${DIR} · ${list.length}`}</Text>
        </Text>
        <Text> </Text>

        {list.length === 0 && (
          <Text dimColor>
            No agents in {DIR}. Ask Claude to create one, e.g. "make a code-reviewer agent".
          </Text>
        )}

        {list.map((a, i) => {
          const r = all[a.name]
          const dot = (a.color && (NAMED[a.color.toLowerCase()] ?? a.color)) || PALETTE[i % PALETTE.length]!
          const firstLine = r?.answer?.split('\n').find(l => l.trim() !== '')?.trim()

          return (
            <Box flexDirection="column" marginBottom={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text>
                  <Text color={dot}>● </Text>
                  <Text bold>{a.name}</Text>
                  <Text dimColor>{` ${a.model}`}</Text>
                </Text>
                {r?.status === 'running' ? (
                  <Text color="#7fb8e6">{`◌ running · ${duration(now - r.startedAt)}`}</Text>
                ) : (
                  <Box flexDirection="row">
                    {r?.endedAt !== undefined && (
                      <Text color={r.status === 'failed' ? 'red' : 'green'}>
                        {`${r.status === 'failed' ? '✘' : '✔'} ${duration(r.endedAt - r.startedAt)}  `}
                      </Text>
                    )}
                    <Button key={`run-${a.name}`} label="▶ run" onPress={() => run($, a.name)} />
                  </Box>
                )}
              </Box>
              <Text dimColor wrap="truncate-end">{`  ${a.description}`}</Text>
              {firstLine !== undefined && (
                <Box flexDirection="row">
                  <Text wrap="truncate-end">{`  ↳ ${firstLine}  `}</Text>
                  <Button
                    key={`insert-${a.name}`}
                    label="insert"
                    onPress={() =>
                      $.prompt.fill({ text: `Here is what the ${a.name} agent reported:\n\n${r!.answer}\n\n`, mode: 'insert' })
                    }
                  />
                </Box>
              )}
            </Box>
          )
        })}

        {Input !== undefined && (
          <Input
            key="task"
            label="Task for the next run"
            placeholder={DEFAULT_TASK}
            value={asked}
            submitLabel="set"
            onInput={(text: string) => void update($, task, () => text)}
            onSubmit={(text: string) => void update($, task, () => text)}
          />
        )}
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>click ▶ run to start one · /agents-panel to hide</Text>
          <Button key="reload" label="reload" onPress={() => load($)} />
        </Box>
      </Box>
    )
  })
}
