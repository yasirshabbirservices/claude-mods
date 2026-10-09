// Draws an SVG path (a 24×24 Simple Icons path) as terminal cells: each cell
// is two pixels stacked, painted with half blocks. Pure functions, no `$`.

type Point = [number, number]

const tokenize = (d: string): (string | number)[] => {
  const out: (string | number)[] = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
  for (const m of d.matchAll(re)) out.push(m[1] !== undefined ? m[1] : Number(m[2]))
  return out
}

// Endpoint arc to line segments (SVG spec F.6.5).
const arc = (from: Point, rx: number, ry: number, rot: number, large: number, sweep: number, to: Point): Point[] => {
  if (rx === 0 || ry === 0) return [to]
  const phi = (rot * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from[0] - to[0]) / 2
  const dy = (from[1] - to[1]) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cx1 = (co * rx * y1) / ry
  const cy1 = (-co * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)))
  const pts: Point[] = []
  for (let i = 1; i <= n; i += 1) {
    const t = t1 + (dt * i) / n
    const px = rx * Math.cos(t)
    const py = ry * Math.sin(t)
    pts.push([cos * px - sin * py + cx, sin * px + cos * py + cy])
  }
  return pts
}

const bezier = (p0: Point, p1: Point, p2: Point, p3: Point): Point[] => {
  const pts: Point[] = []
  for (let i = 1; i <= 12; i += 1) {
    const t = i / 12
    const u = 1 - t
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return pts
}

/** The path's outlines as closed polygons. */
export const flatten = (d: string): Point[][] => {
  const tokens = tokenize(d)
  const polys: Point[][] = []
  let poly: Point[] = []
  let cur: Point = [0, 0]
  let start: Point = [0, 0]
  let lastCtrl: Point | null = null
  let lastQuad: Point | null = null
  let cmd = ''
  let i = 0
  const num = () => {
    const v = tokens[i]
    i += 1
    return typeof v === 'number' ? v : 0
  }
  const close = () => {
    if (poly.length > 1) polys.push(poly)
    poly = []
  }
  while (i < tokens.length) {
    const t = tokens[i]
    if (typeof t === 'string') {
      cmd = t
      i += 1
      if (cmd === 'Z' || cmd === 'z') {
        close()
        cur = start
        lastCtrl = lastQuad = null
        continue
      }
    } else if (cmd === '') {
      i += 1
      continue
    }
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? cur[0] : 0
    const oy = rel ? cur[1] : 0
    switch (cmd.toUpperCase()) {
      case 'M': {
        close()
        cur = [ox + num(), oy + num()]
        start = cur
        poly = [cur]
        cmd = rel ? 'l' : 'L'
        lastCtrl = lastQuad = null
        break
      }
      case 'L':
        cur = [ox + num(), oy + num()]
        poly.push(cur)
        lastCtrl = lastQuad = null
        break
      case 'H':
        cur = [ox + num(), cur[1]]
        poly.push(cur)
        lastCtrl = lastQuad = null
        break
      case 'V':
        cur = [cur[0], oy + num()]
        poly.push(cur)
        lastCtrl = lastQuad = null
        break
      case 'C': {
        const c1: Point = [ox + num(), oy + num()]
        const c2: Point = [ox + num(), oy + num()]
        const end: Point = [ox + num(), oy + num()]
        poly.push(...bezier(cur, c1, c2, end))
        lastCtrl = c2
        lastQuad = null
        cur = end
        break
      }
      case 'S': {
        const c1: Point = lastCtrl === null ? cur : [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]]
        const c2: Point = [ox + num(), oy + num()]
        const end: Point = [ox + num(), oy + num()]
        poly.push(...bezier(cur, c1, c2, end))
        lastCtrl = c2
        lastQuad = null
        cur = end
        break
      }
      case 'Q':
      case 'T': {
        const q: Point =
          cmd.toUpperCase() === 'Q'
            ? [ox + num(), oy + num()]
            : lastQuad === null
              ? cur
              : [2 * cur[0] - lastQuad[0], 2 * cur[1] - lastQuad[1]]
        const end: Point = [ox + num(), oy + num()]
        const c1: Point = [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])]
        const c2: Point = [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])]
        poly.push(...bezier(cur, c1, c2, end))
        lastQuad = q
        lastCtrl = null
        cur = end
        break
      }
      case 'A': {
        const rx = num()
        const ry = num()
        const rot = num()
        const large = num()
        const sweep = num()
        const end: Point = [ox + num(), oy + num()]
        poly.push(...arc(cur, rx, ry, rot, large, sweep, end))
        lastCtrl = lastQuad = null
        cur = end
        break
      }
      default:
        i += 1
    }
  }
  close()
  return polys
}

// Nonzero winding number of a point against the polygons.
const winding = (polys: Point[][], x: number, y: number): number => {
  let w = 0
  for (const poly of polys) {
    for (let j = 0; j < poly.length; j += 1) {
      const a = poly[j] as Point
      const b = poly[(j + 1) % poly.length] as Point
      if (a[1] <= y) {
        if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0) w += 1
      } else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0) {
        w -= 1
      }
    }
  }
  return w
}

/** Pixels on or off, `size`×`size`, from a 24-unit path, 3×3 samples each. */
export const pixels = (d: string, size: number): boolean[][] => {
  const polys = flatten(d)
  const scale = 24 / size
  const grid: boolean[][] = []
  for (let py = 0; py < size; py += 1) {
    const row: boolean[] = []
    for (let px = 0; px < size; px += 1) {
      let hits = 0
      for (let sy = 0; sy < 3; sy += 1) {
        for (let sx = 0; sx < 3; sx += 1) {
          if (winding(polys, (px + (sx + 0.5) / 3) * scale, (py + (sy + 0.5) / 3) * scale) !== 0) hits += 1
        }
      }
      row.push(hits >= 4)
    }
    grid.push(row)
  }
  return grid
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

/** Packs cells `[codePoint, fg, bg]` into a Raster's `cells`. */
export const pack = (cells: [number, number, number][]): string => {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach((cell, i) => words.set(cell, i * 3))
  return base64(new Uint8Array(words.buffer))
}

/** The logo as `columns` × `columns / 2` cells on a light badge. */
export const logoCells = (d: string, color: number, columns: number, badge = 0xf4f4f4): [number, number, number][] => {
  const grid = pixels(d, columns)
  const cells: [number, number, number][] = []
  for (let r = 0; r < columns; r += 2) {
    for (let c = 0; c < columns; c += 1) {
      const top = grid[r]?.[c] === true
      const bottom = grid[r + 1]?.[c] === true
      if (top && bottom) cells.push([0x2588, color, badge])
      else if (top) cells.push([0x2580, color, badge])
      else if (bottom) cells.push([0x2584, color, badge])
      else cells.push([0x20, color, badge])
    }
  }
  return cells
}
