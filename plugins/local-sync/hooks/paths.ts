// Path rules for local-sync. Pure functions, no `$`.

const isWindowsPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

/** Forward slashes, no trailing slash; lower case on Windows, where case does not matter. */
export const norm = (p: string): string => {
  const s = p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return isWindowsPath(p) ? s.toLowerCase() : s
}

export const isWindows = (p: string) => isWindowsPath(p)

/** The path of `file` inside `root` ('a/b.css'), or undefined when it lies outside. */
export const relative = (root: string, file: string): string | undefined => {
  const r = norm(root)
  const f = file.trim().replace(/\\/g, '/')
  const fn = norm(file)
  if (r === '' || !fn.startsWith(`${r}/`)) return undefined
  const rel = f.slice(r.length + 1)
  return rel.split('/').some(part => part === '..') ? undefined : rel
}

export const parseExclude = (text: string): string[] =>
  text
    .split(',')
    .map(s => s.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(s => s !== '')

/** Whether a relative path is one the person asked never to copy. */
export const isExcluded = (rel: string, exclude: readonly string[]): boolean => {
  const parts = rel.split('/')
  return exclude.some(x => (x.includes('/') ? rel === x || rel.startsWith(`${x}/`) : parts.includes(x)))
}

/** Joins with the separator the root uses. */
export const join = (root: string, rel: string): string => {
  const sep = isWindowsPath(root) ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + sep + rel.split('/').join(sep)
}

/** The host commands that copy one file, creating its folder. */
export const copyCommands = (from: string, to: string): string[][] => {
  if (isWindows(to)) {
    const cut = (p: string) => {
      const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
      return [p.slice(0, i), p.slice(i + 1)]
    }
    const [fromDir, name] = cut(from)
    const [toDir] = cut(to)
    // robocopy makes the folder, copies the one file, and exits below 8 on success.
    return [['robocopy', fromDir as string, toDir as string, name as string, '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']]
  }
  const dir = to.slice(0, to.lastIndexOf('/'))
  return [['mkdir', '-p', dir], ['cp', '-p', from, to]]
}

/** Whether a copy command's exit code means it worked (robocopy uses 0–7 for success). */
export const isCopied = (argv0: string, exitCode: number) => (argv0 === 'robocopy' ? exitCode < 8 : exitCode === 0)
