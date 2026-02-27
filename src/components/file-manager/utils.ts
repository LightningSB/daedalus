export type SortKey = 'name' | 'size' | 'mtime'
export type SortDir = 'asc' | 'desc'

export type FileEntry = {
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  mtimeMs: number
  mode: number
}

export type FileStat = {
  path: string
  resolvedPath?: string
  type: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  mtimeMs: number
  mode: number
  isSymlink: boolean
  target?: string
}

export type PreviewData = {
  path: string
  size: number
  offset: number
  limit: number
  bytesRead: number
  truncated: boolean
  kind: 'text' | 'binary'
  encoding?: 'utf-8'
  data?: string
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return '-'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let current = value
  let unit = units[0]
  for (let index = 0; index < units.length; index += 1) {
    const next = current / 1024
    unit = units[index]
    if (next < 1) break
    current = next
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${unit}`
}

export function formatDate(ms: number): string {
  if (!ms) return '-'
  try {
    const date = new Date(ms)
    return date.toLocaleString()
  } catch {
    return '-'
  }
}

export function normalizePath(input: string): string {
  const trimmed = input.trim() || '.'
  const sanitized = trimmed.replace(/\\/g, '/')
  if (sanitized.startsWith('~')) return sanitized
  const parts = sanitized.split('/').filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  const prefix = sanitized.startsWith('/') ? '/' : ''
  const result = `${prefix}${stack.join('/')}`
  return result || (sanitized.startsWith('/') ? '/' : '.')
}

export function dirname(path: string): string {
  if (path === '/' || path === '~') return path
  const normalized = normalizePath(path)
  if (normalized === '/' || normalized === '.') return normalized
  const parts = normalized.split('/')
  parts.pop()
  const parent = parts.join('/')
  if (!parent) {
    return normalized.startsWith('/') ? '/' : '.'
  }
  return parent
}

export function joinPath(base: string, next: string): string {
  if (next.startsWith('/') || next.startsWith('~')) return normalizePath(next)
  if (base === '/' || base === '.') return normalizePath(`${base}/${next}`)
  return normalizePath(`${base}/${next}`)
}

export function pathSegments(path: string): Array<{ label: string; value: string }> {
  const normalized = normalizePath(path)
  if (normalized === '/' || normalized === '.') {
    return [{ label: normalized, value: normalized }]
  }
  if (normalized.startsWith('~')) {
    const [root, ...rest] = normalized.split('/').filter(Boolean)
    const segments = [{ label: root, value: root }]
    let current = root
    for (const part of rest) {
      current = `${current}/${part}`
      segments.push({ label: part, value: current })
    }
    return segments
  }
  const parts = normalized.split('/').filter(Boolean)
  const segments: Array<{ label: string; value: string }> = []
  let current = normalized.startsWith('/') ? '' : ''
  for (const part of parts) {
    current = `${current}/${part}`
    segments.push({ label: part, value: current || '/' })
  }
  if (normalized.startsWith('/') && segments.length > 0) {
    segments.unshift({ label: '/', value: '/' })
  }
  return segments
}

export function sortEntries(entries: FileEntry[], key: SortKey, dir: SortDir): FileEntry[] {
  const multiplier = dir === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === 'dir') return -1
      if (b.type === 'dir') return 1
    }
    if (key === 'size') {
      return (a.size - b.size) * multiplier
    }
    if (key === 'mtime') {
      return (a.mtimeMs - b.mtimeMs) * multiplier
    }
    return a.name.localeCompare(b.name) * multiplier
  })
}

export function filterEntries(entries: FileEntry[], query: string): FileEntry[] {
  if (!query.trim()) return entries
  const lower = query.toLowerCase()
  return entries.filter((entry) => entry.name.toLowerCase().includes(lower))
}

export function getExtension(name: string): string {
  const index = name.lastIndexOf('.')
  if (index <= 0) return ''
  return name.slice(index + 1).toLowerCase()
}

export function isImageExtension(ext: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
}

export function isPdfExtension(ext: string): boolean {
  return ext === 'pdf'
}

export function isTextExtension(ext: string): boolean {
  return ['txt', 'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'css', 'html', 'yml', 'yaml', 'log', 'sh', 'py', 'go', 'rs', 'toml', 'env'].includes(ext)
}
