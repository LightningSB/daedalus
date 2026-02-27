import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposeProject, TaskEvent } from '../../api/client'

type ApiClient = {
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
  apiClient: ApiClient
}

// Quick actions for openclaw-cli
const QUICK_ACTIONS: Array<{ label: string; args: string[]; description: string }> = [
  { label: 'Status', args: ['status'], description: 'Show current status' },
  { label: 'List', args: ['list'], description: 'List available items' },
  { label: 'Help', args: ['--help'], description: 'Show help' },
  { label: 'Version', args: ['--version'], description: 'Show version' },
]

type OutputLine = { kind: 'stdout' | 'stderr' | 'system'; text: string }

export function OpenclawCLI({ apiClient }: Props) {
  const [project, setProject] = useState<ComposeProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [customCmd, setCustomCmd] = useState('')
  const [output, setOutput] = useState<OutputLine[]>([])
  const [running, setRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Auto-scroll output
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
  }, [output.length])

  // Find openclaw-cli project
  useEffect(() => {
    setLoading(true)
    apiClient
      .getComposeProjects()
      .then((projects) => {
        const found = projects.find((p) =>
          p.services.some((s) => s.name === 'openclaw-cli' || s.name.includes('openclaw')),
        )
        setProject(found ?? null)
        if (!found) setError('openclaw-cli service not found in any compose project')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load projects')
      })
      .finally(() => setLoading(false))
  }, [apiClient])

  const cliService = project?.services.find(
    (s) => s.name === 'openclaw-cli' || s.name.includes('openclaw'),
  )

  const runCommand = useCallback(
    async (args: string[]) => {
      if (!project || !cliService) return

      // Abort previous run
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      setRunning(true)
      setExitCode(null)
      setOutput([
        {
          kind: 'system',
          text: `$ openclaw-cli ${args.join(' ')}\n`,
        },
      ])

      try {
        const code = await apiClient.streamComposeTask(
          project.name,
          project.configFiles[0],
          cliService.name,
          args,
          (event) => {
            if (event.type === 'stdout' && event.data) {
              setOutput((prev) => [...prev, { kind: 'stdout', text: event.data! }])
            } else if (event.type === 'stderr' && event.data) {
              setOutput((prev) => [...prev, { kind: 'stderr', text: event.data! }])
            } else if (event.type === 'error' && event.message) {
              setOutput((prev) => [
                ...prev,
                { kind: 'system', text: `Error: ${event.message}\n` },
              ])
            }
          },
          ac.signal,
        )
        setExitCode(code)
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setOutput((prev) => [
            ...prev,
            { kind: 'system', text: `Error: ${err.message}\n` },
          ])
        }
      } finally {
        setRunning(false)
      }
    },
    [apiClient, cliService, project],
  )

  const handleAbort = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
    setOutput((prev) => [...prev, { kind: 'system', text: '(Aborted)\n' }])
  }, [])

  const handleCustomRun = useCallback(() => {
    const trimmed = customCmd.trim()
    if (!trimmed) return
    const args = trimmed.split(/\s+/)
    void runCommand(args)
  }, [customCmd, runCommand])

  if (loading) {
    return <div className="openclaw-cli"><p className="docker-hint">Loading openclaw-cli…</p></div>
  }

  if (error || !project || !cliService) {
    return (
      <div className="openclaw-cli">
        <div className="openclaw-header">
          <span className="openclaw-claw">🦀</span>
          <h2>openclaw-cli</h2>
        </div>
        <div className="docker-unavailable">
          <p className="docker-hint">
            {error ?? 'Service not found. Make sure a compose service named "openclaw-cli" has profiles: [cli].'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="openclaw-cli">
      <div className="openclaw-header">
        <div>
          <span className="openclaw-claw">🦀</span>
          <h2>openclaw-cli</h2>
          {cliService.description && (
            <p className="docker-hint">{cliService.description}</p>
          )}
          {cliService.image && (
            <p className="openclaw-image">{cliService.image}</p>
          )}
        </div>
        <span className="openclaw-project">{project.name}</span>
      </div>

      {/* Quick Actions */}
      <div className="openclaw-quickactions">
        <span className="openclaw-section-label">Quick Actions</span>
        <div className="openclaw-qa-grid">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.label}
              type="button"
              className="openclaw-qa-btn glass-hover"
              onClick={() => void runCommand(qa.args)}
              disabled={running}
              title={qa.description}
            >
              {qa.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Command */}
      <div className="openclaw-custom">
        <span className="openclaw-section-label">Custom Command</span>
        <div className="openclaw-cmd-row">
          <span className="openclaw-prompt">openclaw-cli</span>
          <input
            className="openclaw-cmd-input"
            value={customCmd}
            onChange={(e) => setCustomCmd(e.target.value)}
            placeholder="arguments…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running) handleCustomRun()
            }}
            disabled={running}
          />
          {!running && (
            <button
              type="button"
              className="btn-emerald openclaw-run-btn"
              onClick={handleCustomRun}
              disabled={!customCmd.trim()}
            >
              ▶ Run
            </button>
          )}
          {running && (
            <button type="button" className="compose-abort-btn" onClick={handleAbort}>
              ■ Stop
            </button>
          )}
        </div>
      </div>

      {/* Output */}
      {output.length > 0 && (
        <div className="openclaw-output-wrap">
          <div className="openclaw-output-header">
            <span className="openclaw-section-label">Output</span>
            {!running && (
              <button
                type="button"
                className="docker-action-btn"
                onClick={() => { setOutput([]); setExitCode(null) }}
              >
                Clear
              </button>
            )}
          </div>
          <div ref={outputRef} className="openclaw-output compose-output">
            {output.map((line, i) => (
              <span
                key={i}
                className={`compose-line compose-line-${line.kind}`}
              >
                {line.text}
              </span>
            ))}
            {running && <span className="compose-line compose-line-system">▌</span>}
            {!running && exitCode !== null && (
              <span
                className={`compose-line compose-line-system${exitCode === 0 ? ' ok' : ' fail'}`}
              >
                {exitCode === 0 ? '✓ Exited 0' : `✗ Exited ${exitCode}`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
