import type { Register } from 'claude-code'

import { CLASSIFIER_SYSTEM, decide, plan } from './policy'
import type { Decision, Options } from './policy'

// Before each turn the prompt is classified as mechanical, ordinary or hard;
// every request of that turn is then sent with the model and effort the tier
// calls for, and the decision is logged in the transcript. Any failure sends
// the request as it was.

type Config = Options & { classifier_model: string }

export const register: Register = (on, options) => {
  const config = options as unknown as Config
  // The main conversation's decision for the turn running now; each subagent
  // keeps the decision of the turn that started it, so its model never
  // changes mid-run.
  let current: Decision | undefined
  let loggedTurn = ''
  const subagents = new Map<string, Decision | undefined>()
  const loggedAgents = new Set<string>()

  on('turn.start', async ($, e, next) => {
    current = undefined
    try {
      const reply = await $.model.complete({
        model: config.classifier_model,
        system: CLASSIFIER_SYSTEM,
        prompt: `<request>\n${e.text.slice(0, 4000)}\n</request>`,
        maxTokens: 120,
        timeoutMs: 6000,
      })
      if (!reply.isAnswered) {
        $.ui.log(`router: classifier ${reply.reason}; requests sent unchanged`)
      } else {
        current = decide(reply.text, e.text)
        if (current === undefined) $.ui.log('router: could not read the classification; requests sent unchanged')
      }
    } catch {
      current = undefined
      $.ui.log('router: classifier failed; requests sent unchanged')
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let decision = current
    if (e.agentId !== undefined) {
      if (!subagents.has(e.agentId)) subagents.set(e.agentId, current)
      decision = subagents.get(e.agentId)
    }
    if (decision === undefined) return yield* next(e)

    const step = plan(e, decision, config)
    const logKey = e.agentId ?? e.turnId
    const isLogged = e.agentId === undefined ? loggedTurn === logKey : loggedAgents.has(logKey)
    if (!isLogged) {
      if (e.agentId === undefined) loggedTurn = logKey
      else loggedAgents.add(logKey)
      $.ui.log(step.note)
    }

    if (step.model === undefined && step.effort === undefined) return yield* next(e)
    return yield* next({
      ...e,
      ...(step.model === undefined ? {} : { model: step.model }),
      ...(step.effort === undefined ? {} : { effort: step.effort }),
    })
  }).catch(async function* ($, e, next) {
    // The hook failed before the request went out: send it as it was.
    return yield* next(e)
  })
}
