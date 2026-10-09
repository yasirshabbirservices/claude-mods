// Finds secrets in text and masks them. Pure functions: no `$`, no state.

export type Secret = { label: string; value: string }
export type Masked<T> = { value: T; secrets: Secret[] }

export const MASK = '••••••••'

type Rule = { label: string; pattern: RegExp; group?: number }

const NAMED = 'SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|CLIENT[_-]?SECRET'

const RULES: readonly Rule[] = [
  { label: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { label: 'API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { label: 'Stripe key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { label: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { label: 'GitHub token', pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { label: 'AWS key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { label: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { label: 'Google key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { label: 'bearer token', pattern: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/g, group: 1 },
  { label: 'URL password', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{3,})@/gi, group: 1 },
  {
    label: 'secret value',
    pattern: new RegExp(`\\b[A-Za-z0-9_.-]*(?:${NAMED})[A-Za-z0-9_.-]*["']?\\s*[:=]\\s*["']?([^\\s"'\`,;]{6,})`, 'gi'),
    group: 1,
  },
]

// A value that names a secret rather than holding one: `$TOKEN`, `${KEY}`,
// `<your-key>`, `process.env.KEY`.
const isReference = (value: string) => /^(?:\$|<|\{|process\.env|os\.environ|env\.)/.test(value)

type Span = { start: number; end: number; label: string }

export const findSpans = (text: string): Span[] => {
  const spans: Span[] = []
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    for (const m of text.matchAll(rule.pattern)) {
      const value = rule.group === undefined ? m[0] : m[rule.group]
      if (value === undefined || m.index === undefined || isReference(value)) continue
      const start = rule.group === undefined ? m.index : m.index + m[0].lastIndexOf(value)
      spans.push({ start, end: start + value.length, label: rule.label })
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Span[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.start < last.end) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

export const maskText = (text: string): Masked<string> => {
  const spans = findSpans(text)
  if (spans.length === 0) return { value: text, secrets: [] }
  let out = ''
  let at = 0
  const secrets: Secret[] = []
  for (const span of spans) {
    out += text.slice(at, span.start) + MASK
    secrets.push({ label: span.label, value: text.slice(span.start, span.end) })
    at = span.end
  }
  return { value: out + text.slice(at), secrets }
}

// Masks every string inside a value (a tool's input or result), keeping its
// shape so the engine's own row still reads it.
export const maskDeep = (value: unknown): Masked<unknown> => {
  if (typeof value === 'string') return maskText(value)
  if (Array.isArray(value)) {
    const parts = value.map(maskDeep)
    return { value: parts.map(p => p.value), secrets: parts.flatMap(p => p.secrets) }
  }
  if (value !== null && typeof value === 'object') {
    const secrets: Secret[] = []
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      const part = maskDeep(inner)
      out[key] = part.value
      secrets.push(...part.secrets)
    }
    return { value: out, secrets }
  }
  return { value, secrets: [] }
}

export const unique = (secrets: Secret[]): Secret[] => {
  const seen = new Set<string>()
  return secrets.filter(s => (seen.has(s.value) ? false : (seen.add(s.value), true)))
}

// The text a tool result shows: Bash's streams, a read file's content, or
// every string in the result.
export const resultText = (output: unknown): string => {
  if (typeof output === 'string') return output
  if (output !== null && typeof output === 'object') {
    const o = output as Record<string, unknown>
    if (typeof o.stdout === 'string' || typeof o.stderr === 'string') {
      return [o.stdout, o.stderr].filter(s => typeof s === 'string' && s !== '').join('\n')
    }
    const file = o.file as Record<string, unknown> | undefined
    if (file !== undefined && typeof file.content === 'string') return file.content
  }
  const strings: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') strings.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(output)
  return strings.join('\n')
}
