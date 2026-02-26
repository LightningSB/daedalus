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
  }
}
