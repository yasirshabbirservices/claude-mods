// The burst itself: an animated SVG card for the desktop app, and frames of
// falling confetti cells for the terminal. Pure, no `$`.

import type { Brand } from './brands'
import { pack } from './raster'

export const COLORS = ['F59E0B', '10B981', '3B82F6', 'EC4899', '8B5CF6', 'EF4444']
export const FRAMES = 18

// A small seeded generator, so a burst draws the same on every redraw.
const random = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** The desktop card: the logo on a white badge, its name, and a burst. */
export const svgCard = (brand: Brand, seed: number): string => {
  const rnd = random(seed)
  const palette = [brand.hex, ...COLORS]
  const bits: string[] = []
  for (let i = 0; i < 28; i += 1) {
    const angle = rnd() * Math.PI * 2
    const dist = 40 + rnd() * 150
    const x = Math.round(36 + Math.cos(angle) * dist * 1.6)
    const y = Math.round(36 + Math.sin(angle) * dist * 0.35)
    const color = palette[Math.floor(rnd() * palette.length)]
    const spin = Math.round(rnd() * 720 - 360)
    const dur = (0.9 + rnd() * 0.6).toFixed(2)
    const shape = rnd() < 0.5 ? '<rect x="-3" y="-1.5" width="6" height="3" rx="1"' : '<circle r="2.2"'
    bits.push(
      `<g><animateTransform attributeName="transform" type="translate" from="36 36" to="${x} ${y}" dur="${dur}s" fill="freeze"/>` +
        `${shape} fill="#${color}"><animateTransform attributeName="transform" type="rotate" from="0" to="${spin}" dur="${dur}s" fill="freeze"/>` +
        `<animate attributeName="opacity" values="1;1;0" dur="1.6s" fill="freeze"/></${shape.startsWith('<rect') ? 'rect' : 'circle'}></g>`,
    )
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="72" viewBox="0 0 360 72">` +
    bits.join('') +
    `<rect x="10" y="10" width="52" height="52" rx="12" fill="#ffffff" stroke="#00000022"/>` +
    `<g transform="translate(18 18) scale(1.5)"><path d="${escape(brand.path)}" fill="#${brand.hex}"/></g>` +
    `<text x="76" y="33" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="15" font-weight="600" fill="#8A8F98">${escape(brand.name)}</text>` +
    `<text x="76" y="52" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="12" fill="#8A8F98">finished ✓</text>` +
    `</svg>`
  )
}

const GLYPHS = [0x2022, 0x2a, 0x2b, 0xb7, 0x25aa, 0xb0]
const DEFAULT = 0x01000000

/** One frame of confetti falling through `rows` × `columns` cells. */
export const confettiCells = (frame: number, seed: number, hex: string, columns = 36, rows = 3): string => {
  const rnd = random(seed)
  const palette = [hex, ...COLORS].map(c => parseInt(c, 16))
  const cells: [number, number, number][] = Array.from({ length: columns * rows }, () => [0x20, DEFAULT, DEFAULT])
  if (frame < FRAMES) {
    for (let i = 0; i < 22; i += 1) {
      const x0 = rnd() * columns
      const drift = rnd() * 1.2 - 0.6
      const speed = 0.15 + rnd() * 0.25
      const delay = rnd() * 6
      const glyph = GLYPHS[Math.floor(rnd() * GLYPHS.length)] as number
      const color = palette[Math.floor(rnd() * palette.length)] as number
      const t = frame - delay
      if (t < 0) continue
      const x = Math.round(x0 + drift * t)
      const y = Math.floor(t * speed)
      if (x < 0 || x >= columns || y >= rows) continue
      cells[y * columns + x] = [glyph, color, DEFAULT]
    }
  }
  return pack(cells)
}
