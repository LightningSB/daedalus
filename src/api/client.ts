const DEFAULT_API_ORIGIN = 'https://api.daedalus.wheelbase.io'

// Override for local dev: VITE_API_ORIGIN=http://localhost:18080
const API_ORIGIN = (import.meta as any).env?.VITE_API_ORIGIN ?? DEFAULT_API_ORIGIN
const API_BASE = `${API_ORIGIN.replace(/\/$/, '')}/api`

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type SavedHost = {
  id: string
  name: string
  hostname: string
  username?: string
  port?: number
  secretId?: string
}

export type VaultStatus = {
  initialized: boolean
  unlocked: boolean
}

export type CreateSshSessionRequest = {
  rawCommand: string
  hostId?: string
  vaultToken?: string
  password?: string
  privateKey?: string
  passphrase?: string
}

export type CreateSavedHostRequest = {
  name: string
  host: string
  port: number
  username: string
  vaultToken?: string
  credentials?: {
    password?: string
    privateKey?: string
    passphrase?: string
  }
}

export type CreateSshSessionResponse = {
  sessionId: string
  websocketUrl: string
  title: string
}

export type SshSessionSummary = {
  id: string
  host: string
  username?: string
  connected: boolean
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

type RequestOptions = {
  method?: HttpMethod
  body?: unknown
  vaultToken?: string
  signal?: AbortSignal
}

function wsUrlFor(path: string): string {
  const url = new URL(path, API_BASE)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function normalizeSavedHost(host: unknown, index: number): SavedHost {
  const value = (host ?? {}) as Record<string, unknown>
  const hostname = String(value.host ?? value.hostname ?? '')
  return {
    id: String(value.id ?? value.hostId ?? `host-${index}`),
    name: String((value.label ?? value.name ?? hostname) || `Host ${index + 1}`),
    hostname,
    username: typeof value.username === 'string' ? value.username : undefined,
    port: typeof value.port === 'number' ? value.port : undefined,
    secretId: typeof value.secretId === 'string' ? value.secretId : undefined,
  }
}

export function createApiClient(userId: string) {
  const base = `${API_BASE}/users/${encodeURIComponent(userId)}`

  async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (options.vaultToken) {
      headers['x-vault-token'] = options.vaultToken
    }

    const response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })

    const text = await response.text()
    let data: unknown = null

    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }

    if (!response.ok) {
      const message = typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${response.status})`
      throw new ApiError(message, response.status)
    }

    return data as T
  }

  // Docker API methods (server-global, not user-scoped)
  const dockerBase = API_BASE

  async function dockerJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const response = await fetch(`${dockerBase}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
    const text = await response.text()
    let data: unknown = null
    if (text) {
      try { data = JSON.parse(text) } catch { data = null }
    }
    if (!response.ok) {
      const message = typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${response.status})`
      throw new ApiError(message, response.status)
    }
    return data as T
  }

  return {
    getSessionWebsocketUrl(sessionId: string): string {
      return wsUrlFor(`${base}/ssh/sessions/${encodeURIComponent(sessionId)}/ws`)
    },

    async getSavedHosts(): Promise<SavedHost[]> {
      const data = await requestJson<{ hosts?: unknown[] }>('/ssh/hosts')
      const hosts = Array.isArray(data.hosts) ? data.hosts : []
      return hosts.map(normalizeSavedHost).filter((host) => host.hostname.length > 0)
    },

    async createSavedHost(payload: CreateSavedHostRequest): Promise<void> {
      await requestJson('/ssh/hosts', {
        method: 'POST',
        vaultToken: payload.vaultToken,
        body: {
          label: payload.name,
          host: payload.host,
          port: payload.port,
          username: payload.username,
          credentials: payload.credentials,
        },
      })
    },

    async deleteSavedHost(hostId: string): Promise<void> {
      await requestJson(`/ssh/hosts/${encodeURIComponent(hostId)}`, {
        method: 'DELETE',
      })
    },

    async getVaultStatus(): Promise<VaultStatus> {
      const data = await requestJson<Record<string, unknown>>('/vault/status')
      return {
        initialized: Boolean(data.initialized),
        unlocked: Boolean(data.unlocked),
      }
    },

    async initVault(passphrase: string): Promise<{ recoveryPhrase: string }> {
      const data = await requestJson<Record<string, unknown>>('/vault/init', {
        method: 'POST',
        body: { passphrase },
      })

      return {
        recoveryPhrase: typeof data.recoveryPhrase === 'string' ? data.recoveryPhrase : '',
      }
    },

    async unlockVault(passphrase: string): Promise<{ token: string; ttlMs: number }> {
      const data = await requestJson<Record<string, unknown>>('/vault/unlock', {
        method: 'POST',
        body: { passphrase },
      })

      const token = typeof data.token === 'string' ? data.token : ''
      const ttlMs = typeof data.ttlMs === 'number' ? data.ttlMs : 30 * 60 * 1000
      if (!token) {
        throw new ApiError('Unlock response missing token', 500)
      }
      return { token, ttlMs }
    },

    async lockVault(vaultToken: string): Promise<void> {
      await requestJson('/vault/lock', {
        method: 'POST',
        body: {},
        vaultToken,
      })
    },

    async recoverVault(recoveryPhrase: string, newPassphrase: string): Promise<{ token: string; recoveryPhrase: string }> {
      const data = await requestJson<Record<string, unknown>>('/vault/recover', {
        method: 'POST',
        body: {
          recoveryPhrase,
          newPassphrase,
        },
      })

      const token = typeof data.token === 'string' ? data.token : ''
      const nextRecoveryPhrase = typeof data.recoveryPhrase === 'string' ? data.recoveryPhrase : ''
      if (!token) {
        throw new ApiError('Recover response missing token', 500)
      }

      return {
        token,
        recoveryPhrase: nextRecoveryPhrase,
      }
    },

    async listSshSessions(): Promise<SshSessionSummary[]> {
      const data = await requestJson<{ sessions?: Array<Record<string, unknown>> }>('/ssh/sessions')
      const sessions = Array.isArray(data.sessions) ? data.sessions : []

      return sessions.map((session) => {
        const id = typeof session.id === 'string' ? session.id : ''
        const host = typeof session.host === 'string' ? session.host : 'session'
        const username = typeof session.username === 'string' ? session.username : undefined
        const connected = Boolean(session.connected)
        return { id, host, username, connected }
      }).filter((session) => session.id.length > 0)
    },

    async createSshSession(payload: CreateSshSessionRequest): Promise<CreateSshSessionResponse> {
      const data = await requestJson<{ session?: Record<string, unknown> }>('/ssh/sessions', {
        method: 'POST',
        body: {
          command: payload.rawCommand,
          hostId: payload.hostId,
          password: payload.password,
          privateKey: payload.privateKey,
          passphrase: payload.passphrase,
        },
        vaultToken: payload.vaultToken,
      })

      const session = data.session ?? {}
      const sessionId = typeof session.id === 'string' ? session.id : ''
      if (!sessionId) {
        throw new ApiError('Backend response missing session id.', 500)
      }

      const host = typeof session.host === 'string' ? session.host : 'session'
      const username = typeof session.username === 'string' ? session.username : ''
      const title = username ? `${username}@${host}` : host

      return {
        sessionId,
        websocketUrl: wsUrlFor(`${base}/ssh/sessions/${encodeURIComponent(sessionId)}/ws`),
        title,
      }
    },

    async resizeSshSession(sessionId: string, cols: number, rows: number): Promise<void> {
      await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/resize`, {
        method: 'POST',
        body: { cols, rows },
      })
    },

    async closeSshSession(sessionId: string): Promise<void> {
      await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })
    },

    async getSshTmuxSessions(sessionId: string, signal?: AbortSignal): Promise<TmuxStatus> {
      return await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/tmux`, { signal })
    },

    async sendClientLog(input: ClientLogInput): Promise<void> {
      await requestJson('/client-logs', {
        method: 'POST',
        body: {
          ts: input.ts,
          level: input.level ?? 'info',
          category: input.category ?? 'client',
          message: input.message,
          meta: input.meta,
        },
      })
    },

    async listSftpDirectory(sessionId: string, path: string, signal?: AbortSignal): Promise<{
      path: string
      resolvedPath?: string
      entries: Array<{
        name: string
        path: string
        type: 'file' | 'dir' | 'symlink' | 'other'
        size: number
        mtimeMs: number
        mode: number
      }>
      truncated: boolean
    }> {
      const params = new URLSearchParams({ path })
      return await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/fs/list?${params.toString()}`, { signal })
    },

    async statSftpPath(sessionId: string, path: string, signal?: AbortSignal): Promise<{
      path: string
      resolvedPath?: string
      type: 'file' | 'dir' | 'symlink' | 'other'
      size: number
      mtimeMs: number
      mode: number
      isSymlink: boolean
      target?: string
    }> {
      const params = new URLSearchParams({ path })
      return await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/fs/stat?${params.toString()}`, { signal })
    },

    async previewSftpFile(sessionId: string, path: string, offset: number, limit: number, signal?: AbortSignal): Promise<{
      path: string
      size: number
      offset: number
      limit: number
      bytesRead: number
      truncated: boolean
      kind: 'text' | 'binary'
      encoding?: 'utf-8'
      data?: string
    }> {
      const params = new URLSearchParams({
        path,
        offset: String(offset),
        limit: String(limit),
      })
      return await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/fs/preview?${params.toString()}`, { signal })
    },

    getSftpDownloadUrl(sessionId: string, path: string, inline = false): string {
      const params = new URLSearchParams({ path, inline: inline ? 'true' : 'false' })
      return `${base}/ssh/sessions/${encodeURIComponent(sessionId)}/fs/download?${params.toString()}`
    },

    async uploadSftpFile(sessionId: string, path: string, data: Blob, signal?: AbortSignal): Promise<void> {
      const params = new URLSearchParams({ path })
      const response = await fetch(`${base}/ssh/sessions/${encodeURIComponent(sessionId)}/fs/upload?${params.toString()}`, {
        method: 'PUT',
        body: data,
        signal,
      })

      if (!response.ok) {
        const text = await response.text()
        let message = `Upload failed (${response.status})`
        try {
          const parsed = JSON.parse(text) as { error?: string }
          if (parsed.error) message = parsed.error
        } catch {
          // ignore
        }
        throw new ApiError(message, response.status)
      }
    },

    async mkdirSftpPath(sessionId: string, path: string): Promise<void> {
      await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/fs/mkdir`, {
        method: 'POST',
        body: { path },
      })
    },

    async renameSftpPath(sessionId: string, from: string, to: string): Promise<void> {
      await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/fs/rename`, {
        method: 'POST',
        body: { from, to },
      })
    },

    async deleteSftpPath(sessionId: string, path: string, recursive: boolean): Promise<void> {
      await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/fs/delete`, {
        method: 'DELETE',
        body: { path, recursive },
      })
    },

    // -------------------------------------------------------------------------
    // Docker API
    // -------------------------------------------------------------------------

    async checkDockerHealth(): Promise<boolean> {
      const data = await dockerJson<{ available?: boolean }>('/docker/health')
      return Boolean(data.available)
    },

    async getComposeProjects(): Promise<ComposeProject[]> {
      const data = await dockerJson<{ projects?: unknown[] }>('/docker/compose/projects')
      return (Array.isArray(data.projects) ? data.projects : []) as ComposeProject[]
    },

    async streamComposeTask(
      projectName: string,
      configFile: string,
      service: string,
      args: string[],
      onEvent: (event: TaskEvent) => void,
      signal?: AbortSignal,
    ): Promise<number> {
      const response = await fetch(`${dockerBase}/docker/compose/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, configFile, service, args }),
        signal,
      })
      if (!response.ok) throw new ApiError(`Compose run failed (${response.status})`, response.status)
      if (!response.body) return -1

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let exitCode = -1

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6)) as TaskEvent
                onEvent(event)
                if (event.type === 'exit' && event.code !== undefined) {
                  exitCode = event.code
                }
              } catch { /* ignore malformed */ }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      return exitCode
    },

    async listDockerContainers(all = false): Promise<DockerContainerSummary[]> {
      const params = new URLSearchParams({ all: all ? 'true' : 'false' })
      const data = await dockerJson<{ containers?: unknown[] }>(`/docker/containers?${params}`)
      return (Array.isArray(data?.containers) ? data.containers : []) as DockerContainerSummary[]
    },

    async inspectDockerContainer(id: string): Promise<DockerContainerInfo> {
      const data = await dockerJson<{ info: DockerContainerInfo }>(`/docker/containers/${encodeURIComponent(id)}/inspect`)
      return data.info
    },

    async getDockerTmuxSessions(id: string): Promise<TmuxStatus> {
      return await dockerJson<TmuxStatus>(`/docker/containers/${encodeURIComponent(id)}/tmux`)
    },

    async listDockerContainerFiles(id: string, path: string): Promise<DockerFileEntry[]> {
      const params = new URLSearchParams({ path })
      const data = await dockerJson<{ entries?: unknown[] }>(`/docker/containers/${encodeURIComponent(id)}/fs/list?${params}`)
      return (Array.isArray(data.entries) ? data.entries : []) as DockerFileEntry[]
    },

    async previewDockerContainerFile(id: string, path: string, limit = 65536): Promise<DockerFilePreview> {
      const params = new URLSearchParams({ path, limit: String(limit) })
      return dockerJson<DockerFilePreview>(`/docker/containers/${encodeURIComponent(id)}/fs/preview?${params}`)
    },

    getContainerExecWsUrl(containerId: string): string {
      return wsUrlFor(`${dockerBase}/docker/containers/${encodeURIComponent(containerId)}/exec/ws`)
    },

    // -------------------------------------------------------------------------
    // SSH-session-scoped Docker API
    // All operations run against the active SSH host via the session tunnel.
    // -------------------------------------------------------------------------

    async checkSshDockerHealth(sessionId: string): Promise<boolean> {
      const data = await requestJson<{ available?: boolean }>(
        `/ssh/sessions/${encodeURIComponent(sessionId)}/docker/health`,
      )
      return Boolean(data.available)
    },

    async listSshDockerContainers(sessionId: string, all = false): Promise<DockerContainerSummary[]> {
      const params = new URLSearchParams({ all: all ? 'true' : 'false' })
      const data = await requestJson<{ containers?: unknown[] }>(
        `/ssh/sessions/${encodeURIComponent(sessionId)}/docker/containers?${params}`,
      )
      return (Array.isArray(data?.containers) ? data.containers : []) as DockerContainerSummary[]
    },

    async inspectSshDockerContainer(sessionId: string, id: string): Promise<DockerContainerInfo> {
      const data = await requestJson<{ info: DockerContainerInfo }>(
        `/ssh/sessions/${encodeURIComponent(sessionId)}/docker/containers/${encodeURIComponent(id)}/inspect`,
      )
      return data.info
    },

    async getSshDockerContainerTmux(sessionId: string, id: string): Promise<TmuxStatus> {
      return await requestJson<TmuxStatus>(
        `/ssh/sessions/${encodeURIComponent(sessionId)}/docker/containers/${encodeURIComponent(id)}/tmux`,
      )
    },

    async listSshDockerContainerFiles(sessionId: string, id: string, path: string): Promise<DockerFileEntry[]> {
      const params = new URLSearchParams({ path })
      const data = await requestJson<{ entries?: unknown[] }>(
        `/ssh/sessions/${encodeURIComponent(sessionId)}/docker/containers/${encodeURIComponent(id)}/fs/list?${params}`,
      )
      return (Array.isArray(data.entries) ? data.entries : []) as DockerFileEntry[]
    },

    async previewSshDockerContainerFile(sessionId: string, id: string, path: string, limit = 65536): Promise<DockerFilePreview> {
      const params = new URLSearchParams({ path, limit: String(limit) })
      return requestJson<DockerFilePreview>(
        `/ssh/sessions/${encodeURIComponent(sessionId)}/docker/containers/${encodeURIComponent(id)}/fs/preview?${params}`,
      )
    },

    getSshContainerExecWsUrl(sessionId: string, containerId: string): string {
      return wsUrlFor(
        `${base}/ssh/sessions/${encodeURIComponent(sessionId)}/docker/containers/${encodeURIComponent(containerId)}/exec/ws`,
      )
    },

    async getSshComposeProjects(sessionId: string): Promise<ComposeProject[]> {
      const data = await requestJson<{ projects?: unknown[] }>(
        `/ssh/sessions/${encodeURIComponent(sessionId)}/docker/compose/projects`,
      )
      return (Array.isArray(data.projects) ? data.projects : []) as ComposeProject[]
    },

    async streamSshComposeTask(
      sessionId: string,
      projectName: string,
      configFile: string,
      service: string,
      args: string[],
      onEvent: (event: TaskEvent) => void,
      signal?: AbortSignal,
    ): Promise<number> {
      const response = await fetch(
        `${base}/ssh/sessions/${encodeURIComponent(sessionId)}/docker/compose/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName, configFile, service, args }),
          signal,
        },
      )
      if (!response.ok) throw new ApiError(`Compose run failed (${response.status})`, response.status)
      if (!response.body) return -1

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let exitCode = -1

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6)) as TaskEvent
                onEvent(event)
                if (event.type === 'exit' && event.code !== undefined) {
                  exitCode = event.code
                }
              } catch { /* ignore malformed */ }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      return exitCode
    },
  }
}

// -------------------------------------------------------------------------
// Docker shared types (exported for frontend components)
// -------------------------------------------------------------------------

export type DockerContainerSummary = {
  id: string
  shortId: string
  names: string[]
  image: string
  status: string
  state: string
  created: number
  ports: Array<{ ip?: string; privatePort: number; publicPort?: number; type: string }>
  labels: Record<string, string>
}

export type DockerContainerInfo = {
  id: string
  name: string
  image: string
  state: {
    status: string
    running: boolean
    paused: boolean
    restarting: boolean
    pid: number
    startedAt: string
    finishedAt: string
  }
  config: {
    hostname: string
    image: string
    cmd: string[]
    env: string[]
    labels: Record<string, string>
    workingDir: string
  }
  networkSettings: {
    ipAddress: string
    ports: Record<string, unknown>
  }
  mounts: Array<{ type: string; source: string; destination: string; mode: string }>
}

export type DockerFileEntry = {
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  permissions?: string
}

export type DockerFilePreview = {
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

export type ComposeProject = {
  name: string
  status: string
  configFiles: string[]
  services: ComposeCliService[]
}

export type ComposeCliService = {
  name: string
  image?: string
  description?: string
  profiles: string[]
  command?: string
}

export type TaskEvent = {
  type: 'stdout' | 'stderr' | 'exit' | 'error'
  data?: string
  code?: number
  message?: string
}

export type TmuxSession = {
  name: string
  windows: number
  attached: boolean
  raw: string
}

export type TmuxStatus = {
  available: boolean
  status: 'not-installed' | 'no-server' | 'ok' | 'error'
  sessions: TmuxSession[]
  error?: string
}

export type ClientLogInput = {
  level?: 'debug' | 'info' | 'warn' | 'error'
  category?: string
  message: string
  meta?: Record<string, unknown>
  ts?: string
}
