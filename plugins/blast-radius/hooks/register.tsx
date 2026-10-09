import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Held, Report } from '../types'

const PANE = 'blast-radius'
const MAX_FILES = 5000
const held = atom({ plugin: 'blast-radius', key: 'held' } as const, null as Held | null)

export type Kind = 'rm' | 'reset' | 'clean' | 'push'

// Splits a shell line into its commands at && || ; | and newlines.
export function segments(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/).map(s => s.trim()).filter(Boolean)
}

function words(s: string): string[] {
  return (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^(['"])(.*)\1$/, '$2')).filter(w => w !== 'sudo')
}

// Which risky command a segment is, if any.
export function classify(segment: string): Kind | undefined {
  const w = words(segment)
  if (w[0] === 'rm' && w.some(x => /^-[a-zA-Z]*[rR]/.test(x) || x === '--recursive')) return 'rm'
  if (w[0] !== 'git') return undefined
  const flags = w.slice(1)
  const sub = flags.find(x => !x.startsWith('-'))
  if (sub === 'reset' && flags.includes('--hard')) return 'reset'
  if (sub === 'clean') return 'clean'
  if (sub === 'push' && flags.some(x => x.startsWith('--force') || /^-[a-zA-Z]*f/.test(x) || x.startsWith('+'))) return 'push'
  return undefined
}

async function sh($: EngineInterface, argv: string[]): Promise<string[]> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 15_000 })
    return r.exitCode === 0 ? r.stdout.split(/\r?\n/).filter(l => l.trim() !== '') : []
  } catch {
    return []
  }
}

async function walk($: EngineInterface, path: string, out: string[]) {
  if (out.length >= MAX_FILES || !(await $.fs.exists(path))) return
  const stat = await $.fs.stat(path)
  if (stat.kind !== 'dir') {
    out.push(path)
    return
  }
  for (const entry of await $.fs.list(path)) {
    if (entry.kind === 'dir') await walk($, `${path}/${entry.name}`, out)
    else out.push(`${path}/${entry.name}`)
    if (out.length >= MAX_FILES) return
  }
}

async function measure($: EngineInterface, segment: string, kind: Kind): Promise<Report> {
  const w = words(segment)
  const at = w.indexOf(kind === 'rm' ? 'rm' : kind)
  const args = w.slice(at + 1).filter(x => !x.startsWith('-'))

  if (kind === 'rm') {
    const files: string[] = []
    for (const target of args) await walk($, target.replace(/\/+$/, ''), files)
    const note = files.length >= MAX_FILES ? `stopped counting at ${MAX_FILES}` : undefined
    return { segment, unit: 'files', count: files.length, items: files, note }
  }

  if (kind === 'reset') {
    const ref = args[0] ?? 'HEAD'
    const files = await sh($, ['git', 'diff', '--name-only', ref])
    const commits = ref === 'HEAD' ? [] : await sh($, ['git', 'log', '--oneline', `${ref}..HEAD`])
    return {
      segment,
      unit: commits.length > 0 ? 'files and commits' : 'files',
      count: files.length + commits.length,
      items: [...commits.map(c => `commit dropped: ${c}`), ...files.map(f => `changes lost: ${f}`)],
    }
  }

  if (kind === 'clean') {
    const flags = w.filter(x => /^-[a-zA-Z]+$/.test(x)).join('')
    const dry = ['-n', ...(flags.includes('d') ? ['-d'] : []), ...(flags.includes('x') ? ['-x'] : []), ...(flags.includes('X') ? ['-X'] : [])]
    const files = (await sh($, ['git', 'clean', ...dry])).map(l => l.replace(/^Would remove /, ''))
    return { segment, unit: 'files', count: files.length, items: files }
  }

  // push --force: the remote's commits that HEAD lacks are overwritten.
  const target = args.length >= 3 ? `${args[1]}/${args[2]!.replace(/^\+/, '').split(':').pop()}` : '@{u}'
  const lost = await sh($, ['git', 'log', '--oneline', `HEAD..${target}`])
  return {
    segment,
    unit: 'remote commits',
    count: lost.length,
    items: lost.map(c => `overwritten on ${target}: ${c}`),
    note: 'as of the last fetch',
  }
}

// Waits a quarter second inside a $ call, which the hook's budget does not count.
async function pause($: EngineInterface) {
  try {
    await $.process.run(['sleep', '0.25'], { timeoutMs: 5000 })
  } catch {
    await $.process.run(['powershell', '-NoProfile', '-Command', 'Start-Sleep -Milliseconds 250'], { timeoutMs: 5000 })
  }
}

// The press reaches the held call through this variable: a hook's own reads of
// $.state hold still for its whole dispatch, so the loop could not see it there.
let pressed: 'proceed' | 'cancel' | null = null

async function decide($: EngineInterface, decision: 'proceed' | 'cancel') {
  pressed = decision
  await update($, held, v => (v === null ? v : { ...v, decision }))
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const risky = segments(e.command).flatMap(s => {
      const kind = classify(s)
      return kind === undefined ? [] : [{ s, kind }]
    })
    if (risky.length === 0) return next(e)

    const reports: Report[] = []
    for (const { s, kind } of risky) reports.push(await measure($, s, kind))
    pressed = null
    await update($, held, () => ({ command: e.command, reports, decision: null }))
    await $.ui.open({ id: PANE, title: 'Blast Radius', focus: true, closeOnEscape: true })

    let decision: Held['decision'] = null
    while (decision === null && !next.signal.aborted) {
      await pause($)
      decision = pressed
    }
    await update($, held, () => null)
    await $.ui.close({ id: PANE })

    if (decision === 'proceed') return next(e)
    const total = reports.map(r => `${r.count} ${r.unit}`).join(', ')
    return {
      deny: `Blast Radius: the user pressed Cancel on \`${e.command}\`, which would affect ${total}. Do not retry it or work around it; ask the user how they want to proceed.`,
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'Blast Radius could not check this command, so it was held back.' }))

  // Esc or closing the pane counts as Cancel.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin === 'person') await decide($, 'cancel')
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const cur = await read($, held)
    if (cur === null) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Nothing held.</Text>
    }
    return draw($, e, cur, e.viewport?.rows ?? 24)
  })

  // Where the pane cannot be placed (a narrow terminal), the band shows it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cur = await read($, held)
    if (cur === null || e.props.hasSurvey) return next(e)
    const isPaneShown = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
    return isPaneShown ? next(e) : draw($, e, cur, e.props.maxRows)
  })
}

function draw($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], cur: Held, rows: number) {
  {
    const { Box, Button, Text } = $.ui.resolve(e)
    const per = Math.max(1, Math.floor((rows - 6 - cur.reports.length * 2) / cur.reports.length))

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="red" bold>⚠ Held: </Text>
          <Text>{cur.command}</Text>
        </Text>
        {cur.reports.map(r => (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>{r.segment}</Text>
              <Text color="yellow">{`  ${r.count} ${r.unit}`}</Text>
              {r.note !== undefined && <Text dimColor>{`  (${r.note})`}</Text>}
            </Text>
            {r.count === 0 && <Text dimColor>  nothing found to change</Text>}
            {r.items.slice(0, per).map(item => (
              <Text dimColor wrap="truncate-end">{`  ${item}`}</Text>
            ))}
            {r.items.length > per && <Text dimColor>{`  … and ${r.items.length - per} more`}</Text>}
          </Box>
        ))}
        <Box flexDirection="row" marginTop={1}>
          <Button key="cancel" label="Cancel" hotkey="1" autoFocus onPress={() => decide($, 'cancel')} />
          <Text> </Text>
          <Button key="proceed" label="Proceed" hotkey="2" variant="secondary" onPress={() => decide($, 'proceed')} />
          <Text dimColor>   Esc cancels</Text>
        </Box>
      </Box>
    )
  }
}
