import type { EngineInterface, Register } from 'claude-code'

import { copyCommands, isCopied, isExcluded, join, parseExclude, relative } from './paths'

// After Claude edits a file under the source folder, the same file is copied
// to the same relative path under the target folder: one file at a time, never
// a folder sync. Shell commands are covered too: after one, files under the
// source changed while it ran are copied. The status line says what was
// copied and whether a browser has looked since.

type Options = { source_dir: string; target_dir: string; exclude: string }

const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELLS = new Set(['Bash', 'PowerShell'])
const BROWSER = /^mcp__(?:Claude_Browser|claude-in-chrome)__(?:navigate|computer|browser_batch|read_page|get_page_text|javascript_tool|screenshot)/
/** More changed files than this after one command is not a per-file edit: nothing is copied. */
const MAX_FILES = 50

type Sync = { isOn: boolean; copied: string[]; failed: string[]; isChecked: boolean; skipped?: number }

async function copyFile($: EngineInterface, from: string, to: string): Promise<boolean> {
  for (const argv of copyCommands(from, to)) {
    const r = await $.process.run(argv, { timeoutMs: 20_000 })
    if (!isCopied(argv[0] as string, r.exitCode)) return false
  }
  return true
}

// Files under `root` whose modification time is after `since`, by relative path.
async function changedSince($: EngineInterface, root: string, rel: string, since: number, exclude: string[], out: string[]) {
  const entries = await $.fs.list(rel === '' ? root : join(root, rel))
  for (const entry of entries) {
    if (out.length > MAX_FILES) return
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (isExcluded(path, exclude) || entry.isLink) continue
    if (entry.kind === 'dir') await changedSince($, root, path, since, exclude, out)
    else if (entry.kind === 'file' && entry.mtimeMs > since) out.push(path)
  }
}

const statusOf = (s: Sync): string | undefined => {
  if (!s.isOn) return 'local-sync: off'
  if (s.skipped !== undefined) return `local-sync: ${s.skipped}+ files changed at once, none copied`
  if (s.failed.length > 0) return `local-sync: ${s.failed.length} copy failed (${s.failed[s.failed.length - 1]})`
  if (s.copied.length === 0) return undefined
  const n = s.copied.length
  return `local-sync: ${n} file${n === 1 ? '' : 's'} copied · ${s.isChecked ? 'checked in a browser' : 'not checked in a browser yet'}`
}

export const register: Register = (on, options) => {
  const o = options as unknown as Options
  const source = o.source_dir.trim()
  const target = o.target_dir.trim()
  const exclude = parseExclude(o.exclude)
  const isConfigured = source !== '' && target !== ''
  const sync: Sync = { isOn: true, copied: [], failed: [], isChecked: false }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'local-sync', description: 'Show what local-sync copied, or turn it on/off', argumentHint: '[on|off]', immediate: true })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!isConfigured || !sync.isOn) return next(e)
    const startedAt = await $.clock.now()
    const result = await next(e)
    if (result.deny !== undefined || result.isError === true) return result

    if (BROWSER.test(e.tool)) {
      if (sync.copied.length > 0 && !sync.isChecked) {
        sync.isChecked = true
        $.ui.status(statusOf(sync))
      }
      return result
    }

    let rels: string[] = []
    if (EDITS.has(e.tool)) {
      const input = e as unknown as Record<string, unknown>
      const rel = relative(source, String(input.file_path ?? input.notebook_path ?? ''))
      if (rel !== undefined && !isExcluded(rel, exclude)) rels = [rel]
    } else if (SHELLS.has(e.tool)) {
      await changedSince($, source, '', startedAt - 1000, exclude, rels)
    }
    if (rels.length === 0) return result

    if (rels.length > MAX_FILES) {
      sync.skipped = rels.length
      $.ui.status(statusOf(sync))
      return { ...result, context: [...(result.context ?? []), `local-sync: more than ${MAX_FILES} files under the source folder changed during that command, so none were copied to the target folder. Copy the ones that matter by hand.`] }
    }

    const done: string[] = []
    const failed: string[] = []
    for (const rel of rels) {
      if (await copyFile($, join(source, rel), join(target, rel))) done.push(rel)
      else failed.push(rel)
    }
    sync.skipped = undefined
    sync.copied = [...sync.copied.filter(r => !done.includes(r)), ...done]
    sync.failed = failed
    if (done.length > 0) sync.isChecked = false
    $.ui.status(statusOf(sync))

    const notes: string[] = []
    if (done.length > 0) notes.push(`local-sync copied ${done.join(', ')} to the target folder (${target}); no need to copy ${done.length === 1 ? 'it' : 'them'} by hand.`)
    if (failed.length > 0) notes.push(`local-sync could not copy ${failed.join(', ')} to ${target}; copy by hand.`)
    return { ...result, context: [...(result.context ?? []), ...notes] }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'local-sync' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (!isConfigured) return { text: 'local-sync has no folders yet. Set them with: /plugin configure local-sync@yasir-mods (source_dir, target_dir).' }
    if (arg === 'off' || arg === 'on') {
      sync.isOn = arg === 'on'
      $.ui.status(statusOf(sync))
      return { text: `local-sync ${arg}.` }
    }
    const recent = sync.copied.slice(-10)
    return {
      text: [
        `local-sync is ${sync.isOn ? 'on' : 'off'}: ${source} → ${target}`,
        recent.length === 0 ? 'Nothing copied yet this session.' : `Copied this session (${sync.copied.length}): ${recent.join(', ')}`,
        sync.copied.length === 0 ? '' : sync.isChecked ? 'Checked in a browser since the last copy.' : 'Not checked in a browser since the last copy.',
      ].filter(Boolean).join('\n'),
    }
  })
}
