import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposeProject, TaskEvent } from '../../api/client'

type ComposeApiClient = {
  getComposeProjects: () => Promise<ComposeProject[]>
  streamComposeTask: (
    projectName: string,
    configFile: string,
    service: string,
    args: string[],
    onEvent: (event: TaskEvent) => void,
    signal?: AbortSignal,
  ) => Promise<number>
}

type Props = {
  apiClient: ComposeApiClient
}

type RunState = {
  projectName: string
  service: string
  running: boolean
  exitCode: number | null
  lines: Array<{ kind: 'stdout' | 'stderr' | 'system'; text: string }>
}

// ---------------------------------------------------------------------------
// TaskOutput – auto-scrolling output terminal
// ---------------------------------------------------------------------------

type TaskOutputProps = {
  lines: RunState['lines']
  running: boolean
  exitCode: number | null
}

function TaskOutput({ lines, running, exitCode }: TaskOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines.length])

  return (
    <div className="compose-output">
      {lines.map((line, i) => (
        <span
          key={i}
          className={`compose-line compose-line-${line.kind}`}
        >
          {line.text}
        </span>
      ))}
      {running && <span className="compose-line compose-line-system">▌</span>}
      {!running && exitCode !== null && (
        <span className={`compose-line compose-line-system${exitCode === 0 ? ' ok' : ' fail'}`}>
          {exitCode === 0 ? '✓ Exited 0' : `✗ Exited ${exitCode}`}
        </span>
      )}
      <div ref={bottomRef} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ServiceRow
// ---------------------------------------------------------------------------

type ServiceRowProps = {
  configFile: string
  service: import('../../api/client').ComposeCliService
  runState: RunState | null
  onRun: (args: string[]) => void
  onAbort: () => void
}

function ServiceRow({ service, runState, onRun, onAbort }: ServiceRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [customArgs, setCustomArgs] = useState('')
  const running = runState?.running ?? false

  return (
    <div className="compose-service-row">
      <div className="compose-service-header">
        <div className="compose-service-info">
          <strong className="compose-service-name">{service.name}</strong>
          {service.image && <span className="compose-service-image">{service.image}</span>}
          {service.description && (
            <span className="compose-service-desc">{service.description}</span>
          )}
        </div>
        <div className="compose-service-actions">
          {!running && (
            <button
              type="button"
              className="btn-emerald compose-run-btn"
              onClick={() => {
                const args = customArgs.trim()
                  ? customArgs.trim().split(/\s+/)
                  : []
                onRun(args)
                setExpanded(true)
              }}
            >
              ▶ Run
            </button>
          )}
          {running && (
            <button type="button" className="compose-abort-btn" onClick={onAbort}>
              ■ Stop
            </button>
          )}
          <button
            type="button"
            className="compose-expand-btn"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="compose-service-detail">
          <div className="compose-args-row">
            <input
              className="compose-args-input"
              value={customArgs}
              onChange={(e) => setCustomArgs(e.target.value)}
              placeholder="Extra arguments (optional)"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !running) {
                  const args = customArgs.trim() ? customArgs.trim().split(/\s+/) : []
                  onRun(args)
                }
              }}
            />
          </div>

          {service.command && (
            <div className="compose-service-cmd">
              <span className="docker-hint">default cmd:</span> <code>{service.command}</code>
            </div>
          )}

          {runState && (
            <TaskOutput
              lines={runState.lines}
              running={runState.running}
              exitCode={runState.exitCode}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ComposeRunner (main export)
// ---------------------------------------------------------------------------

export function ComposeRunner({ apiClient }: Props) {
  const [projects, setProjects] = useState<ComposeProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runStates, setRunStates] = useState<Map<string, RunState>>(new Map())
  const abortRefs = useRef<Map<string, AbortController>>(new Map())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await apiClient.getComposeProjects()
      setProjects(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compose projects')
    } finally {
      setLoading(false)
    }
  }, [apiClient])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runKey = (projectName: string, service: string) => `${projectName}::${service}`

  const handleRun = useCallback(
    async (
      projectName: string,
      configFile: string,
      service: string,
      args: string[],
    ) => {
      const key = runKey(projectName, service)

      // Abort any existing run for this key
      abortRefs.current.get(key)?.abort()

      const ac = new AbortController()
      abortRefs.current.set(key, ac)

      setRunStates((prev) => {
        const next = new Map(prev)
        next.set(key, {
          projectName,
          service,
          running: true,
          exitCode: null,
          lines: [{ kind: 'system', text: `$ docker compose run --rm ${service} ${args.join(' ')}\n` }],
        })
        return next
      })

      const appendLine = (kind: 'stdout' | 'stderr' | 'system', text: string) => {
        setRunStates((prev) => {
          const next = new Map(prev)
          const current = next.get(key)
          if (!current) return prev
          // Split by newlines to properly handle multi-line chunks
          const parts = text.split(/(\n)/).filter(Boolean)
          const newLines = parts.map((p) => ({ kind, text: p }))
          next.set(key, { ...current, lines: [...current.lines, ...newLines] })
          return next
        })
      }

      try {
        await apiClient.streamComposeTask(
          projectName,
          configFile,
          service,
          args,
          (event) => {
            if (event.type === 'stdout' && event.data) {
              appendLine('stdout', event.data)
            } else if (event.type === 'stderr' && event.data) {
              appendLine('stderr', event.data)
            } else if (event.type === 'error' && event.message) {
              appendLine('system', `Error: ${event.message}\n`)
            }
          },
          ac.signal,
        )
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          appendLine('system', `Error: ${err.message}\n`)
        }
      }

      setRunStates((prev) => {
        const next = new Map(prev)
        const current = next.get(key)
        if (!current) return prev
        next.set(key, { ...current, running: false, exitCode: current.exitCode ?? 0 })
        return next
      })

      abortRefs.current.delete(key)
    },
    [apiClient],
  )

  const handleAbort = useCallback((projectName: string, service: string) => {
    const key = runKey(projectName, service)
    abortRefs.current.get(key)?.abort()
    setRunStates((prev) => {
      const next = new Map(prev)
      const current = next.get(key)
      if (current) {
        next.set(key, { ...current, running: false, exitCode: -1 })
      }
      return next
    })
  }, [])

  const cliProjects = projects.filter((p) => p.services.length > 0)

  return (
    <div className="compose-runner">
      <div className="compose-runner-header">
        <h2 className="docker-explorer-title">
          <span>⚡</span> Compose Task Runner
        </h2>
        <button
          type="button"
          className="docker-action-btn"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {error && <p className="docker-error">{error}</p>}

      {!loading && cliProjects.length === 0 && (
        <div className="docker-empty">
          <span>No compose projects with CLI services found.</span>
          <p className="docker-hint">
            Add <code>profiles: [cli]</code> to services in your docker-compose.yml files.
          </p>
        </div>
      )}

      {cliProjects.map((project) => (
        <div key={project.name} className="compose-project glass">
          <div className="compose-project-header">
            <div>
              <strong className="compose-project-name">{project.name}</strong>
              <span
                className={`compose-project-status${project.status.includes('running') ? ' running' : ''}`}
              >
                {project.status}
              </span>
            </div>
            <span className="docker-hint">{project.configFiles[0]}</span>
          </div>

          <div className="compose-services">
            {project.services.map((service) => {
              const key = runKey(project.name, service.name)
              return (
                <ServiceRow
                  key={key}
                  configFile={project.configFiles[0]}
                  service={service}
                  runState={runStates.get(key) ?? null}
                  onRun={(args) =>
                    void handleRun(project.name, project.configFiles[0], service.name, args)
                  }
                  onAbort={() => handleAbort(project.name, service.name)}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
