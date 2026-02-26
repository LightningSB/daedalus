import { useEffect, useMemo, useState } from 'react'
import { useTelegram } from '../hooks/useTelegram'

interface FileSystemTerminalAppProps {
  onBack: () => void
}

type FsNode = {
  type: 'dir' | 'file'
  name: string
  children?: FsNode[]
  content?: string
}

const MOCK_FS: FsNode = {
  type: 'dir',
  name: '/',
  children: [
    {
      type: 'dir',
      name: 'apps',
      children: [
        {
          type: 'dir',
          name: 'vin-decoder',
          children: [
            { type: 'file', name: 'README.md', content: '# VIN Decoder\n\nMini app for decoding VINs.' },
            { type: 'file', name: 'config.json', content: '{\n  "theme": "dark",\n  "version": "0.1.0"\n}' },
          ],
        },
      ],
    },
    {
      type: 'dir',
      name: 'docs',
      children: [
        {
          type: 'file',
          name: 'roadmap.md',
          content: '# Roadmap\n\n- [ ] Add backend file persistence\n- [ ] Multi-session terminal state\n- [ ] Real command execution sandbox',
        },
        {
          type: 'file',
          name: 'notes.txt',
          content: 'This is a placeholder local file system for UI prototyping.',
        },
      ],
    },
    {
      type: 'dir',
      name: 'tmp',
      children: [{ type: 'file', name: 'session.log', content: 'terminal: ready' }],
    },
    { type: 'file', name: 'welcome.txt', content: 'Welcome to Daedalus FS Terminal preview.' },
  ],
}

const pathToString = (segments: string[]) => (segments.length ? `/${segments.join('/')}` : '/')

const getNodeByPath = (root: FsNode, segments: string[]): FsNode | null => {
  let current: FsNode = root

  for (const segment of segments) {
    if (current.type !== 'dir' || !current.children) return null
    const next = current.children.find((child) => child.name === segment && child.type === 'dir')
    if (!next) return null
    current = next
  }

  return current
}

const resolveFileInCurrentDir = (root: FsNode, pathSegments: string[], fileName: string): FsNode | null => {
  const dir = getNodeByPath(root, pathSegments)
  if (!dir || dir.type !== 'dir' || !dir.children) return null
  return dir.children.find((child) => child.name === fileName) ?? null
}

export function FileSystemTerminalApp({ onBack }: FileSystemTerminalAppProps) {
  const [pathSegments, setPathSegments] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<FsNode | null>(null)
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    'Daedalus Terminal (preview mode)',
    'No backend connected yet. Type "help" for available commands.',
  ])
  const [commandInput, setCommandInput] = useState('')
  const { showBackButton, impactLight, impactMedium } = useTelegram()

  useEffect(() => {
    const cleanup = showBackButton(onBack)
    return cleanup
  }, [showBackButton, onBack])

  const cwd = useMemo(() => pathToString(pathSegments), [pathSegments])

  const currentDir = useMemo(() => getNodeByPath(MOCK_FS, pathSegments), [pathSegments])

  const entries = useMemo(() => {
    if (!currentDir || currentDir.type !== 'dir') return []
    return [...(currentDir.children ?? [])].sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name)
      return a.type === 'dir' ? -1 : 1
    })
  }, [currentDir])

  const printToTerminal = (lines: string[]) => {
    setTerminalHistory((prev) => [...prev, ...lines])
  }

  const navigateToDir = (dirName: string) => {
    impactLight()
    setSelectedFile(null)
    setPathSegments((prev) => [...prev, dirName])
  }

  const navigateUp = () => {
    impactLight()
    setSelectedFile(null)
    setPathSegments((prev) => prev.slice(0, -1))
  }

  const openFile = (node: FsNode) => {
    impactLight()
    setSelectedFile(node)
  }

  const runCommand = () => {
    const raw = commandInput.trim()
    if (!raw) return

    const [cmd, ...args] = raw.split(/\s+/)
    const cmdLower = cmd.toLowerCase()

    const nextOutput: string[] = [`$ ${raw}`]

    if (cmdLower === 'help') {
      nextOutput.push(
        'Commands: help, ls, cd <dir|..>, pwd, cat <file>, clear',
        'Preview-only commands: mkdir, touch, rm, mv (not connected yet)'
      )
    } else if (cmdLower === 'ls') {
      if (entries.length === 0) {
        nextOutput.push('(empty)')
      } else {
        nextOutput.push(entries.map((entry) => `${entry.type === 'dir' ? '📁' : '📄'} ${entry.name}`).join('  '))
      }
    } else if (cmdLower === 'pwd') {
      nextOutput.push(cwd)
    } else if (cmdLower === 'cd') {
      const target = args[0]
      if (!target) {
        nextOutput.push('usage: cd <dir|..>')
      } else if (target === '..') {
        if (pathSegments.length === 0) {
          nextOutput.push('already at root')
        } else {
          setPathSegments((prev) => prev.slice(0, -1))
          setSelectedFile(null)
        }
      } else {
        const candidate = resolveFileInCurrentDir(MOCK_FS, pathSegments, target)
        if (!candidate || candidate.type !== 'dir') {
          nextOutput.push(`cd: no such directory: ${target}`)
        } else {
          setPathSegments((prev) => [...prev, target])
          setSelectedFile(null)
        }
      }
    } else if (cmdLower === 'cat') {
      const fileName = args[0]
      if (!fileName) {
        nextOutput.push('usage: cat <file>')
      } else {
        const candidate = resolveFileInCurrentDir(MOCK_FS, pathSegments, fileName)
        if (!candidate || candidate.type !== 'file') {
          nextOutput.push(`cat: no such file: ${fileName}`)
        } else {
          nextOutput.push(candidate.content ?? '')
          setSelectedFile(candidate)
        }
      }
    } else if (cmdLower === 'clear') {
      setTerminalHistory([])
      setCommandInput('')
      return
    } else if (['mkdir', 'touch', 'rm', 'mv'].includes(cmdLower)) {
      nextOutput.push(`'${cmdLower}' is placeholder-only (backend not connected yet).`)
    } else {
      nextOutput.push(`command not found: ${cmdLower}`)
    }

    printToTerminal(nextOutput)
    setCommandInput('')
  }

  return (
    <div className="min-h-screen px-4 py-5 pb-6">
      <header className="mb-4 animate-fade-in">
        <h1 className="text-2xl font-bold text-white">File System + Terminal</h1>
        <p className="text-xs text-emerald-300/80 mt-1">Mobile preview · placeholder mode (no backend)</p>
      </header>

      <section className="glass rounded-2xl p-3 mb-3 animate-fade-in stagger-1">
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <button
            onClick={() => {
              impactLight()
              setPathSegments([])
              setSelectedFile(null)
            }}
            className="px-3 py-1.5 rounded-lg bg-white/10 text-xs whitespace-nowrap"
          >
            /
          </button>
          {pathSegments.map((segment, index) => (
            <button
              key={`${segment}-${index}`}
              onClick={() => {
                impactLight()
                setPathSegments(pathSegments.slice(0, index + 1))
                setSelectedFile(null)
              }}
              className="px-3 py-1.5 rounded-lg bg-white/10 text-xs whitespace-nowrap"
            >
              {segment}
            </button>
          ))}
        </div>

        {pathSegments.length > 0 && (
          <button
            onClick={navigateUp}
            className="mb-3 px-3 py-2 rounded-xl bg-white/10 text-sm w-full text-left"
          >
            ⬅️ Up one level
          </button>
        )}

        <div className="space-y-2 max-h-56 overflow-y-auto">
          {entries.map((entry) => (
            <button
              key={entry.name}
              onClick={() => (entry.type === 'dir' ? navigateToDir(entry.name) : openFile(entry))}
              className="w-full flex items-center justify-between px-3 py-3 rounded-xl bg-white/5 active:bg-white/10 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm">
                <span>{entry.type === 'dir' ? '📁' : '📄'}</span>
                <span className="truncate">{entry.name}</span>
              </span>
              <span className="text-white/40 text-xs">{entry.type === 'dir' ? 'open' : 'view'}</span>
            </button>
          ))}
        </div>
      </section>

      {selectedFile?.type === 'file' && (
        <section className="glass rounded-2xl p-3 mb-3 animate-fade-in stagger-2">
          <p className="text-xs text-white/50 mb-2">Preview · {selectedFile.name}</p>
          <pre className="text-[11px] text-white/85 leading-relaxed whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
            {selectedFile.content}
          </pre>
        </section>
      )}

      <section className="glass rounded-2xl p-3 animate-fade-in stagger-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Terminal</p>
          <span className="text-[10px] text-white/50">cwd: {cwd}</span>
        </div>

        <div className="bg-black/35 rounded-xl p-2 h-48 overflow-y-auto mb-2 font-mono text-[11px]">
          {terminalHistory.length === 0 ? (
            <p className="text-white/30">(cleared)</p>
          ) : (
            terminalHistory.map((line, idx) => (
              <p key={`${line}-${idx}`} className="text-emerald-100/90 whitespace-pre-wrap break-words">
                {line}
              </p>
            ))
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                impactMedium()
                runCommand()
              }
            }}
            placeholder="Type command (help, ls, cd, cat...)"
            className="flex-1 bg-white/10 border border-white/10 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
          <button
            onClick={() => {
              impactMedium()
              runCommand()
            }}
            className="btn-emerald rounded-xl px-4 py-3 text-sm font-semibold"
          >
            Run
          </button>
        </div>
      </section>
    </div>
  )
}
