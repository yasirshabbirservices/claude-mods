import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Decision } from '../types'
import { draftReply, findDecisions } from './decisions'

// When a reply lists decisions D1, D2, ... and asks for approval, a row of
// toggles shows above the prompt (all on). Approve writes the reply into the
// prompt box as a draft; nothing is sent.

const decisions = atom({ plugin: 'decision-picker', key: 'decisions' } as const, [] as Decision[])

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    await update($, decisions, () => [])
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.reason === 'answer') {
      const found = findDecisions(e.answer)
      await update($, decisions, () => found)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, decisions)
    if (list.length === 0 || e.props.hasSurvey || e.props.isWorking) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const toggle = (id: string) => update($, decisions, ds => ds.map(d => (d.id === id ? { ...d, isOn: !d.isOn } : d)))
    const approve = async () => {
      const text = draftReply(await read($, decisions))
      const box = await $.prompt.read()
      await $.prompt.fill(box.text.trim() === '' ? { text, mode: 'replace' } : { text: `\n${text}`, mode: 'append' })
      await update($, decisions, () => [])
    }
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Text dimColor>Decisions</Text>
          {list.map(d => (
            <Button
              key={`toggle-${d.id}`}
              label={`${d.isOn ? '☑' : '☐'} ${d.id}${d.label === '' ? '' : ` ${d.label}`}`}
              onPress={() => toggle(d.id)}
            />
          ))}
          <Button key="approve" label="Approve" variant="primary" hotkey="a" onPress={approve} />
          <Button key="dismiss" label="×" role="dismiss" plain onPress={() => update($, decisions, () => [])} />
        </Box>
        {below}
      </Box>
    )
  })
}
