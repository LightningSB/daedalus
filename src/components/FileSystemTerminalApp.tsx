import { useEffect, useMemo, useRef, useState } from 'react'
import * as mammoth from 'mammoth'
import { useTelegram } from '../hooks/useTelegram'

interface FileSystemTerminalAppProps {
  onBack: () => void
}

type FsNode = {
  type: 'dir' | 'file'
  name: string
  children?: FsNode[]
  content?: string
  fileUrl?: string
}

type OpenKind = 'markdown' | 'text' | 'image' | 'pdf' | 'docx' | 'unknown'

type OpenFileState = {
  name: string
  kind: OpenKind
  source: 'mock' | 'local'
  textContent?: string
  htmlContent?: string
  fileUrl?: string
}

const DEMO_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
  </defs>
  <rect width="1200" height="700" fill="url(#g)"/>
  <circle cx="280" cy="230" r="120" fill="rgba(255,255,255,0.2)"/>
  <circle cx="900" cy="420" r="170" fill="rgba(255,255,255,0.12)"/>
  <text x="90" y="620" fill="white" font-size="54" font-family="Nunito, Arial">Daedalus • FS Terminal Preview</text>
</svg>
`)}`

const MOCK_FS: FsNode = {
  type: 'dir',
  name: '/',
  children: [
    {
      type: 'dir',
      name: 'notes',
      children: [
        {
          type: 'file',
          name: 'README.md',
          content:
            '# File System Terminal\n\nThis is a mobile-first prototype.\n\n## Supported now\n- Markdown\n- Images\n- PDFs\n- DOCX (via browser conversion)\n\n## Next\n- Real backend storage\n- SSH session execution\n- Secure auth + key management',
        },
        {
          type: 'file',
          name: 'todo.md',
          content:
            '- [ ] Connect server file API\n- [ ] Add tabbed terminal sessions\n- [ ] Add SFTP pane\n- [ ] Add secure SSH key vault',
        },
      ],
    },
    {
      type: 'dir',
      name: 'media',
      children: [
        {
          type: 'file',
          name: 'preview-image.png',
          fileUrl: DEMO_IMAGE,
        },
      ],
    },
    {
      type: 'dir',
      name: 'manuals',
      children: [
        {
          type: 'file',
          name: 'terminal-guide.pdf',
          fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        },
      ],
    },
    {
      type: 'file',
      name: 'welcome.txt',
      content:
        'Welcome to the Daedalus file browser + terminal.\nUse the Upload button to open your own .md, images, .pdf, and .docx files.',
    },
  ],
}

const pathToString = (segments: string[]) => (segments.length ? `/${segments.join('/')}` : '/')

const extFromName = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

const inferKindFromName = (name: string): OpenKind => {
  const ext = extFromName(name)
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (['txt', 'json', 'yml', 'yaml', 'log', 'ts', 'tsx', 'js', 'jsx', 'py', 'go'].includes(ext)) return 'text'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  return 'unknown'
}

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

const findEntry = (root: FsNode, pathSegments: string[], name: string): FsNode | null => {
  const current = getNodeByPath(root, pathSegments)
  if (!current || current.type !== 'dir') return null
  return current.children?.find((entry) => entry.name === name) ?? null
}

export function FileSystemTerminalApp({ onBack }: FileSystemTerminalAppProps) {
  const [pathSegments, setPathSegments] = useState<string[]>([])
  const [openFile, setOpenFile] = useState<OpenFileState | null>(null)
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    'Daedalus Terminal (preview mode)',
    'Try: help, ls, cd notes, open README.md, cat README.md',
    'Upload local: .md, image, .pdf, .docx',
  ])
  const [commandInput, setCommandInput] = useState('')
  const [terminalFullscreen, setTerminalFullscreen] = useState(false)
  const [isOpeningLocal, setIsOpeningLocal] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const terminalScrollRef = useRef<HTMLDivElement | null>(null)

  const { showBackButton, impactLight, impactMedium, notificationSuccess } = useTelegram()

  useEffect(() => {
    const cleanup = showBackButton(onBack)
    return cleanup
  }, [showBackButton, onBack])

  useEffect(() => {
    if (!terminalScrollRef.current) return
    terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight
  }, [terminalHistory, terminalFullscreen])

  useEffect(() => {
    return () => {
      if (openFile?.source === 'local' && openFile.fileUrl && openFile.fileUrl.startsWith('blob:')) {
        URL.revokeObjectURL(openFile.fileUrl)
      }
    }
  }, [openFile])

  const cwd = useMemo(() => pathToString(pathSegments), [pathSegments])

  const currentDir = useMemo(() => getNodeByPath(MOCK_FS, pathSegments), [pathSegments])

  const entries = useMemo(() => {
    if (!currentDir || currentDir.type !== 'dir') return []
    return [...(currentDir.children ?? [])].sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name)
      return a.type === 'dir' ? -1 : 1
    })
  }, [currentDir])

  const writeTerminal = (lines: string[]) => {
    setTerminalHistory((prev) => [...prev, ...lines])
  }

  const enterDir = (dirName: string) => {
    impactLight()
    setOpenFile(null)
    setPathSegments((prev) => [...prev, dirName])
  }

  const goUp = () => {
    impactLight()
    setOpenFile(null)
    setPathSegments((prev) => prev.slice(0, -1))
  }

  const openFsNode = async (node: FsNode) => {
    if (node.type !== 'file') return

    impactLight()

    const kind = inferKindFromName(node.name)

    if (kind === 'markdown' || kind === 'text') {
      setOpenFile({
        name: node.name,
        kind,
        source: 'mock',
        textContent: node.content ?? '(empty file)',
      })
      return
    }

    if ((kind === 'image' || kind === 'pdf') && node.fileUrl) {
      setOpenFile({
        name: node.name,
        kind,
        source: 'mock',
        fileUrl: node.fileUrl,
      })
      return
    }

    if (kind === 'docx') {
      setOpenFile({
        name: node.name,
        kind,
        source: 'mock',
        textContent: 'DOCX preview is available for local files via Upload (browser conversion).',
      })
      return
    }

    setOpenFile({
      name: node.name,
      kind: 'unknown',
      source: 'mock',
      textContent: 'Unsupported file format in preview mode.',
    })
  }

  const openLocalFilePicker = () => {
    impactLight()
    fileInputRef.current?.click()
  }

  const handleLocalFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsOpeningLocal(true)

    try {
      const kind = inferKindFromName(file.name)

      if (kind === 'markdown' || kind === 'text' || file.type.startsWith('text/')) {
        const text = await file.text()
        setOpenFile({
          name: file.name,
          kind: kind === 'unknown' ? 'text' : kind,
          source: 'local',
          textContent: text,
        })
        notificationSuccess()
      } else if (kind === 'image' || file.type.startsWith('image/')) {
        const objectUrl = URL.createObjectURL(file)
        setOpenFile({
          name: file.name,
          kind: 'image',
          source: 'local',
          fileUrl: objectUrl,
        })
        notificationSuccess()
      } else if (kind === 'pdf' || file.type === 'application/pdf') {
        const objectUrl = URL.createObjectURL(file)
        setOpenFile({
          name: file.name,
          kind: 'pdf',
          source: 'local',
          fileUrl: objectUrl,
        })
        notificationSuccess()
      } else if (
        kind === 'docx' ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        const arrayBuffer = await file.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer })
        setOpenFile({
          name: file.name,
          kind: 'docx',
          source: 'local',
          htmlContent: result.value || '<p>(No text extracted)</p>',
        })
        notificationSuccess()
      } else {
        setOpenFile({
          name: file.name,
          kind: 'unknown',
          source: 'local',
          textContent: 'Unsupported file type. Use .md, images, .pdf, or .docx.',
        })
      }
    } catch (error) {
      setOpenFile({
        name: file.name,
        kind: 'unknown',
        source: 'local',
        textContent: `Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
    } finally {
      setIsOpeningLocal(false)
      event.target.value = ''
    }
  }

  const runCommand = () => {
    const raw = commandInput.trim()
    if (!raw) return

    const [command, ...args] = raw.split(/\s+/)
    const cmd = command.toLowerCase()
    const output: string[] = [`$ ${raw}`]

    if (cmd === 'help') {
      output.push(
        'Commands: help, ls, cd <dir|..>, pwd, cat <file>, open <file>, clear, ssh-plan',
        'Mutation commands are placeholders until backend is connected.'
      )
    } else if (cmd === 'ls') {
      if (!entries.length) {
        output.push('(empty)')
      } else {
        output.push(entries.map((entry) => `${entry.type === 'dir' ? '📁' : '📄'} ${entry.name}`).join('  '))
      }
    } else if (cmd === 'pwd') {
      output.push(cwd)
    } else if (cmd === 'cd') {
      const target = args[0]
      if (!target) {
        output.push('usage: cd <dir|..>')
      } else if (target === '..') {
        if (pathSegments.length === 0) {
          output.push('already at root')
        } else {
          setPathSegments((prev) => prev.slice(0, -1))
          setOpenFile(null)
        }
      } else {
        const entry = findEntry(MOCK_FS, pathSegments, target)
        if (!entry || entry.type !== 'dir') {
          output.push(`cd: no such directory: ${target}`)
        } else {
          setPathSegments((prev) => [...prev, target])
          setOpenFile(null)
        }
      }
    } else if (cmd === 'cat') {
      const target = args[0]
      if (!target) {
        output.push('usage: cat <file>')
      } else {
        const entry = findEntry(MOCK_FS, pathSegments, target)
        if (!entry || entry.type !== 'file') {
          output.push(`cat: no such file: ${target}`)
        } else if (!entry.content) {
          output.push('cat: binary file (use open <file>)')
        } else {
          output.push(entry.content)
          setOpenFile({
            name: entry.name,
            kind: inferKindFromName(entry.name),
            source: 'mock',
            textContent: entry.content,
          })
        }
      }
    } else if (cmd === 'open') {
      const target = args[0]
      if (!target) {
        output.push('usage: open <file>')
      } else {
        const entry = findEntry(MOCK_FS, pathSegments, target)
        if (!entry || entry.type !== 'file') {
          output.push(`open: no such file: ${target}`)
        } else {
          void openFsNode(entry)
          output.push(`opened ${target}`)
        }
      }
    } else if (cmd === 'ssh-plan') {
      output.push(
        'SSH Roadmap:',
        '1) Local terminal UI complete (this step)',
        '2) Backend SSH gateway with session tokens',
        '3) Key auth + optional encrypted key vault',
        '4) Multiplexed sessions + reconnect',
        '5) SFTP/file sync pane and command audit log'
      )
    } else if (cmd === 'clear') {
      setTerminalHistory([])
      setCommandInput('')
      return
    } else if (['mkdir', 'touch', 'rm', 'mv'].includes(cmd)) {
      output.push(`'${cmd}' is placeholder-only (backend not connected yet).`)
    } else {
      output.push(`command not found: ${cmd}`)
    }

    writeTerminal(output)
    setCommandInput('')
  }

  const renderFilePreview = () => {
    if (!openFile) {
      return (
        <div className="glass rounded-2xl p-3 mb-3 animate-fade-in stagger-2">
          <p className="text-sm text-white/70">No file open</p>
          <p className="text-xs text-white/40 mt-1">Tap a file or upload one to preview it here.</p>
        </div>
      )
    }

    return (
      <div className="glass rounded-2xl p-3 mb-3 animate-fade-in stagger-2">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs text-white/50 truncate">
            {openFile.name} · {openFile.kind.toUpperCase()} · {openFile.source}
          </p>
          {openFile.fileUrl && (
            <a
              href={openFile.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-emerald-300 hover:text-emerald-200"
            >
              Open external
            </a>
          )}
        </div>

        {(openFile.kind === 'markdown' || openFile.kind === 'text' || openFile.kind === 'unknown') && (
          <pre className="text-[11px] text-white/85 leading-relaxed whitespace-pre-wrap break-words max-h-44 overflow-y-auto">
            {openFile.textContent}
          </pre>
        )}

        {openFile.kind === 'image' && openFile.fileUrl && (
          <img
            src={openFile.fileUrl}
            alt={openFile.name}
            className="w-full max-h-52 object-contain rounded-xl bg-black/20"
          />
        )}

        {openFile.kind === 'pdf' && openFile.fileUrl && (
          <iframe
            src={openFile.fileUrl}
            title={openFile.name}
            className="w-full h-56 rounded-xl border border-white/10 bg-white"
          />
        )}

        {openFile.kind === 'docx' && (
          <div className="prose prose-invert prose-sm max-w-none text-white/90 max-h-52 overflow-y-auto">
            {openFile.htmlContent ? (
              <div dangerouslySetInnerHTML={{ __html: openFile.htmlContent }} />
            ) : (
              <p>{openFile.textContent ?? 'No DOCX content extracted.'}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderTerminalPanel = (fullscreen: boolean) => (
    <section
      className={
        fullscreen
          ? 'fixed inset-0 z-50 bg-dark px-3 py-3 flex flex-col'
          : 'glass rounded-2xl p-3 animate-fade-in stagger-3'
      }
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold">Terminal</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/50">cwd: {cwd}</span>
          <button
            onClick={() => {
              impactMedium()
              setTerminalFullscreen((v) => !v)
            }}
            className="px-2 py-1 rounded-lg bg-white/10 text-[11px]"
          >
            {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </div>

      <div
        ref={terminalScrollRef}
        className={
          fullscreen
            ? 'bg-black/45 rounded-xl p-3 flex-1 overflow-y-auto mb-2 font-mono text-[11px]'
            : 'bg-black/35 rounded-xl p-2 h-48 overflow-y-auto mb-2 font-mono text-[11px]'
        }
      >
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
          placeholder="Type command..."
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

      {fullscreen && (
        <p className="text-[10px] text-white/40 mt-2">
          Placeholder terminal UI only — command execution backend not connected yet.
        </p>
      )}
    </section>
  )

  return (
    <div className="min-h-screen px-4 py-5 pb-6">
      <header className="mb-4 animate-fade-in">
        <h1 className="text-2xl font-bold text-white">File System + Terminal</h1>
        <p className="text-xs text-emerald-300/80 mt-1">
          Mobile optimized · open md/images/pdf/docx · no backend yet
        </p>
      </header>

      <section className="glass rounded-2xl p-3 mb-3 animate-fade-in stagger-1">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => {
                impactLight()
                setPathSegments([])
                setOpenFile(null)
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
                  setOpenFile(null)
                }}
                className="px-3 py-1.5 rounded-lg bg-white/10 text-xs whitespace-nowrap"
              >
                {segment}
              </button>
            ))}
          </div>

          <button
            onClick={openLocalFilePicker}
            disabled={isOpeningLocal}
            className="btn-emerald rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-60"
          >
            {isOpeningLocal ? 'Opening...' : 'Upload'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".md,.markdown,.txt,.json,.yml,.yaml,image/*,.pdf,.docx"
            onChange={handleLocalFileSelected}
          />
        </div>

        {pathSegments.length > 0 && (
          <button onClick={goUp} className="mb-3 px-3 py-2 rounded-xl bg-white/10 text-sm w-full text-left">
            ⬅️ Up one level
          </button>
        )}

        <div className="space-y-2 max-h-56 overflow-y-auto">
          {entries.map((entry) => (
            <button
              key={entry.name}
              onClick={() => (entry.type === 'dir' ? enterDir(entry.name) : void openFsNode(entry))}
              className="w-full flex items-center justify-between px-3 py-3 rounded-xl bg-white/5 active:bg-white/10 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm">
                <span>{entry.type === 'dir' ? '📁' : '📄'}</span>
                <span className="truncate">{entry.name}</span>
              </span>
              <span className="text-white/40 text-xs">{entry.type === 'dir' ? 'open' : 'preview'}</span>
            </button>
          ))}
        </div>
      </section>

      {renderFilePreview()}

      <section className="glass rounded-2xl p-3 mb-3 animate-fade-in stagger-3">
        <h3 className="text-sm font-semibold mb-2">SSH client plan (next milestone)</h3>
        <ul className="text-xs text-white/70 space-y-1 list-disc ml-4">
          <li>Backend SSH gateway with short-lived session tokens</li>
          <li>Key-based auth (ed25519), optional encrypted key vault</li>
          <li>Persistent shell sessions + reconnect</li>
          <li>SFTP/file sync panel tied to this browser UI</li>
          <li>Audit logs + command safety guardrails</li>
        </ul>
      </section>

      {!terminalFullscreen && renderTerminalPanel(false)}
      {terminalFullscreen && renderTerminalPanel(true)}
    </div>
  )
}
