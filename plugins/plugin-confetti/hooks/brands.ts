// Which plugin an MCP tool belongs to, and the logo to draw for it. Logos are
// Simple Icons' own paths and colours (logos.ts); a brand with no logo there,
// and every unknown plugin, gets the neutral plug mark. Pure, no `$`.

import { LOGOS } from './logos'

export type Brand = { id: string; name: string; hex: string; path: string; isKnown: boolean }

// The Simple Icons slug for each brand, and what names it in a server name,
// tool name or tool description. Order matters: specific before general.
export const BRANDS: readonly { slug: string; match: RegExp }[] = [
  { slug: 'zapier', match: /zapier/i },
  { slug: 'gmail', match: /gmail/i },
  { slug: 'googlecalendar', match: /google[\s_-]*calendar|gcal|calendar api/i },
  { slug: 'googledrive', match: /google[\s_-]*drive|drive api/i },
  { slug: 'googlesheets', match: /google[\s_-]*sheets|spreadsheet/i },
  { slug: 'googledocs', match: /google[\s_-]*docs/i },
  { slug: 'slack', match: /slack/i },
  { slug: 'notion', match: /notion/i },
  { slug: 'github', match: /github/i },
  { slug: 'gitlab', match: /gitlab/i },
  { slug: 'linear', match: /\blinear\b/i },
  { slug: 'figma', match: /figma/i },
  { slug: 'canva', match: /canva/i },
  { slug: 'shopify', match: /shopify/i },
  { slug: 'stripe', match: /stripe/i },
  { slug: 'supabase', match: /supabase/i },
  { slug: 'n8n', match: /\bn8n\b/i },
  { slug: 'hubspot', match: /hubspot/i },
  { slug: 'intercom', match: /intercom/i },
  { slug: 'datadog', match: /datadog/i },
  { slug: 'pagerduty', match: /pagerduty/i },
  { slug: 'sentry', match: /sentry/i },
  { slug: 'atlassian', match: /atlassian|confluence/i },
  { slug: 'jira', match: /\bjira\b/i },
  { slug: 'asana', match: /asana/i },
  { slug: 'trello', match: /trello/i },
  { slug: 'airtable', match: /airtable/i },
  { slug: 'discord', match: /discord/i },
  { slug: 'dropbox', match: /dropbox/i },
  { slug: 'calendly', match: /calendly/i },
  { slug: 'caldotcom', match: /cal\.com|\bcalcom\b/i },
  { slug: 'wordpress', match: /wordpress/i },
  { slug: 'hostinger', match: /hostinger/i },
  { slug: 'upwork', match: /upwork/i },
  { slug: 'vercel', match: /vercel/i },
  { slug: 'netlify', match: /netlify/i },
  { slug: 'cloudflare', match: /cloudflare/i },
  { slug: 'prisma', match: /prisma/i },
  { slug: 'postgresql', match: /postgres/i },
  { slug: 'mongodb', match: /mongo/i },
  { slug: 'youtube', match: /youtube/i },
  { slug: 'tiktok', match: /tiktok/i },
  { slug: 'instagram', match: /instagram/i },
  { slug: 'telegram', match: /telegram/i },
  { slug: 'whatsapp', match: /whatsapp/i },
]

// A generic plug, drawn for this mod: no brand's mark.
export const PLUG: Brand = {
  id: 'plug',
  name: 'Plugin',
  hex: '8A8F98',
  path: 'M8 2a1 1 0 0 1 1 1v4h6V3a1 1 0 1 1 2 0v4h1a1 1 0 0 1 1 1v3a7 7 0 0 1-6 6.93V21a1 1 0 1 1-2 0v-3.07A7 7 0 0 1 5 11V8a1 1 0 0 1 1-1h1V3a1 1 0 0 1 1-1z',
  isKnown: false,
}

/** The brand for a slug, or the plug when the logo is not in Simple Icons. */
export const brandFor = (slug: string): Brand => {
  const logo = LOGOS[slug]
  return logo === undefined ? PLUG : { id: slug, name: logo.title, hex: logo.hex, path: logo.path, isKnown: true }
}

/** The server part of `mcp__<server>__<tool>`; undefined for other tools. */
export const serverOf = (tool: string): string | undefined => {
  if (!tool.startsWith('mcp__')) return undefined
  const rest = tool.slice(5)
  const end = rest.indexOf('__')
  return end < 0 ? rest : rest.slice(0, end)
}

/** Matches the server name first, then the tool's description. */
export const identify = (tool: string, description = ''): string | undefined => {
  const server = serverOf(tool) ?? ''
  for (const text of [server.replace(/[_-]+/g, ' '), `${tool} ${description}`]) {
    const hit = BRANDS.find(b => b.match.test(text))
    if (hit !== undefined) return hit.slug
  }
  return undefined
}

/** A brand from what the person typed after /confetti. */
export const lookup = (query: string): string | undefined => {
  const q = query.trim().toLowerCase().replace(/[\s_.-]+/g, '')
  if (q === '') return undefined
  const exact = BRANDS.find(b => b.slug === q || (LOGOS[b.slug]?.title ?? '').toLowerCase().replace(/[\s_.-]+/g, '') === q)
  return exact?.slug ?? BRANDS.find(b => b.match.test(query))?.slug
}
