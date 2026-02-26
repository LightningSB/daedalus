import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import {
  ApiError,
  apiClient,
  type CreateSshSessionResponse,
  type SavedHost,
  type VaultStatus,
} from './api/client'

type ParsedSshCommand = {
  isSsh: boolean
  user?: string
  host?: string
  port?: number
}

type SessionTab = {
  id: string
  title: string
  rawCommand: string
  websocketUrl?: string
}

function parseSshCommand(raw: string): ParsedSshCommand {
  const tokens = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  if (tokens.length === 0 || tokens[0] !== 'ssh') {
    return { isSsh: false }
  }

  let port: number | undefined
  let user: string | undefined
  let host: string | undefined

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === '-p' && i + 1 < tokens.length) {
      const parsedPort = Number.parseInt(tokens[i + 1], 10)
      if (!Number.isNaN(parsedPort)) {
        port = parsedPort
      }
      i += 1
      continue
    }

    if (!token.startsWith('-') && !host) {
      const [maybeUser, maybeHost] = token.split('@')
      if (maybeHost) {
        user = maybeUser
        host = maybeHost
      } else {
        host = maybeUser
      }
    }
  }

  return {
    isSsh: true,
    user,
    host,
    port,
  }
}

function toTitleFromCommand(rawCommand: string): string {
  const parsed = parseSshCommand(rawCommand)
  if (parsed.host) {
    return parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host
  }
  return rawCommand.slice(0, 24) || 'SSH'
}

type MobileControl = {
  label: string
  sequence?: string
  action?: 'ctrl' | 'paste'
}

const MOBILE_CONTROLS: MobileControl[] = [
  { label: 'Ctrl', action: 'ctrl' },
  { label: 'Esc', sequence: '\u001b' },
  { label: 'Tab', sequence: '\t' },
  { label: '↑', sequence: '\u001b[A' },
  { label: '↓', sequence: '\u001b[B' },
  { label: '←', sequence: '\u001b[D' },
  { label: '→', sequence: '\u001b[C' },
  { label: 'PgUp', sequence: '\u001b[5~' },
  { label: 'PgDn', sequence: '\u001b[6~' },
  { label: 'Home', sequence: '\u001b[H' },
  { label: 'End', sequence: '\u001b[F' },
  { label: 'Ctrl+C', sequence: '\u0003' },
  { label: 'Ctrl+D', sequence: '\u0004' },
  { label: 'Paste', action: 'paste' },
]

function TerminalSession({
  session,
  isActive,
}: {
  session: SessionTab
  isActive: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const cursorRef = useRef<string | undefined>(undefined)
  const ctrlArmedRef = useRef(false)
  const [ctrlArmed, setCtrlArmed] = useState(false)

  useEffect(() => {
    ctrlArmedRef.current = ctrlArmed
  }, [ctrlArmed])

  const sendData = useCallback(async (data: string) => {
    const socket = websocketRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(data)
      return
    }

    try {
      await apiClient.sendSshInput(session.id, data)
    } catch {
      terminalRef.current?.writeln('\r\n\x1b[31mFailed to send input to backend.\x1b[0m')
    }
  }, [session.id])

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
      fontFamily: '"Fira Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.25,
      theme: {
        background: '#0c1118',
        foreground: '#d6dfeb',
        cursor: '#14b8a6',
      },
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    const webLinks = new WebLinksAddon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinks)
    terminal.loadAddon(searchAddon)
    try {
      const webgl = new WebglAddon()
      terminal.loadAddon(webgl)
      webgl.onContextLoss(() => webgl.dispose())
    } catch {
      // Optional addon: soft-fail on unsupported devices.
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    if (containerRef.current) {
      terminal.open(containerRef.current)
      fitAddon.fit()
    }

    terminal.writeln('\x1b[1;36mDaedalus SSH Workbench\x1b[0m')
    terminal.writeln(`Session: ${session.title}`)
    terminal.writeln('Tip: Ctrl+Shift+F opens quick search.')
    terminal.writeln('')

    const onDataDisposable = terminal.onData((data) => {
      void sendData(data)
    })

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true
      }

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
        const query = window.prompt('Search terminal buffer')
        if (query) {
          searchAddon.findNext(query)
        }
        return false
      }

      if (ctrlArmedRef.current && event.key.length === 1) {
        const code = event.key.toUpperCase().charCodeAt(0) - 64
        if (code >= 1 && code <= 31) {
          void sendData(String.fromCharCode(code))
          setCtrlArmed(false)
          return false
        }
      }

      return true
    })

    const onResizeDisposable = terminal.onResize((event) => {
      void apiClient.resizeSshSession(session.id, event.cols, event.rows)
    })

    let isCancelled = false
    const connect = async () => {
      if (session.websocketUrl) {
        const socket = new WebSocket(session.websocketUrl)
        websocketRef.current = socket
        socket.onmessage = (event) => {
          terminal.write(typeof event.data === 'string' ? event.data : '')
        }
        socket.onopen = () => {
          void apiClient.resizeSshSession(session.id, terminal.cols, terminal.rows)
        }
        socket.onerror = () => {
          terminal.writeln('\r\n\x1b[31mWebSocket error.\x1b[0m')
        }
        socket.onclose = () => {
          terminal.writeln('\r\n\x1b[33mSession connection closed.\x1b[0m')
        }
        return
      }

      const poll = async () => {
        if (isCancelled) return
        try {
          const output = await apiClient.readSshOutput(session.id, cursorRef.current)
          if (output.data) {
            terminal.write(output.data)
          }
          cursorRef.current = output.cursor ?? cursorRef.current
        } catch (error) {
          if (error instanceof ApiError) {
            terminal.writeln(`\r\n\x1b[31mOutput error: ${error.message}\x1b[0m`)
          } else {
            terminal.writeln('\r\n\x1b[31mOutput polling failed.\x1b[0m')
          }
        }
      }

      await poll()
      pollTimerRef.current = window.setInterval(() => {
        void poll()
      }, 700)
    }

    void connect()

    return () => {
      isCancelled = true
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current)
      }
      websocketRef.current?.close()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
  }, [sendData, session.id, session.title, session.websocketUrl])

  useEffect(() => {
    if (!isActive) {
      return
    }
    const timer = window.setTimeout(() => {
      fitAddonRef.current?.fit()
      terminalRef.current?.focus()
    }, 25)
    return () => window.clearTimeout(timer)
  }, [isActive])

  const handleControlPress = useCallback(async (control: MobileControl) => {
    if (control.action === 'ctrl') {
      setCtrlArmed((current) => !current)
      terminalRef.current?.focus()
      return
    }

    if (control.action === 'paste') {
      try {
        const text = await navigator.clipboard.readText()
        if (text) {
          await sendData(text)
        }
      } catch {
        terminalRef.current?.writeln('\r\n\x1b[31mClipboard read blocked by browser.\x1b[0m')
      }
      terminalRef.current?.focus()
      return
    }

    if (control.sequence) {
      await sendData(control.sequence)
      terminalRef.current?.focus()
    }
  }, [sendData])

  return (
    <section className={`terminal-session ${isActive ? 'active' : ''}`}>
      <div ref={containerRef} className="terminal-canvas" />
      <div className="mobile-controls">
        {MOBILE_CONTROLS.map((control) => (
          <button
            key={control.label}
            type="button"
            className={control.action === 'ctrl' && ctrlArmed ? 'control-btn armed' : 'control-btn'}
            onClick={() => {
              void handleControlPress(control)
            }}
          >
            {control.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function App() {
  const [commandInput, setCommandInput] = useState('ssh root@example.com -p 22')
  const [sessions, setSessions] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>([])
  const [hostsError, setHostsError] = useState<string | null>(null)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null)
  const [vaultSecret, setVaultSecret] = useState('')
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null)
  const [statusLine, setStatusLine] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const parsedCommand = useMemo(() => parseSshCommand(commandInput.trim()), [commandInput])

  const refreshSavedHosts = useCallback(async () => {
    try {
      const hosts = await apiClient.getSavedHosts()
      setSavedHosts(hosts)
      setHostsError(null)
    } catch (error) {
      if (error instanceof ApiError) {
        setHostsError(error.message)
      } else {
        setHostsError('Failed to load saved hosts.')
      }
    }
  }, [])

  const refreshVaultStatus = useCallback(async () => {
    try {
      const status = await apiClient.getVaultStatus()
      setVaultStatus(status)
    } catch {
      setVaultStatus(null)
    }
  }, [])

  useEffect(() => {
    void refreshSavedHosts()
    void refreshVaultStatus()
  }, [refreshSavedHosts, refreshVaultStatus])

  const createSessionFromCommand = useCallback(async (rawCommand: string, title?: string) => {
    if (!rawCommand.trim()) {
      setStatusLine('Command is required.')
      return
    }
    setBusy(true)
    setStatusLine('Creating SSH session...')
    try {
      const response: CreateSshSessionResponse = await apiClient.createSshSession({ rawCommand })
      const nextSession: SessionTab = {
        id: response.sessionId,
        title: title ?? toTitleFromCommand(rawCommand),
        rawCommand,
        websocketUrl: response.websocketUrl,
      }
      setSessions((current) => [nextSession, ...current])
      setActiveSessionId(nextSession.id)
      setStatusLine(`Connected: ${nextSession.title}`)
    } catch (error) {
      if (error instanceof ApiError) {
        setStatusLine(`Failed to create session: ${error.message}`)
      } else {
        setStatusLine('Failed to create session.')
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const closeSession = useCallback(async (sessionId: string) => {
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== sessionId)
      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[0]?.id ?? null)
      }
      return remaining
    })
    try {
      await apiClient.closeSshSession(sessionId)
    } catch {
      // Best-effort close on backend.
    }
  }, [activeSessionId])

  const handleVaultInit = useCallback(async () => {
    if (!vaultSecret.trim()) {
      setStatusLine('Vault passphrase is required.')
      return
    }
    setBusy(true)
    try {
      await apiClient.initVault(vaultSecret)
      setVaultSecret('')
      setStatusLine('Vault initialized.')
      await refreshVaultStatus()
    } catch (error) {
      setStatusLine(error instanceof ApiError ? error.message : 'Vault init failed.')
    } finally {
      setBusy(false)
    }
  }, [refreshVaultStatus, vaultSecret])

  const handleVaultUnlock = useCallback(async () => {
    if (!vaultSecret.trim()) {
      setStatusLine('Vault passphrase is required.')
      return
    }
    setBusy(true)
    try {
      await apiClient.unlockVault(vaultSecret)
      setVaultSecret('')
      setStatusLine('Vault unlocked.')
      await refreshVaultStatus()
    } catch (error) {
      setStatusLine(error instanceof ApiError ? error.message : 'Vault unlock failed.')
    } finally {
      setBusy(false)
    }
  }, [refreshVaultStatus, vaultSecret])

  const handleVaultLock = useCallback(async () => {
    setBusy(true)
    try {
      await apiClient.lockVault()
      setRecoveryPhrase(null)
      setStatusLine('Vault locked.')
      await refreshVaultStatus()
    } catch (error) {
      setStatusLine(error instanceof ApiError ? error.message : 'Vault lock failed.')
    } finally {
      setBusy(false)
    }
  }, [refreshVaultStatus])

  const handleRecoveryPhrase = useCallback(async () => {
    setBusy(true)
    try {
      const phrase = await apiClient.getRecoveryPhrase()
      setRecoveryPhrase(phrase)
      setStatusLine('Recovery phrase loaded.')
    } catch (error) {
      setStatusLine(error instanceof ApiError ? error.message : 'Failed to load recovery phrase.')
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <main className="workbench-shell">
      <aside className="workbench-sidebar">
        <h1>Daedalus SSH Workbench</h1>

        <div className="panel glass">
          <h2>New Session</h2>
          <label htmlFor="ssh-command">SSH command</label>
          <input
            id="ssh-command"
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            placeholder="ssh user@host -p 22"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn-emerald"
            disabled={busy}
            onClick={() => {
              void createSessionFromCommand(commandInput.trim())
            }}
          >
            Open Session
          </button>
          <p className="hint">
            Parser: {parsedCommand.isSsh ? 'ssh' : 'raw'} {parsedCommand.user ?? ''}{parsedCommand.host ? `@${parsedCommand.host}` : ''}{parsedCommand.port ? ` :${parsedCommand.port}` : ''}
          </p>
        </div>

        <div className="panel glass">
          <div className="panel-header">
            <h2>Saved Hosts</h2>
            <button type="button" onClick={() => void refreshSavedHosts()}>Refresh</button>
          </div>
          {hostsError && <p className="error">{hostsError}</p>}
          {!hostsError && savedHosts.length === 0 && <p className="hint">No saved hosts yet.</p>}
          <ul className="host-list">
            {savedHosts.map((host) => {
              const defaultCommand = host.rawCommand ?? `ssh ${host.username ? `${host.username}@` : ''}${host.hostname}${host.port ? ` -p ${host.port}` : ''}`
              return (
                <li key={host.id}>
                  <div>
                    <strong>{host.name}</strong>
                    <span>{defaultCommand}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void createSessionFromCommand(defaultCommand, host.name)
                    }}
                    disabled={busy}
                  >
                    Launch
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="panel glass">
          <h2>Vault</h2>
          <p className="hint">
            Status: {vaultStatus ? (vaultStatus.initialized ? (vaultStatus.locked ? 'Locked' : 'Unlocked') : 'Not initialized') : 'Unavailable'}
          </p>
          <input
            value={vaultSecret}
            type="password"
            placeholder="Vault passphrase"
            onChange={(event) => setVaultSecret(event.target.value)}
          />
          <div className="vault-actions">
            {!vaultStatus?.initialized && <button type="button" onClick={() => void handleVaultInit()} disabled={busy}>Init</button>}
            {vaultStatus?.initialized && vaultStatus.locked && <button type="button" onClick={() => void handleVaultUnlock()} disabled={busy}>Unlock</button>}
            {vaultStatus?.initialized && !vaultStatus.locked && <button type="button" onClick={() => void handleVaultLock()} disabled={busy}>Lock</button>}
            <button type="button" onClick={() => void handleRecoveryPhrase()} disabled={busy}>Recovery Phrase</button>
          </div>
          {recoveryPhrase && <pre className="recovery-phrase">{recoveryPhrase}</pre>}
        </div>
      </aside>

      <section className="workbench-main">
        <div className="tabs">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={session.id === activeSessionId ? 'tab active' : 'tab'}
              onClick={() => setActiveSessionId(session.id)}
            >
              <span>{session.title}</span>
              <span
                role="button"
                tabIndex={0}
                className="close"
                onClick={(event) => {
                  event.stopPropagation()
                  void closeSession(session.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    void closeSession(session.id)
                  }
                }}
              >
                ×
              </span>
            </button>
          ))}
          {sessions.length === 0 && <p className="hint empty-tabs">No active sessions.</p>}
        </div>

        <div className="terminal-area">
          {sessions.map((session) => (
            <TerminalSession key={session.id} session={session} isActive={session.id === activeSessionId} />
          ))}
        </div>
        {statusLine && <p className="status-line">{statusLine}</p>}
      </section>
    </main>
  )
}

export default App
