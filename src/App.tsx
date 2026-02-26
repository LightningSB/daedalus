import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { useTelegram } from './hooks/useTelegram'
import {
  ApiError,
  createApiClient,
  type CreateSshSessionResponse,
  type SavedHost,
  type VaultStatus,
} from './api/client'

type SessionTab = {
  id: string
  title: string
  websocketUrl: string
}

type SessionCredentials = {
  password?: string
  privateKey?: string
  passphrase?: string
}

type ParsedSshCommand = {
  isSsh: boolean
  user?: string
  host?: string
  port?: number
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
      const [candidateUser, candidateHost] = token.split('@')
      if (candidateHost) {
        user = candidateUser
        host = candidateHost
      } else {
        host = candidateUser
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

function titleFromRawCommand(rawCommand: string): string {
  const parsed = parseSshCommand(rawCommand)
  if (parsed.host) {
    return parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host
  }
  return rawCommand.slice(0, 28) || 'SSH'
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// VaultScreen
// ---------------------------------------------------------------------------

type VaultScreenProps = {
  vaultInitialized: boolean
  vaultPassphrase: string
  setVaultPassphrase: (value: string) => void
  busy: boolean
  recoveryPhrase: string | null
  onInit: () => void
  onUnlock: () => void
}

function VaultScreen({
  vaultInitialized,
  vaultPassphrase,
  setVaultPassphrase,
  busy,
  recoveryPhrase,
  onInit,
  onUnlock,
}: VaultScreenProps) {
  const title = !vaultInitialized ? 'Initialize Vault' : 'Unlock Vault'
  const icon = !vaultInitialized ? '🔐' : '🔒'
  const hint = !vaultInitialized
    ? 'Create a master passphrase to enable SSH credentials storage.'
    : 'Vault is locked. Enter your master passphrase to continue.'

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      if (!vaultInitialized) {
        onInit()
      } else {
        onUnlock()
      }
    }
  }

  return (
    <div
      className="modal-backdrop vault-lock-overlay"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="modal-card glass vault-lock-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vault-screen-header">
          <span className="vault-icon">{icon}</span>
          <h2>{title}</h2>
          <p className="hint">{hint}</p>
        </div>

        <input
          value={vaultPassphrase}
          type="password"
          placeholder="Master passphrase"
          className="vault-passphrase-input"
          autoFocus
          onChange={(event) => setVaultPassphrase(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        <button
          type="button"
          className="btn-primary"
          onClick={!vaultInitialized ? onInit : onUnlock}
          disabled={busy || !vaultPassphrase.trim()}
        >
          {busy ? 'Please wait…' : title}
        </button>

        {recoveryPhrase && (
          <div className="recovery-section">
            <p>Recovery phrase — save this somewhere safe:</p>
            <pre className="recovery-phrase">{recoveryPhrase}</pre>
            <button
              type="button"
              onClick={() => {
                downloadTextFile('daedalus-recovery-phrase.txt', recoveryPhrase)
              }}
            >
              Download Recovery TXT
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SessionDialog
// ---------------------------------------------------------------------------

type SessionDialogProps = {
  sessionCommand: string
  setSessionCommand: (value: string) => void
  parsedCommand: ParsedSshCommand
  authMethod: 'key' | 'password' | 'none'
  setAuthMethod: (method: 'key' | 'password' | 'none') => void
  authPassword: string
  setAuthPassword: (value: string) => void
  authPrivateKey: string
  setAuthPrivateKey: (value: string) => void
  authPrivateKeyFilename: string
  authKeyPassphrase: string
  setAuthKeyPassphrase: (value: string) => void
  saveHostEnabled: boolean
  setSaveHostEnabled: (value: boolean) => void
  saveHostLabel: string
  setSaveHostLabel: (value: string) => void
  isHostAlreadySaved: boolean
  vaultToken: string | null
  busy: boolean
  keyFileInputRef: React.RefObject<HTMLInputElement>
  onKeyFileSelected: (event: ChangeEvent<HTMLInputElement>) => void
  onConnect: () => void
  onCancel: () => void
}

function SessionDialog({
  sessionCommand,
  setSessionCommand,
  parsedCommand,
  authMethod,
  setAuthMethod,
  authPassword,
  setAuthPassword,
  authPrivateKey,
  setAuthPrivateKey,
  authPrivateKeyFilename,
  authKeyPassphrase,
  setAuthKeyPassphrase,
  saveHostEnabled,
  setSaveHostEnabled,
  saveHostLabel,
  setSaveHostLabel,
  isHostAlreadySaved,
  vaultToken,
  busy,
  keyFileInputRef,
  onKeyFileSelected,
  onConnect,
  onCancel,
}: SessionDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card glass" onClick={(event) => event.stopPropagation()}>
        <h2>New SSH Session</h2>

        <div className="auth-form">
          <label htmlFor="session-command-input">SSH command</label>
          <input
            id="session-command-input"
            value={sessionCommand}
            onChange={(event) => setSessionCommand(event.target.value)}
            placeholder="ssh user@hostname"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <p className="hint">
            Parser: {parsedCommand.isSsh ? 'ssh' : 'raw'} {parsedCommand.user ?? ''}{parsedCommand.host ? `@${parsedCommand.host}` : ''}{parsedCommand.port ? ` :${parsedCommand.port}` : ''}
          </p>
        </div>

        <div className="auth-methods">
          <button
            type="button"
            className={authMethod === 'key' ? 'auth-method-btn active' : 'auth-method-btn'}
            onClick={() => setAuthMethod('key')}
          >
            Private Key
          </button>
          <button
            type="button"
            className={authMethod === 'password' ? 'auth-method-btn active' : 'auth-method-btn'}
            onClick={() => setAuthMethod('password')}
          >
            Password
          </button>
          <button
            type="button"
            className={authMethod === 'none' ? 'auth-method-btn active' : 'auth-method-btn'}
            onClick={() => setAuthMethod('none')}
          >
            Vault/Profile Only
          </button>
        </div>

        {authMethod === 'key' && (
          <div className="auth-form">
            <div className="auth-actions-row">
              <button
                type="button"
                onClick={() => keyFileInputRef.current?.click()}
              >
                Upload key file
              </button>
              {authPrivateKeyFilename && <span className="hint">{authPrivateKeyFilename}</span>}
            </div>
            <input
              ref={keyFileInputRef as React.RefObject<HTMLInputElement>}
              type="file"
              className="hidden"
              accept=".pem,.key,.ppk,.txt,*/*"
              onChange={(event) => { onKeyFileSelected(event) }}
            />
            <textarea
              value={authPrivateKey}
              onChange={(event) => setAuthPrivateKey(event.target.value)}
              placeholder="Paste private key here"
              className="auth-textarea"
            />
            <label>
              Key passphrase (optional)
              <input
                value={authKeyPassphrase}
                onChange={(event) => setAuthKeyPassphrase(event.target.value)}
                type="password"
                placeholder="Key passphrase (optional)"
              />
            </label>
          </div>
        )}

        {authMethod === 'password' && (
          <div className="auth-form">
            <label>
              SSH password
              <input
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                type="password"
                placeholder="SSH password"
              />
            </label>
          </div>
        )}

        {authMethod === 'none' && (
          <p className="hint">
            Connect using vault-stored credentials or SSH agent profile. No per-session credentials needed.
          </p>
        )}

        {isHostAlreadySaved ? (
          <span className="host-saved-badge">✓ Host already saved in sidebar</span>
        ) : (
          <div className="save-host-box">
            <label className="save-host-row">
              <input
                type="checkbox"
                checked={saveHostEnabled}
                onChange={(event) => setSaveHostEnabled(event.target.checked)}
              />
              <span>Save host after connect</span>
            </label>

            {saveHostEnabled && (
              <>
                <input
                  value={saveHostLabel}
                  onChange={(event) => setSaveHostLabel(event.target.value)}
                  placeholder="Host label (e.g. Dokploy Prod)"
                />
                <p className="hint">
                  {vaultToken
                    ? 'Credentials will be encrypted in vault when provided.'
                    : 'No vault session token — host metadata will be saved but credentials cannot be stored.'}
                </p>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn-emerald"
            onClick={onConnect}
            disabled={busy}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TerminalSession
// ---------------------------------------------------------------------------

function TerminalSession({
  session,
  isActive,
  onResize,
}: {
  session: SessionTab
  isActive: boolean
  onResize: (sessionId: string, cols: number, rows: number) => Promise<void>
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const ctrlArmedRef = useRef(false)
  const [ctrlArmed, setCtrlArmed] = useState(false)

  useEffect(() => {
    ctrlArmedRef.current = ctrlArmed
  }, [ctrlArmed])

  const sendInput = useCallback((data: string) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      terminalRef.current?.writeln('\r\n\x1b[31mSession socket is not connected.\x1b[0m')
      return
    }
    socket.send(data)
  }, [])

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
      fontFamily: '"Fira Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.22,
      scrollback: 8000,
      theme: {
        background: '#0c1118',
        foreground: '#d6dfeb',
        cursor: '#00D492',
        cursorAccent: '#0a0f16',
        selectionBackground: 'rgba(0,212,146,0.25)',
      },
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const searchAddon = new SearchAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.loadAddon(searchAddon)

    try {
      const webglAddon = new WebglAddon()
      terminal.loadAddon(webglAddon)
      webglAddon.onContextLoss(() => webglAddon.dispose())
    } catch {
      // Optional addon: no-op if unsupported.
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    if (containerRef.current) {
      terminal.open(containerRef.current)
      fitAddon.fit()
    }

    terminal.writeln('\x1b[1;32mDaedalus SSH Workbench\x1b[0m')
    terminal.writeln(`Session: ${session.title}`)
    terminal.writeln('')

    const socket = new WebSocket(session.websocketUrl)
    socketRef.current = socket

    socket.onopen = () => {
      void onResize(session.id, terminal.cols, terminal.rows)
    }

    socket.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      if (!raw) return

      try {
        const parsed = JSON.parse(raw) as { type?: string; data?: string; message?: string; mode?: string; bind?: string; target?: string }

        if (parsed.type === 'ready') {
          return
        }

        if (parsed.type === 'output' && typeof parsed.data === 'string') {
          terminal.write(parsed.data)
          return
        }

        if (parsed.type === 'error') {
          terminal.writeln(`\r\n\x1b[31m${parsed.message ?? 'Session error'}\x1b[0m`)
          return
        }

        if (parsed.type === 'closed') {
          terminal.writeln('\r\n\x1b[33mSession closed.\x1b[0m')
          return
        }

        if (parsed.type === 'forward') {
          const target = parsed.target ? ` -> ${parsed.target}` : ''
          terminal.writeln(`\r\n\x1b[35mForward ${parsed.mode ?? ''}: ${parsed.bind ?? ''}${target}\x1b[0m`)
          return
        }

        terminal.write(raw)
      } catch {
        terminal.write(raw)
      }
    }

    socket.onerror = () => {
      terminal.writeln('\r\n\x1b[31mWebSocket error.\x1b[0m')
    }

    socket.onclose = () => {
      terminal.writeln('\r\n\x1b[33mWebSocket disconnected.\x1b[0m')
    }

    const onDataDisposable = terminal.onData((data) => {
      sendInput(data)
    })

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

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
          sendInput(String.fromCharCode(code))
          setCtrlArmed(false)
          return false
        }
      }

      return true
    })

    const onResizeDisposable = terminal.onResize((event) => {
      void onResize(session.id, event.cols, event.rows)
    })

    return () => {
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      socket.close()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      socketRef.current = null
    }
  }, [onResize, sendInput, session.id, session.title, session.websocketUrl])

  useEffect(() => {
    if (!isActive) return

    const timer = window.setTimeout(() => {
      fitAddonRef.current?.fit()
      terminalRef.current?.focus()
    }, 40)

    return () => window.clearTimeout(timer)
  }, [isActive])

  useEffect(() => {
    if (!isActive) return

    const handleViewportResize = () => {
      const fitAddon = fitAddonRef.current
      const term = terminalRef.current
      if (!fitAddon || !term) return

      fitAddon.fit()
      void onResize(session.id, term.cols, term.rows)
    }

    const debounced = window.setTimeout(() => handleViewportResize(), 60)
    window.addEventListener('resize', handleViewportResize)
    window.visualViewport?.addEventListener('resize', handleViewportResize)

    return () => {
      window.clearTimeout(debounced)
      window.removeEventListener('resize', handleViewportResize)
      window.visualViewport?.removeEventListener('resize', handleViewportResize)
    }
  }, [isActive, onResize, session.id])

  const handleControlPress = useCallback(async (control: MobileControl) => {
    if (control.action === 'ctrl') {
      setCtrlArmed((previous) => !previous)
      terminalRef.current?.focus()
      return
    }

    if (control.action === 'paste') {
      try {
        const text = await navigator.clipboard.readText()
        if (text) sendInput(text)
      } catch {
        terminalRef.current?.writeln('\r\n\x1b[31mClipboard access denied.\x1b[0m')
      }
      terminalRef.current?.focus()
      return
    }

    if (control.sequence) {
      sendInput(control.sequence)
      terminalRef.current?.focus()
    }
  }, [sendInput])

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTelegramUserIdFromContext(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('tgUserId')
  if (fromQuery) return fromQuery

  const tg = (window as any).Telegram?.WebApp
  const fromUnsafeUser = tg?.initDataUnsafe?.user?.id
  if (fromUnsafeUser) return String(fromUnsafeUser)

  const tryParseWebAppData = (raw: string | null): string | null => {
    if (!raw) return null

    try {
      const params = new URLSearchParams(raw)
      const userRaw = params.get('user')
      if (userRaw) {
        const parsed = JSON.parse(decodeURIComponent(userRaw))
        if (parsed?.id) return String(parsed.id)
      }
      const userId = params.get('user_id')
      if (userId) return String(userId)
    } catch {
      // ignore parse failures
    }

    return null
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const fromHash = tryParseWebAppData(hashParams.get('tgWebAppData'))
  if (fromHash) return fromHash

  const fromSearch = tryParseWebAppData(new URLSearchParams(window.location.search).get('tgWebAppData'))
  if (fromSearch) return fromSearch

  try {
    const stored = window.localStorage.getItem('daedalus:lastUserId')
    if (stored) return stored
  } catch {
    // ignore storage errors
  }

  return null
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const { user } = useTelegram()

  const derivedUserId = useMemo(() => {
    const fromContext = extractTelegramUserIdFromContext()
    if (fromContext) return fromContext
    if (user?.id) return String(user.id)
    return 'local-dev'
  }, [user])

  const apiClient = useMemo(() => createApiClient(derivedUserId), [derivedUserId])

  useEffect(() => {
    if (!derivedUserId || derivedUserId === 'local-dev') return
    try {
      window.localStorage.setItem('daedalus:lastUserId', derivedUserId)
    } catch {
      // ignore storage errors
    }
  }, [derivedUserId])

  const [sessions, setSessions] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>([])
  const [hostsError, setHostsError] = useState<string | null>(null)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null)
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [vaultToken, setVaultToken] = useState<string | null>(null)
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null)
  const [statusLine, setStatusLine] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const [showSessionDialog, setShowSessionDialog] = useState(false)
  const [sessionCommand, setSessionCommand] = useState('')
  const [authMethod, setAuthMethod] = useState<'key' | 'password' | 'none'>('key')
  const [authPassword, setAuthPassword] = useState('')
  const [authPrivateKey, setAuthPrivateKey] = useState('')
  const [authPrivateKeyFilename, setAuthPrivateKeyFilename] = useState('')
  const [authKeyPassphrase, setAuthKeyPassphrase] = useState('')
  const [saveHostEnabled, setSaveHostEnabled] = useState(false)
  const [saveHostLabel, setSaveHostLabel] = useState('')
  const keyFileInputRef = useRef<HTMLInputElement>(null)

  const parsedCommand = useMemo(() => parseSshCommand(sessionCommand.trim()), [sessionCommand])
  const vaultInitialized = Boolean(vaultStatus?.initialized)
  const vaultUnlocked = Boolean(vaultStatus?.unlocked)
  // Always require a local vault token — if the server session is still alive from a prior
  // page load, vaultStatus.unlocked can be true but vaultToken (React state) is null, which
  // means credentials would be silently dropped.  Force the user through the unlock form to
  // obtain a fresh token whenever we don't have one.
  const showVaultLockScreen = vaultStatus !== null && !vaultToken

  // True when the parsed SSH host+user is already present in the saved-hosts list.
  const isHostAlreadySaved = useMemo(() => {
    if (!parsedCommand.isSsh || !parsedCommand.host) return false
    return savedHosts.some(
      (h) =>
        h.hostname === parsedCommand.host &&
        (!parsedCommand.user || h.username === parsedCommand.user),
    )
  }, [parsedCommand, savedHosts])

  // When the parsed command resolves to a host that is already saved, clear the save flag
  // so that a stale checked-state cannot trigger a duplicate save on connect.
  useEffect(() => {
    if (isHostAlreadySaved) {
      setSaveHostEnabled(false)
    }
  }, [isHostAlreadySaved])

  // Auto-clear status line after 7 seconds
  useEffect(() => {
    if (!statusLine) return
    const timer = window.setTimeout(() => setStatusLine(null), 7000)
    return () => window.clearTimeout(timer)
  }, [statusLine])

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
  }, [apiClient])

  const refreshVaultStatus = useCallback(async () => {
    try {
      const status = await apiClient.getVaultStatus()
      setVaultStatus(status)
      if (!status.unlocked) {
        setVaultToken(null)
      }
    } catch {
      setVaultStatus(null)
      setVaultToken(null)
    }
  }, [apiClient])

  const handleDeleteHost = useCallback(async (host: SavedHost) => {
    const confirmed = window.confirm(`Delete saved host "${host.name}"?`)
    if (!confirmed) return

    setBusy(true)
    try {
      await apiClient.deleteSavedHost(host.id)
      await refreshSavedHosts()
      setStatusLine(`Deleted host: ${host.name}`)
    } catch (error) {
      if (error instanceof ApiError) {
        setStatusLine(`Failed to delete host: ${error.message}`)
      } else {
        setStatusLine('Failed to delete host.')
      }
    } finally {
      setBusy(false)
    }
  }, [apiClient, refreshSavedHosts])

  useEffect(() => {
    void refreshSavedHosts()
    void refreshVaultStatus()
  }, [refreshSavedHosts, refreshVaultStatus])

  useEffect(() => {
    const restore = async () => {
      try {
        const summaries = await apiClient.listSshSessions()
        const connected = summaries.filter((session) => session.connected)

        if (connected.length === 0) {
          setSessions([])
          setActiveSessionId(null)
          return
        }

        const restoredTabs: SessionTab[] = connected.map((session) => ({
          id: session.id,
          title: session.username ? `${session.username}@${session.host}` : session.host,
          websocketUrl: apiClient.getSessionWebsocketUrl(session.id),
        }))

        setSessions(restoredTabs)

        let preferredId: string | null = null
        try {
          preferredId = window.localStorage.getItem('daedalus:activeSessionId')
        } catch {
          preferredId = null
        }

        const resolvedActive = preferredId && restoredTabs.some((tab) => tab.id === preferredId)
          ? preferredId
          : restoredTabs[0]?.id ?? null

        setActiveSessionId(resolvedActive)

        if (restoredTabs.length > 0) {
          setStatusLine(`Restored ${restoredTabs.length} active session${restoredTabs.length > 1 ? 's' : ''}.`)
        }
      } catch {
        // ignore restore errors; session creation still works.
      }
    }

    void restore()
  }, [apiClient])

  useEffect(() => {
    if (!activeSessionId) return
    try {
      window.localStorage.setItem('daedalus:activeSessionId', activeSessionId)
    } catch {
      // ignore storage errors
    }
  }, [activeSessionId])

  const createSession = useCallback(async (
    rawCommand: string,
    titleOverride?: string,
    credentials?: SessionCredentials,
  ): Promise<boolean> => {
    if (!rawCommand.trim()) {
      setStatusLine('Command is required.')
      return false
    }

    setBusy(true)
    setStatusLine('Creating SSH session...')

    try {
      const created: CreateSshSessionResponse = await apiClient.createSshSession({
        rawCommand,
        vaultToken: vaultToken ?? undefined,
        ...credentials,
      })

      const nextTab: SessionTab = {
        id: created.sessionId,
        title: titleOverride ?? created.title ?? titleFromRawCommand(rawCommand),
        websocketUrl: created.websocketUrl,
      }

      setSessions((previous) => [nextTab, ...previous])
      setActiveSessionId(nextTab.id)
      setStatusLine(`Connected: ${nextTab.title}`)
      return true
    } catch (error) {
      if (error instanceof ApiError) {
        setStatusLine(`Failed to create session: ${error.message}`)
      } else {
        setStatusLine('Failed to create session.')
      }
      return false
    } finally {
      setBusy(false)
    }
  }, [apiClient, vaultToken])

  const closeSession = useCallback(async (sessionId: string) => {
    setSessions((previous) => {
      const remaining = previous.filter((session) => session.id !== sessionId)
      if (activeSessionId === sessionId) {
        const nextActive = remaining[0]?.id ?? null
        setActiveSessionId(nextActive)
        if (!nextActive) {
          try {
            window.localStorage.removeItem('daedalus:activeSessionId')
          } catch {
            // ignore storage errors
          }
        }
      }
      return remaining
    })

    try {
      await apiClient.closeSshSession(sessionId)
    } catch {
      // best effort
    }
  }, [activeSessionId, apiClient])

  const handleVaultInit = useCallback(async () => {
    if (!vaultPassphrase.trim()) {
      setStatusLine('Vault passphrase is required.')
      return
    }

    setBusy(true)
    try {
      const result = await apiClient.initVault(vaultPassphrase)
      setRecoveryPhrase(result.recoveryPhrase)
      setStatusLine('Vault initialized. Save your recovery phrase.')
      setVaultPassphrase('')
      await refreshVaultStatus()
    } catch (error) {
      setStatusLine(error instanceof ApiError ? error.message : 'Vault init failed.')
    } finally {
      setBusy(false)
    }
  }, [apiClient, refreshVaultStatus, vaultPassphrase])

  const handleVaultUnlock = useCallback(async () => {
    if (!vaultPassphrase.trim()) {
      setStatusLine('Vault passphrase is required.')
      return
    }

    setBusy(true)
    try {
      const result = await apiClient.unlockVault(vaultPassphrase)
      setVaultToken(result.token)
      setStatusLine('Vault unlocked.')
      setVaultPassphrase('')
      await refreshVaultStatus()
    } catch (error) {
      setStatusLine(error instanceof ApiError ? error.message : 'Vault unlock failed.')
    } finally {
      setBusy(false)
    }
  }, [apiClient, refreshVaultStatus, vaultPassphrase])

  const handleVaultLock = useCallback(async () => {
    if (!vaultToken) {
      setStatusLine('Vault is already locked.')
      return
    }

    setBusy(true)
    try {
      await apiClient.lockVault(vaultToken)
      setVaultToken(null)
      setStatusLine('Vault locked.')
      await refreshVaultStatus()
    } catch (error) {
      setStatusLine(error instanceof ApiError ? error.message : 'Vault lock failed.')
    } finally {
      setBusy(false)
    }
  }, [apiClient, refreshVaultStatus, vaultToken])

  const handleOpenSessionClick = useCallback((prefillCommand?: string) => {
    const command = prefillCommand ?? sessionCommand
    if (prefillCommand) {
      setSessionCommand(prefillCommand)
    }

    const parsed = parseSshCommand(command)
    setSaveHostLabel(parsed.host ? (parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host) : 'My Host')
    setSaveHostEnabled(false)

    setAuthMethod(prefillCommand ? 'none' : 'key')
    setAuthPassword('')
    setAuthPrivateKey('')
    setAuthPrivateKeyFilename('')
    setAuthKeyPassphrase('')
    setShowSessionDialog(true)
    setSidebarOpen(false)
  }, [sessionCommand])

  const handleAuthKeyFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const text = await file.text()
    setAuthPrivateKey(text)
    setAuthPrivateKeyFilename(file.name)
    setSaveHostEnabled(true)
    event.target.value = ''
  }, [])

  const handleConnectWithAuth = useCallback(async () => {
    const command = sessionCommand.trim()
    if (!command) {
      setStatusLine('Command is required.')
      return
    }

    let credentials: SessionCredentials | undefined

    if (authMethod === 'password') {
      if (!authPassword.trim()) {
        setStatusLine('Password is required for password auth.')
        return
      }
      credentials = { password: authPassword }
    }

    if (authMethod === 'key') {
      if (!authPrivateKey.trim()) {
        setStatusLine('Upload or paste a private key first.')
        return
      }
      credentials = {
        privateKey: authPrivateKey,
        passphrase: authKeyPassphrase.trim() || undefined,
      }
    }

    setShowSessionDialog(false)
    const connected = await createSession(command, undefined, credentials)

    if (!connected || !saveHostEnabled) {
      return
    }

    const parsed = parseSshCommand(command)
    if (!parsed.isSsh || !parsed.host || !parsed.user) {
      setStatusLine('Connected, but command could not be parsed for host save.')
      return
    }

    // Guard: never save a host that is already in the sidebar (stale saveHostEnabled).
    const alreadySaved = savedHosts.some(
      (h) => h.hostname === parsed.host && (!parsed.user || h.username === parsed.user),
    )
    if (alreadySaved) {
      setStatusLine(`Connected. Host ${parsed.user}@${parsed.host} is already saved.`)
      return
    }

    if (!vaultToken && credentials) {
      setStatusLine(
        `Connected. Warning: vault session token unavailable — host saved without credentials. Re-lock and unlock vault, then update credentials via the saved host.`,
      )
    }

    const credentialsForSave = vaultToken ? credentials : undefined

    try {
      await apiClient.createSavedHost({
        name: saveHostLabel.trim() || `${parsed.user}@${parsed.host}`,
        host: parsed.host,
        port: parsed.port ?? 22,
        username: parsed.user,
        vaultToken: vaultToken ?? undefined,
        credentials: credentialsForSave,
      })
      await refreshSavedHosts()
      if (credentialsForSave) {
        setStatusLine(`Connected and saved host with credentials: ${saveHostLabel.trim() || `${parsed.user}@${parsed.host}`}.`)
      } else {
        setStatusLine(`Connected and saved host: ${saveHostLabel.trim() || `${parsed.user}@${parsed.host}`}. Credentials were not stored (vault token unavailable).`)
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setStatusLine(`Connected, but failed to save host: ${error.message}`)
      } else {
        setStatusLine('Connected, but failed to save host.')
      }
    }
  }, [
    apiClient,
    authKeyPassphrase,
    authMethod,
    authPassword,
    authPrivateKey,
    createSession,
    refreshSavedHosts,
    savedHosts,
    saveHostEnabled,
    saveHostLabel,
    sessionCommand,
    vaultToken,
  ])

  // Classify status line text for styling
  const statusLineClass = useMemo(() => {
    if (!statusLine) return 'status-line'
    const lower = statusLine.toLowerCase()
    if (lower.includes('fail') || lower.includes('error') || lower.includes('denied') || lower.includes('warning')) {
      return 'status-line status-error'
    }
    return 'status-line status-success'
  }, [statusLine])

  return (
    <main className={`workbench-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}>
      <aside className="workbench-sidebar modern-sidebar">
        <div className="sidebar-top">
          <div>
            <h1>Daedalus SSH</h1>
            <p className="hint">User: {derivedUserId}</p>
            {derivedUserId === 'local-dev' && (
              <p className="error">Telegram user not detected; vault profile may be wrong.</p>
            )}
          </div>
          <div className="sidebar-actions">
            <button
              type="button"
              className={`vault-indicator${vaultUnlocked ? ' unlocked' : ''}`}
              onClick={() => {
                if (vaultUnlocked) {
                  void handleVaultLock()
                }
              }}
              title={vaultUnlocked ? 'Vault unlocked (click to lock)' : 'Vault locked'}
            >
              {vaultUnlocked ? '🔓' : '🔒'}
            </button>
            <button
              type="button"
              className="vault-indicator sidebar-close-btn"
              onClick={() => setSidebarOpen(false)}
              title="Close menu"
              aria-label="Close sidebar"
            >
              ✕
            </button>
          </div>
        </div>

        <button
          type="button"
          className="btn-emerald new-session-btn"
          disabled={busy}
          onClick={() => handleOpenSessionClick()}
        >
          + New Session
        </button>

        <div className="sidebar-section">
          <div className="panel-header">
            <h2>Saved Hosts</h2>
            <button type="button" onClick={() => void refreshSavedHosts()}>↻</button>
          </div>

          {hostsError && <p className="error">{hostsError}</p>}
          {!hostsError && savedHosts.length === 0 && (
            <div className="hosts-empty">
              <span>No saved hosts yet.</span>
              <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>Connect and save a host to see it here.</span>
            </div>
          )}

          <nav className="hosts-nav">
            {savedHosts.map((host) => {
              const portSuffix = host.port && host.port !== 22 ? ` -p ${host.port}` : ''
              const command = `ssh ${host.username ? `${host.username}@` : ''}${host.hostname}${portSuffix}`
              return (
                <div key={host.id} className="host-nav-item">
                  <button
                    type="button"
                    className="host-nav-launch"
                    onClick={() => handleOpenSessionClick(command)}
                  >
                    <span className="host-dot" />
                    <span className="host-meta">
                      <strong>{host.name}</strong>
                      <small>{command}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="host-nav-delete"
                    onClick={() => { void handleDeleteHost(host) }}
                    title={`Delete ${host.name}`}
                    aria-label={`Delete ${host.name}`}
                    disabled={busy}
                  >
                    🗑
                  </button>
                </div>
              )
            })}
          </nav>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      <section className={`workbench-main${sidebarOpen ? ' main-sidebar-open' : ''}`}>
        <div className="tabs">
          <button
            type="button"
            className="tab icon-toggle"
            onClick={() => setSidebarOpen((current) => !current)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? '▤' : '☰'}
          </button>

          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={session.id === activeSessionId ? 'tab active' : 'tab'}
              onClick={() => setActiveSessionId(session.id)}
            >
              <span>{session.title}</span>
              <button
                type="button"
                className="tab-close-btn"
                onClick={(event) => {
                  event.stopPropagation()
                  void closeSession(session.id)
                }}
                aria-label={`Close ${session.title}`}
              >
                ×
              </button>
            </button>
          ))}
          {sessions.length === 0 && <p className="hint empty-tabs">No active sessions.</p>}
        </div>

        <div className="terminal-area">
          {sessions.length === 0 && (
            <div className="terminal-empty">
              <span className="terminal-empty-logo">Daedalus</span>
              <span className="terminal-empty-hint">Open a new session to get started</span>
            </div>
          )}
          {sessions.map((session) => (
            <TerminalSession
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onResize={async (sessionId, cols, rows) => {
                try {
                  await apiClient.resizeSshSession(sessionId, cols, rows)
                } catch {
                  // best effort
                }
              }}
            />
          ))}
        </div>

        {statusLine && <p className={statusLineClass}>{statusLine}</p>}
      </section>

      {showVaultLockScreen && (
        <VaultScreen
          vaultInitialized={vaultInitialized}
          vaultPassphrase={vaultPassphrase}
          setVaultPassphrase={setVaultPassphrase}
          busy={busy}
          recoveryPhrase={recoveryPhrase}
          onInit={() => { void handleVaultInit() }}
          onUnlock={() => { void handleVaultUnlock() }}
        />
      )}

      {showSessionDialog && (
        <SessionDialog
          sessionCommand={sessionCommand}
          setSessionCommand={setSessionCommand}
          parsedCommand={parsedCommand}
          authMethod={authMethod}
          setAuthMethod={setAuthMethod}
          authPassword={authPassword}
          setAuthPassword={setAuthPassword}
          authPrivateKey={authPrivateKey}
          setAuthPrivateKey={setAuthPrivateKey}
          authPrivateKeyFilename={authPrivateKeyFilename}
          authKeyPassphrase={authKeyPassphrase}
          setAuthKeyPassphrase={setAuthKeyPassphrase}
          saveHostEnabled={saveHostEnabled}
          setSaveHostEnabled={setSaveHostEnabled}
          saveHostLabel={saveHostLabel}
          setSaveHostLabel={setSaveHostLabel}
          isHostAlreadySaved={isHostAlreadySaved}
          vaultToken={vaultToken}
          busy={busy}
          keyFileInputRef={keyFileInputRef}
          onKeyFileSelected={(event) => { void handleAuthKeyFileSelected(event) }}
          onConnect={() => { void handleConnectWithAuth() }}
          onCancel={() => setShowSessionDialog(false)}
        />
      )}
    </main>
  )
}

export default App
