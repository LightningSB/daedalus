const API_BASE = '/api'

type HttpMethod = 'GET' | 'POST' | 'DELETE'

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
  rawCommand?: string
}

export type VaultStatus = {
  initialized: boolean
  locked: boolean
}

export type CreateSshSessionRequest = {
  rawCommand: string
}

export type CreateSshSessionResponse = {
  sessionId: string
  websocketUrl?: string
}

export type ReadSshOutputResponse = {
  data: string
  cursor?: string
}

type RequestOptions = {
  method?: HttpMethod
  body?: unknown
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
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

function normalizeSavedHost(host: unknown, index: number): SavedHost {
  const value = (host ?? {}) as Record<string, unknown>
  const hostname = String(value.hostname ?? value.host ?? '')
  return {
    id: String(value.id ?? value.hostId ?? `host-${index}`),
    name: String((value.name ?? value.label ?? hostname) || `Host ${index + 1}`),
    hostname,
    username: typeof value.username === 'string' ? value.username : undefined,
    port: typeof value.port === 'number' ? value.port : undefined,
    rawCommand: typeof value.rawCommand === 'string'
      ? value.rawCommand
      : typeof value.command === 'string'
        ? value.command
        : undefined,
  }
}

export const apiClient = {
  async getSavedHosts(): Promise<SavedHost[]> {
    const data = await requestJson<unknown>('/hosts')
    const hosts = Array.isArray(data)
      ? data
      : typeof data === 'object' && data !== null && Array.isArray((data as { hosts?: unknown[] }).hosts)
        ? (data as { hosts: unknown[] }).hosts
        : []
    return hosts.map(normalizeSavedHost).filter((host) => host.hostname.length > 0)
  },

  async createSshSession(payload: CreateSshSessionRequest): Promise<CreateSshSessionResponse> {
    const data = await requestJson<Record<string, unknown>>('/ssh/sessions', {
      method: 'POST',
      body: { command: payload.rawCommand, rawCommand: payload.rawCommand },
    })
    const sessionId = data.sessionId ?? data.id ?? data.session_id
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new ApiError('Backend response missing session id.', 500)
    }
    return {
      sessionId,
      websocketUrl: typeof data.websocketUrl === 'string'
        ? data.websocketUrl
        : typeof data.wsUrl === 'string'
          ? data.wsUrl
          : undefined,
    }
  },

  async sendSshInput(sessionId: string, data: string): Promise<void> {
    await requestJson(`/ssh/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      body: { data },
    })
  },

  async readSshOutput(sessionId: string, cursor?: string): Promise<ReadSshOutputResponse> {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const data = await requestJson<Record<string, unknown>>(`/ssh/sessions/${encodeURIComponent(sessionId)}/output${suffix}`)
    return {
      data: typeof data.data === 'string' ? data.data : typeof data.output === 'string' ? data.output : '',
      cursor: typeof data.cursor === 'string' ? data.cursor : undefined,
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

  async getVaultStatus(): Promise<VaultStatus> {
    const data = await requestJson<Record<string, unknown>>('/vault/status')
    return {
      initialized: Boolean(data.initialized),
      locked: Boolean(data.locked),
    }
  },

  async initVault(passphrase: string): Promise<void> {
    await requestJson('/vault/init', {
      method: 'POST',
      body: { passphrase },
    })
  },

  async unlockVault(passphrase: string): Promise<void> {
    await requestJson('/vault/unlock', {
      method: 'POST',
      body: { passphrase },
    })
  },

  async lockVault(): Promise<void> {
    await requestJson('/vault/lock', {
      method: 'POST',
      body: {},
    })
  },

  async getRecoveryPhrase(): Promise<string> {
    const data = await requestJson<Record<string, unknown>>('/vault/recovery-phrase')
    return typeof data.phrase === 'string'
      ? data.phrase
      : typeof data.recoveryPhrase === 'string'
        ? data.recoveryPhrase
        : ''
  },
}
