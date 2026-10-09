import { atom, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, Register } from 'claude-code'

import type { Suggestions } from '../types'

// Up to three suggested next prompts, drawn as buttons above the prompt box.
// A click, or 1/2/3 in an empty prompt box, drafts one there; nothing is sent.

const items = atom({ plugin: 'next-steps', key: 'items' } as const, [] as Suggestions)

const MIN_ANSWER = 80
const MAX_ITEMS = 3
const MAX_CATALOGUE = 120

const SYSTEM = [
  'You suggest what a developer might type next to their coding assistant, Claude Code.',
  'You are given their last prompt, the assistant\'s answer and the slash commands and skills they have.',
  'Reply with a JSON array of at most 3 short prompts (each under 120 characters), most useful first, nothing else.',
  'Write each as the developer would type it, in the first person, as a concrete follow-up to the answer.',
  'When one of their slash commands or skills fits, one suggestion may be that command, written as /name with any arguments.',
  'Never invent a command that is not listed. Reply [] when no follow-up is obvious.',
].join('\n')

const catalogue = (commands: CommandInfo[]) =>
  [...commands.filter(c => c.source !== 'builtin'), ...commands.filter(c => c.source === 'builtin')]
    .slice(0, MAX_CATALOGUE)
    .map(c => `/${c.name} - ${c.description.slice(0, 90)}`)
    .join('\n')

// Pulls the JSON array out of the reply and keeps what is usable: strings,
// trimmed, deduplicated, and slash commands only when the person has them.
export const parseSuggestions = (reply: string, commandNames: ReadonlySet<string>): string[] => {
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: string[] = []
  for (const raw of parsed) {
    if (typeof raw !== 'string') continue
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (text === '' || out.includes(text)) continue
    if (text.startsWith('/')) {
      const name = text.slice(1).split(' ')[0] ?? ''
      if (!commandNames.has(name)) continue
    }
    out.push(text)
    if (out.length === MAX_ITEMS) break
  }
  return out
}

const shorten = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`

async function suggest($: EngineInterface, prompt: string, answer: string, isCurrent: () => boolean) {
  try {
    const commands = await $.command.list()
    const names = new Set(commands.map(c => c.name))
    const reply = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: [
        `<their_commands_and_skills>\n${catalogue(commands)}\n</their_commands_and_skills>`,
        `<last_prompt>\n${prompt.slice(0, 4000)}\n</last_prompt>`,
        `<answer>\n${answer.slice(-8000)}\n</answer>`,
      ].join('\n\n'),
      maxTokens: 400,
      timeoutMs: 20_000,
    })
    if (!reply.isAnswered || !isCurrent()) return
    const found = parseSuggestions(reply.text, names)
    await update($, items, () => found)
  } catch {
    // A failed suggestion leaves the band empty; the session goes on.
  }
}

export const register: Register = on => {
  let lastPrompt = ''
  let generation = 0

  on('prompt.submit', async ($, e, next) => {
    generation += 1
    lastPrompt = e.text
    await update($, items, () => [])
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    if (e.answer.trim().length < MIN_ANSWER) return result
    const mine = (generation += 1)
    void suggest($, lastPrompt, e.answer, () => mine === generation)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking) return next(e)
    const list = await read($, items)
    if (list.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(12, Math.floor((e.props.bodyColumns - 8) / list.length) - 5)

    const draft = async (text: string) => {
      const box = await $.prompt.read()
      if (box.text.trim() === '') {
        await $.prompt.fill({ text, mode: 'replace' })
      } else {
        await $.prompt.fill({ text: `\n${text}`, mode: 'append' })
      }
      await update($, items, () => [])
    }

    return (
      <Box flexDirection="row" gap={2}>
        <Text dimColor>Next</Text>
        {list.map((text, i) => (
          <Button
            key={`step-${i + 1}`}
            label={shorten(text, width)}
            hotkey={String(i + 1)}
            plain
            onPress={() => draft(text)}
          />
        ))}
        <Button key="dismiss" label="×" role="dismiss" plain onPress={() => update($, items, () => [])} />
      </Box>
    )
  })
}
