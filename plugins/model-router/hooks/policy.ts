// The router's decisions, as pure functions: no `$`, no state.

export type Tier = 'mechanical' | 'ordinary' | 'hard'
export type Effort = 'low' | 'medium' | 'high'

export type Decision = {
  tier: Tier
  /** What the classifier said, before the evidence rules moved it. */
  raw: Tier
  confidence: number
  why: string
  /** Why the tier differs from `raw`, when it does. */
  moved?: string
}

export type Options = {
  switch_main_model: boolean
  set_effort: boolean
  cheap_model: string
  strong_model: string
}

export type Step = { model: string; effort?: string | number; agentId?: string }
export type Plan = { model?: string; effort?: Effort; note: string }

export const EFFORT: Record<Tier, Effort> = { mechanical: 'low', ordinary: 'medium', hard: 'high' }

const ORDER: readonly Tier[] = ['mechanical', 'ordinary', 'hard']
const up = (tier: Tier): Tier => ORDER[Math.min(ORDER.indexOf(tier) + 1, 2)] as Tier

/** Below this the classifier's evidence is weak: the tier moves up one. */
export const WEAK = 0.6
/** Moving down to mechanical needs at least this much confidence. */
export const SURE = 0.85

// Words that make a mistake expensive: a prompt holding one is never routed
// to the cheap model.
const RISKY = /\b(prod(uction)?|deploy|release|migrat\w*|drop\s+table|delete|truncate|rm\s+-rf|force[- ]push|security|auth\w*|payment|billing|secret|credential|password|data loss|race condition|concurren\w*|incident|outage)\b/i

export const CLASSIFIER_SYSTEM = [
  'You classify a request a developer sent to their coding assistant, Claude Code, before it starts work.',
  'mechanical: small, local and low-risk: rename, reformat, fix a typo, add an import, run a known command, a short factual question.',
  'ordinary: normal engineering: implement a feature, fix a typical bug, write tests, explain code, refactor one module.',
  'hard: hard or high-stakes: architecture, subtle or concurrent bugs, security, data migrations, production incidents, wide refactors, anything where a mistake is expensive.',
  'Reply with JSON only: {"tier":"mechanical|ordinary|hard","confidence":0.0-1.0,"why":"under 12 words"}.',
  'confidence is how sure you are of the tier. When unsure, say so with a low confidence.',
].join('\n')

/** Reads the classifier's reply and applies the evidence rules. */
export const decide = (reply: string, prompt: string): Decision | undefined => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: { tier?: unknown; confidence?: unknown; why?: unknown }
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return undefined
  }
  const raw = parsed.tier
  if (raw !== 'mechanical' && raw !== 'ordinary' && raw !== 'hard') return undefined
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0
  const why = typeof parsed.why === 'string' ? parsed.why.slice(0, 120) : ''

  let tier: Tier = raw
  let moved: string | undefined
  if (raw === 'mechanical' && confidence < SURE) {
    tier = 'ordinary'
    moved = `not sure enough to move down (${confidence.toFixed(2)} < ${SURE})`
  } else if (raw !== 'hard' && confidence < WEAK) {
    tier = up(raw)
    moved = `weak evidence (${confidence.toFixed(2)} < ${WEAK}), moved up`
  }
  if (tier === 'mechanical' && RISKY.test(prompt)) {
    tier = 'ordinary'
    moved = 'risky words in the prompt, moved up'
  }
  return { tier, raw, confidence, why, ...(moved === undefined ? {} : { moved }) }
}

/** What one request of a routed turn changes: model, effort, and the line logged. */
export const plan = (step: Step, d: Decision, o: Options): Plan => {
  const isMain = step.agentId === undefined
  const target = d.tier === 'mechanical' ? o.cheap_model : d.tier === 'hard' ? o.strong_model : undefined
  const parts: string[] = []
  let model: string | undefined

  if (target === undefined || target === step.model) {
    parts.push(`model ${step.model}`)
  } else if (isMain && !o.switch_main_model) {
    parts.push(`model kept ${step.model} (main-model switching off; would use ${target})`)
  } else {
    model = target
    parts.push(`model ${step.model} → ${target}`)
  }

  let effort: Effort | undefined
  if (!o.set_effort) {
    parts.push('effort unchanged (off)')
  } else if (step.effort === undefined) {
    parts.push('effort n/a for this model')
  } else if (step.effort === EFFORT[d.tier]) {
    parts.push(`effort ${EFFORT[d.tier]}`)
  } else {
    effort = EFFORT[d.tier]
    parts.push(`effort ${String(step.effort)} → ${effort}`)
  }

  const head = `router: ${d.tier}` + (d.raw !== d.tier ? ` (classified ${d.raw}, ${d.moved})` : '') + ` · confidence ${d.confidence.toFixed(2)}`
  const who = isMain ? '' : ` · subagent ${step.agentId}`
  const why = d.why === '' ? '' : ` · ${d.why}`
  return { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }), note: `${head}${who} · ${parts.join(' · ')}${why}` }
}
