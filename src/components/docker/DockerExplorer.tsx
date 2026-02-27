import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type {
  DockerContainerInfo,
  DockerContainerSummary,
  DockerFileEntry,
  DockerFilePreview,
  TmuxStatus,
} from '../../api/client'

type DockerApiClient = {
  checkDockerHealth: () => Promise<boolean>
  listDockerContainers: (all?: boolean) => Promise<DockerContainerSummary[]>
  inspectDockerContainer: (id: string) => Promise<DockerContainerInfo>
  getDockerTmuxSessions: (id: string) => Promise<TmuxStatus>
  listDockerContainerFiles: (id: string, path: string) => Promise<DockerFileEntry[]>
  previewDockerContainerFile: (id: string, path: string, limit?: number) => Promise<DockerFilePreview>
  getContainerExecWsUrl: (containerId: string) => string
}

type Props = {
  apiClient: DockerApiClient
  onOpenExec?: (containerId: string, containerName: string) => void
}

// ---------------------------------------------------------------------------
// ContainerExecTerminal
// ---------------------------------------------------------------------------

type TerminalProps = {
  wsUrl: string
  onClose: () => void
}

export function ContainerExecTerminal({ wsUrl, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'IBM Plex Mono', monospace",
      theme: { background: '#070b10', foreground: '#eafff6', cursor: '#00D492' },
      cursorBlink: true,
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

    ws.onopen = () => {
      term.writeln('\x1b[2m[Connected to container exec...]\x1b[0m')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string
          data?: string
          message?: string
        }
        if (msg.type === 'output' && msg.data) {
          const binary = atob(msg.data)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          term.write(bytes)
        } else if (msg.type === 'closed') {
          term.writeln('\r\n\x1b[2m[Session closed]\x1b[0m')
        } else if (msg.type === 'error') {
          term.writeln(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m`)
        } else if (msg.type === 'ready') {
          if (ws.readyState === WebSocket.OPEN && termRef.current) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols: termRef.current.cols,
              rows: termRef.current.rows,
            }))
          }
        }
      } catch {
        // ignore
      }
    }

    ws.onclose = () => {
      term.writeln('\r\n\x1b[2m[Connection closed]\x1b[0m')
    }

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31m[WebSocket error]\x1b[0m')
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    const handleResize = () => {
      fitAddon.fit()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      ws.close()
      term.dispose()
    }
  }, [wsUrl])

  return (
    <div className="docker-exec-terminal-wrap">
      <div className="docker-exec-terminal-bar">
        <span className="docker-exec-label">Container Shell</span>
        <button type="button" className="docker-close-btn" onClick={onClose}>
          ✕ Close
        </button>
      </div>
      <div ref={containerRef} className="docker-exec-terminal" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContainerFiles
// ---------------------------------------------------------------------------

type FilesProps = {
  containerId: string
  apiClient: DockerApiClient
  onClose: () => void
}

function ContainerFiles({ containerId, apiClient, onClose }: FilesProps) {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<DockerFileEntry[]>([])
  const [preview, setPreview] = useState<DockerFilePreview | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const loadDir = useCallback(
    async (dirPath: string) => {
      setLoading(true)
      setError(null)
      setPreview(null)
      setSelectedPath(null)
      try {
        const result = await apiClient.listDockerContainerFiles(containerId, dirPath)
        setEntries(result)
        setPath(dirPath)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to list files')
      } finally {
        setLoading(false)
      }
    },
    [apiClient, containerId],
  )

  useEffect(() => {
    void loadDir('/')
  }, [loadDir])

  const handleEntry = useCallback(
    async (entry: DockerFileEntry) => {
      if (entry.type === 'dir' || entry.type === 'symlink') {
        await loadDir(entry.path)
        return
      }
      setSelectedPath(entry.path)
      setPreviewLoading(true)
      setPreview(null)
      try {
        const data = await apiClient.previewDockerContainerFile(containerId, entry.path)
        setPreview(data)
      } catch {
        setPreview(null)
      } finally {
        setPreviewLoading(false)
      }
    },
    [apiClient, containerId, loadDir],
  )

  const handleUp = useCallback(() => {
    const parent = path.split('/').slice(0, -1).join('/') || '/'
    void loadDir(parent)
  }, [loadDir, path])

  const pathSegments = path.split('/').filter(Boolean)

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n}B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`
    return `${(n / (1024 * 1024)).toFixed(1)}M`
  }

  return (
    <div className="docker-files-panel">
      <div className="docker-files-header">
        <div className="docker-breadcrumb">
          <button type="button" onClick={() => void loadDir('/')} className="docker-bc-seg">
            /
          </button>
          {pathSegments.map((seg, i) => {
            const segPath = '/' + pathSegments.slice(0, i + 1).join('/')
            return (
              <span key={segPath} className="docker-bc-item">
                <span className="docker-bc-sep">/</span>
                <button type="button" className="docker-bc-seg" onClick={() => void loadDir(segPath)}>
                  {seg}
                </button>
              </span>
            )
          })}
        </div>
        <div className="docker-files-actions">
          {path !== '/' && (
            <button type="button" className="docker-action-btn" onClick={handleUp}>
              ↑ Up
            </button>
          )}
          <button type="button" className="docker-action-btn" onClick={() => void loadDir(path)}>
            ↻
          </button>
          <button type="button" className="docker-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {error && <p className="docker-error">{error}</p>}

      <div className="docker-files-body">
        <div className="docker-files-list">
          {loading && <p className="docker-hint">Loading…</p>}
          {!loading && entries.length === 0 && <p className="docker-hint">Empty directory</p>}
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`docker-file-row${selectedPath === entry.path ? ' selected' : ''}`}
              onClick={() => void handleEntry(entry)}
            >
              <span className="docker-file-icon">
                {entry.type === 'dir' ? '📁' : entry.type === 'symlink' ? '🔗' : '📄'}
              </span>
              <span className="docker-file-name">{entry.name}</span>
              <span className="docker-file-size">
                {entry.type !== 'dir' ? formatBytes(entry.size) : ''}
              </span>
            </button>
          ))}
        </div>

        {(previewLoading || preview) && (
          <div className="docker-file-preview">
            {previewLoading && <p className="docker-hint">Loading preview…</p>}
            {preview && !previewLoading && (
              <>
                <div className="docker-preview-meta">
                  <span>{selectedPath}</span>
                  <span>{formatBytes(preview.size)}</span>
                  {preview.truncated && (
                    <span className="docker-hint">(truncated)</span>
                  )}
                </div>
                {preview.kind === 'binary' ? (
                  <p className="docker-hint">Binary file — cannot preview</p>
                ) : (
                  <pre className="docker-preview-text">{preview.data}</pre>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContainerDetail
// ---------------------------------------------------------------------------

type DetailProps = {
  container: DockerContainerSummary
  apiClient: DockerApiClient
  onClose: () => void
  onOpenExec?: (containerId: string, containerName: string) => void
}

function ContainerDetail({ container, apiClient, onClose, onOpenExec }: DetailProps) {
  const [view, setView] = useState<'overview' | 'files' | 'terminal'>('overview')
  const [info, setInfo] = useState<DockerContainerInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [tmux, setTmux] = useState<TmuxStatus | null>(null)
  const [tmuxExpanded, setTmuxExpanded] = useState(false)

  useEffect(() => {
    setInfoLoading(true)
    apiClient
      .inspectDockerContainer(container.id)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setInfoLoading(false))
  }, [apiClient, container.id])

  useEffect(() => {
    let cancelled = false

    const loadTmux = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const status = await apiClient.getDockerTmuxSessions(container.id)
        if (!cancelled) setTmux(status)
      } catch (error) {
        if (!cancelled) {
          setTmux({
            available: true,
            status: 'error',
            sessions: [],
            error: error instanceof Error ? error.message : 'Failed to check tmux',
          })
        }
      }
    }

    void loadTmux()
    const timer = window.setInterval(() => { void loadTmux() }, 15000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadTmux()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [apiClient, container.id])

  const execWsUrl = apiClient.getContainerExecWsUrl(container.id)

  return (
    <div className="docker-detail-panel glass">
      <div className="docker-detail-header">
        <div>
          <strong className="docker-detail-name">
            {container.names[0] ?? container.shortId}
          </strong>
          <span className={`docker-state-badge ${container.state}`}>
            {container.state}
          </span>
        </div>
        <button type="button" className="docker-close-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="docker-detail-tabs">
        {(['overview', 'files', 'terminal'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`docker-detail-tab${view === tab ? ' active' : ''}${tab !== 'overview' && !container.state.includes('running') ? ' disabled' : ''}`}
            onClick={() => {
              if (tab === 'terminal' && onOpenExec) {
                onOpenExec(container.id, container.names[0] ?? container.shortId)
              } else {
                setView(tab)
              }
            }}
            disabled={tab !== 'overview' && !container.state.includes('running')}
          >
            {tab === 'overview' ? 'Overview' : tab === 'files' ? 'Files' : 'Terminal'}
          </button>
        ))}
      </div>

      <div className="docker-detail-body">
        {view === 'overview' && (
          <div className="docker-overview">
            <div className="docker-tmux-block">
              <button
                type="button"
                className="docker-action-btn"
                onClick={() => setTmuxExpanded((current) => !current)}
              >
                TMUX · {tmux ? (tmux.status === 'ok' ? `${tmux.sessions.length} session${tmux.sessions.length === 1 ? '' : 's'}` : tmux.status) : '…'}
              </button>
              <button
                type="button"
                className="docker-action-btn"
                onClick={() => { void apiClient.getDockerTmuxSessions(container.id).then(setTmux).catch(() => {}) }}
              >
                ↻
              </button>
            </div>
            {tmuxExpanded && tmux && (
              <div className="docker-tmux-list">
                {tmux.status === 'ok' && tmux.sessions.length > 0 && tmux.sessions.map((s) => (
                  <div key={s.name} className="docker-tmux-row">
                    <div className="docker-tmux-info">
                      <strong>{s.name}</strong>
                      <span>{s.windows}w{s.attached ? ' · attached' : ''}</span>
                    </div>
                    <button
                      type="button"
                      className="docker-action-btn small"
                      title="Copy attach command"
                      onClick={() => { void navigator.clipboard.writeText(`docker exec -it ${(container.names?.[0] || container.id).replace('/', '')} tmux attach -t ${s.name}`) }}
                    >
                      📋
                    </button>
                  </div>
                ))}
                {tmux.status === 'ok' && tmux.sessions.length === 0 && <p className="docker-hint">No tmux sessions</p>}
                {tmux.status === 'no-server' && <p className="docker-hint">tmux server not running</p>}
                {tmux.status === 'not-installed' && <p className="docker-hint">tmux not installed</p>}
                {tmux.status === 'error' && <p className="docker-error">{tmux.error ?? 'tmux check failed'}</p>}
              </div>
            )}
            {infoLoading && <p className="docker-hint">Loading…</p>}
            {info && (
              <>
                <table className="docker-meta-table">
                  <tbody>
                    <tr>
                      <td>ID</td>
                      <td><code>{info.id.slice(0, 12)}</code></td>
                    </tr>
                    <tr>
                      <td>Image</td>
                      <td>{info.image}</td>
                    </tr>
                    <tr>
                      <td>Status</td>
                      <td>{info.state.status}</td>
                    </tr>
                    <tr>
                      <td>PID</td>
                      <td>{info.state.pid > 0 ? info.state.pid : '—'}</td>
                    </tr>
                    <tr>
                      <td>Hostname</td>
                      <td>{info.config.hostname}</td>
                    </tr>
                    <tr>
                      <td>WorkDir</td>
                      <td>{info.config.workingDir || '/'}</td>
                    </tr>
                    <tr>
                      <td>IP</td>
                      <td>{info.networkSettings.ipAddress || '—'}</td>
                    </tr>
                  </tbody>
                </table>

                {container.ports.length > 0 && (
                  <div className="docker-section">
                    <h4>Ports</h4>
                    {container.ports.map((p, i) => (
                      <div key={i} className="docker-port-row">
                        {p.publicPort ? `${p.ip ?? '0.0.0.0'}:${p.publicPort}→` : ''}{p.privatePort}/{p.type}
                      </div>
                    ))}
                  </div>
                )}

                {info.config.cmd.length > 0 && (
                  <div className="docker-section">
                    <h4>Command</h4>
                    <code className="docker-cmd">{info.config.cmd.join(' ')}</code>
                  </div>
                )}

                {info.mounts.length > 0 && (
                  <div className="docker-section">
                    <h4>Mounts</h4>
                    {info.mounts.map((m, i) => (
                      <div key={i} className="docker-mount-row">
                        <span className="docker-hint">{m.type}</span> {m.source} → {m.destination}
                      </div>
                    ))}
                  </div>
                )}

                {info.config.env.length > 0 && (
                  <div className="docker-section">
                    <h4>Environment</h4>
                    <div className="docker-env-list">
                      {info.config.env.slice(0, 20).map((e, i) => (
                        <div key={i} className="docker-env-row">{e}</div>
                      ))}
                      {info.config.env.length > 20 && (
                        <div className="docker-hint">…{info.config.env.length - 20} more</div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {view === 'files' && (
          <ContainerFiles
            containerId={container.id}
            apiClient={apiClient}
            onClose={() => setView('overview')}
          />
        )}

        {view === 'terminal' && (
          <ContainerExecTerminal wsUrl={execWsUrl} onClose={() => setView('overview')} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DockerExplorer (main export)
// ---------------------------------------------------------------------------

export function DockerExplorer({ apiClient, onOpenExec }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [containers, setContainers] = useState<DockerContainerSummary[]>([])
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DockerContainerSummary | null>(null)

  const refresh = useCallback(
    async (all: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const ok = await apiClient.checkDockerHealth()
        setAvailable(ok)
        if (!ok) {
          setContainers([])
          return
        }
        const list = await apiClient.listDockerContainers(all)
        setContainers(list)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Docker unavailable')
        setAvailable(false)
      } finally {
        setLoading(false)
      }
    },
    [apiClient],
  )

  useEffect(() => {
    void refresh(showAll)
  }, [refresh, showAll])

  const formatCreated = (ts: number) => {
    const d = new Date(ts * 1000)
    return d.toLocaleDateString()
  }

  if (available === false) {
    return (
      <div className="docker-unavailable">
        <span className="docker-unavail-icon">🐳</span>
        <h3>Docker not available</h3>
        <p className="docker-hint">
          {error ?? 'Docker daemon is not running or /var/run/docker.sock is not accessible.'}
        </p>
        <button type="button" className="docker-action-btn" onClick={() => void refresh(showAll)}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="docker-explorer">
      <div className="docker-explorer-header">
        <h2 className="docker-explorer-title">
          <span className="docker-whale">🐳</span> Docker Explorer
        </h2>
        <div className="docker-explorer-actions">
          <label className="docker-toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            All containers
          </label>
          <button
            type="button"
            className="docker-action-btn"
            onClick={() => void refresh(showAll)}
            disabled={loading}
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && <p className="docker-error">{error}</p>}

      {available === null && <p className="docker-hint">Connecting to Docker…</p>}

      {available && (
        <div className="docker-explorer-body">
          <div className={`docker-container-list${selected ? ' with-detail' : ''}`}>
            {containers.length === 0 && !loading && (
              <div className="docker-empty">
                <span>No containers found.</span>
                {!showAll && (
                  <button
                    type="button"
                    className="docker-action-btn"
                    onClick={() => setShowAll(true)}
                  >
                    Show stopped containers
                  </button>
                )}
              </div>
            )}
            {containers.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`docker-container-card glass-hover${selected?.id === c.id ? ' active' : ''}`}
                onClick={() => setSelected(selected?.id === c.id ? null : c)}
              >
                <div className="docker-card-top">
                  <span className="docker-card-name">
                    {c.names[0] ?? c.shortId}
                  </span>
                  <span className={`docker-state-badge ${c.state}`}>
                    {c.state}
                  </span>
                </div>
                <div className="docker-card-image">{c.image}</div>
                <div className="docker-card-meta">
                  <span>{c.status}</span>
                  <span>{formatCreated(c.created)}</span>
                </div>
                {c.ports.filter((p) => p.publicPort).length > 0 && (
                  <div className="docker-card-ports">
                    {c.ports
                      .filter((p) => p.publicPort)
                      .map((p, i) => (
                        <span key={i} className="docker-port-pill">
                          {p.publicPort}:{p.privatePort}
                        </span>
                      ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          {selected && (
            <ContainerDetail
              container={selected}
              apiClient={apiClient}
              onClose={() => setSelected(null)}
              onOpenExec={onOpenExec}
            />
          )}
        </div>
      )}
    </div>
  )
}
