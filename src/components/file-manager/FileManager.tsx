import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry, FileStat, PreviewData, SortDir, SortKey } from './utils'
import { dirname, formatBytes, getExtension, isImageExtension, isPdfExtension, joinPath, normalizePath } from './utils'
import { FilePane, type FilePaneState } from './FilePane'
import { FilePreview } from './FilePreview'

const CACHE_TTL_MS = 15000
const PREVIEW_CHUNK_BYTES = 64 * 1024
const PREVIEW_MAX_BYTES = 512 * 1024
const MEDIA_PREVIEW_LIMIT = 20 * 1024 * 1024

export type FileManagerProps = {
  sessionId?: string
  sessionTitle?: string
  apiClient: {
    listSftpDirectory: (sessionId: string, path: string, signal?: AbortSignal) => Promise<{
      path: string
      resolvedPath?: string
      entries: FileEntry[]
      truncated: boolean
    }>
    statSftpPath: (sessionId: string, path: string, signal?: AbortSignal) => Promise<FileStat>
    previewSftpFile: (sessionId: string, path: string, offset: number, limit: number, signal?: AbortSignal) => Promise<PreviewData>
    getSftpDownloadUrl: (sessionId: string, path: string, inline?: boolean) => string
    uploadSftpFile: (sessionId: string, path: string, data: Blob, signal?: AbortSignal) => Promise<void>
    mkdirSftpPath: (sessionId: string, path: string) => Promise<void>
    renameSftpPath: (sessionId: string, from: string, to: string) => Promise<void>
    deleteSftpPath: (sessionId: string, path: string, recursive: boolean) => Promise<void>
  }
}

type PaneData = {
  entries: FileEntry[]
  loading: boolean
  error?: string | null
  truncated: boolean
}

type PreviewState = {
  entry?: FileEntry | null
  stat?: FileStat | null
  preview?: PreviewData | null
  mediaKind?: 'image' | 'pdf' | null
  mediaUrl?: string | null
  loading: boolean
  error?: string | null
}

type CachedDir = {
  entries: FileEntry[]
  truncated: boolean
  fetchedAt: number
}

const defaultPaneState: FilePaneState = {
  path: '.',
  filter: '',
  sortKey: 'name',
  sortDir: 'asc',
}

export function FileManager({ sessionId, sessionTitle, apiClient }: FileManagerProps) {
  const [activePane, setActivePane] = useState<'left' | 'right'>('left')
  const [focused, setFocused] = useState(false)
  const [paneState, setPaneState] = useState<{ left: FilePaneState; right: FilePaneState }>({
    left: { ...defaultPaneState },
    right: { ...defaultPaneState },
  })
  const [paneData, setPaneData] = useState<{ left: PaneData; right: PaneData }>({
    left: { entries: [], loading: false, truncated: false },
    right: { entries: [], loading: false, truncated: false },
  })
  const [previewState, setPreviewState] = useState<PreviewState>({ loading: false })
  const [status, setStatus] = useState<string | null>(null)

  const sessionStateRef = useRef(new Map<string, { paneState: { left: FilePaneState; right: FilePaneState }; activePane: 'left' | 'right' }>())
  const cacheRef = useRef(new Map<string, Map<string, CachedDir>>())
  const abortRef = useRef<{ left?: AbortController; right?: AbortController }>({})
  const previewAbortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<{ left?: number; right?: number }>({})
  const previewDebounceRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setPaneState({ left: { ...defaultPaneState }, right: { ...defaultPaneState } })
      setPaneData({ left: { entries: [], loading: false, truncated: false }, right: { entries: [], loading: false, truncated: false } })
      setPreviewState({ loading: false })
      return
    }

    const saved = sessionStateRef.current.get(sessionId)
    if (saved) {
      setPaneState(saved.paneState)
      setActivePane(saved.activePane)
    } else {
      setPaneState({ left: { ...defaultPaneState }, right: { ...defaultPaneState } })
      setActivePane('left')
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    sessionStateRef.current.set(sessionId, { paneState, activePane })
  }, [sessionId, paneState, activePane])

  useEffect(() => {
    return () => {
      abortRef.current.left?.abort()
      abortRef.current.right?.abort()
      previewAbortRef.current?.abort()
      if (debounceRef.current.left) window.clearTimeout(debounceRef.current.left)
      if (debounceRef.current.right) window.clearTimeout(debounceRef.current.right)
      if (previewDebounceRef.current) window.clearTimeout(previewDebounceRef.current)
    }
  }, [])

  const updatePaneState = useCallback((pane: 'left' | 'right', updater: (state: FilePaneState) => FilePaneState) => {
    setPaneState((prev) => ({
      ...prev,
      [pane]: updater(prev[pane]),
    }))
  }, [])

  const updatePaneData = useCallback((pane: 'left' | 'right', updater: (state: PaneData) => PaneData) => {
    setPaneData((prev) => ({
      ...prev,
      [pane]: updater(prev[pane]),
    }))
  }, [])

  const fetchDirectory = useCallback((pane: 'left' | 'right', path: string, force = false) => {
    if (!sessionId) return
    const normalized = normalizePath(path)
    const sessionCache = cacheRef.current.get(sessionId) ?? new Map<string, CachedDir>()
    cacheRef.current.set(sessionId, sessionCache)

    const cached = sessionCache.get(normalized)
    const now = Date.now()
    if (cached && !force && now - cached.fetchedAt < CACHE_TTL_MS) {
      updatePaneData(pane, (prev) => ({ ...prev, entries: cached.entries, truncated: cached.truncated, loading: false, error: null }))
      return
    }

    if (debounceRef.current[pane]) {
      window.clearTimeout(debounceRef.current[pane])
    }
    if (abortRef.current[pane]) {
      abortRef.current[pane]?.abort()
    }

    updatePaneData(pane, (prev) => ({ ...prev, loading: true, error: null }))

    const controller = new AbortController()
    abortRef.current[pane] = controller
    debounceRef.current[pane] = window.setTimeout(() => {
      apiClient.listSftpDirectory(sessionId, normalized, controller.signal)
        .then((data) => {
          sessionCache.set(normalized, { entries: data.entries, truncated: data.truncated, fetchedAt: Date.now() })
          updatePaneData(pane, () => ({ entries: data.entries, truncated: data.truncated, loading: false, error: null }))
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : 'Failed to load directory.'
          updatePaneData(pane, (prev) => ({ ...prev, loading: false, error: message }))
        })
    }, 180)
  }, [apiClient, sessionId, updatePaneData])

  useEffect(() => {
    if (!sessionId) return
    fetchDirectory('left', paneState.left.path)
  }, [sessionId, paneState.left.path, fetchDirectory])

  useEffect(() => {
    if (!sessionId) return
    fetchDirectory('right', paneState.right.path)
  }, [sessionId, paneState.right.path, fetchDirectory])

  const activeEntries = paneData[activePane].entries
  const activeSelection = paneState[activePane].selectedPath
  const selectedEntry = useMemo(() => {
    return activeEntries.find((entry) => entry.path === activeSelection) ?? null
  }, [activeEntries, activeSelection])

  const refreshActivePane = useCallback(() => {
    fetchDirectory(activePane, paneState[activePane].path, true)
  }, [activePane, fetchDirectory, paneState])

  const handleNavigate = useCallback((pane: 'left' | 'right', path: string) => {
    updatePaneState(pane, (prev) => ({ ...prev, path: normalizePath(path), selectedPath: undefined }))
  }, [updatePaneState])

  const handleSelect = useCallback((pane: 'left' | 'right', entry: FileEntry | null) => {
    setActivePane(pane)
    updatePaneState(pane, (prev) => ({ ...prev, selectedPath: entry?.path }))
  }, [updatePaneState])

  const handleActivate = useCallback((pane: 'left' | 'right', entry: FileEntry) => {
    setActivePane(pane)
    if (entry.type === 'dir') {
      handleNavigate(pane, joinPath(paneState[pane].path, entry.name))
    } else {
      updatePaneState(pane, (prev) => ({ ...prev, selectedPath: entry.path }))
    }
  }, [handleNavigate, paneState, updatePaneState])

  const handleSortChange = useCallback((pane: 'left' | 'right', key: SortKey) => {
    updatePaneState(pane, (prev) => {
      const nextDir: SortDir = prev.sortKey === key && prev.sortDir === 'asc' ? 'desc' : 'asc'
      return { ...prev, sortKey: key, sortDir: nextDir }
    })
  }, [updatePaneState])

  const handleFilterChange = useCallback((pane: 'left' | 'right', value: string) => {
    updatePaneState(pane, (prev) => ({ ...prev, filter: value }))
  }, [updatePaneState])

  const handleLoadPreview = useCallback((entry: FileEntry | null) => {
    if (!sessionId || !entry) {
      setPreviewState({ loading: false, entry: null })
      return
    }

    if (previewDebounceRef.current) {
      window.clearTimeout(previewDebounceRef.current)
    }
    previewAbortRef.current?.abort()

    setPreviewState((prev) => ({ ...prev, loading: true, error: null, entry }))

    const controller = new AbortController()
    previewAbortRef.current = controller

    previewDebounceRef.current = window.setTimeout(() => {
      apiClient.statSftpPath(sessionId, entry.path, controller.signal)
        .then((stat) => {
          const ext = getExtension(entry.name)
          if (stat.type !== 'file') {
            setPreviewState({ entry, stat, preview: null, mediaKind: null, mediaUrl: null, loading: false })
            return
          }

          const downloadUrl = apiClient.getSftpDownloadUrl(sessionId, entry.path, true)
          if (isImageExtension(ext) && stat.size <= MEDIA_PREVIEW_LIMIT) {
            setPreviewState({ entry, stat, preview: null, mediaKind: 'image', mediaUrl: downloadUrl, loading: false })
            return
          }

          if (isPdfExtension(ext) && stat.size <= MEDIA_PREVIEW_LIMIT) {
            setPreviewState({ entry, stat, preview: null, mediaKind: 'pdf', mediaUrl: downloadUrl, loading: false })
            return
          }

          apiClient.previewSftpFile(sessionId, entry.path, 0, PREVIEW_CHUNK_BYTES, controller.signal)
            .then((preview) => {
              setPreviewState({ entry, stat, preview, mediaKind: null, mediaUrl: null, loading: false })
            })
            .catch((error: unknown) => {
              if (controller.signal.aborted) return
              const message = error instanceof Error ? error.message : 'Failed to load preview.'
              setPreviewState({ entry, stat, preview: null, mediaKind: null, mediaUrl: null, loading: false, error: message })
            })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : 'Failed to load metadata.'
          setPreviewState({ entry, stat: null, preview: null, mediaKind: null, mediaUrl: null, loading: false, error: message })
        })
    }, 200)
  }, [apiClient, sessionId])

  useEffect(() => {
    handleLoadPreview(selectedEntry)
  }, [handleLoadPreview, selectedEntry])

  const loadMorePreview = useCallback(() => {
    if (!sessionId || !previewState.entry || !previewState.preview || previewState.preview.kind !== 'text') return
    if (previewState.loading) return
    const loadedBytes = previewState.preview.bytesRead
    if (loadedBytes >= PREVIEW_MAX_BYTES) return
    const nextOffset = previewState.preview.offset + loadedBytes
    if (nextOffset >= previewState.preview.size) return
    const nextLimit = Math.min(PREVIEW_CHUNK_BYTES, PREVIEW_MAX_BYTES - loadedBytes)
    if (nextLimit <= 0) return

    const controller = new AbortController()
    previewAbortRef.current = controller
    setPreviewState((prev) => ({ ...prev, loading: true }))

    apiClient.previewSftpFile(sessionId, previewState.entry.path, nextOffset, nextLimit, controller.signal)
      .then((next) => {
        const combinedBytes = loadedBytes + next.bytesRead
        const merged: PreviewData = {
          ...next,
          offset: previewState.preview?.offset ?? 0,
          bytesRead: combinedBytes,
          truncated: combinedBytes < next.size && combinedBytes < PREVIEW_MAX_BYTES,
          data: `${previewState.preview?.data ?? ''}${next.data ?? ''}`,
        }
        setPreviewState((prev) => ({
          ...prev,
          preview: merged,
          loading: false,
          error: null,
        }))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Failed to load more preview.'
        setPreviewState((prev) => ({ ...prev, loading: false, error: message }))
      })
  }, [apiClient, previewState, sessionId])

  useEffect(() => {
    if (!focused) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (!sessionId) return

      if (event.key === 'F5') {
        event.preventDefault()
        refreshActivePane()
      }

      if (event.key === 'F7') {
        event.preventDefault()
        void handleNewFolder()
      }

      if (event.key === 'F2') {
        event.preventDefault()
        void handleRename()
      }

      if (event.key === 'Delete') {
        event.preventDefault()
        void handleDelete()
      }

      if (event.key === 'Enter' && selectedEntry) {
        event.preventDefault()
        handleActivate(activePane, selectedEntry)
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        handleNavigate(activePane, dirname(paneState[activePane].path))
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activePane, focused, handleActivate, handleNavigate, paneState, refreshActivePane, selectedEntry, sessionId])

  const handleUploadClick = useCallback(() => {
    if (!sessionId) return
    fileInputRef.current?.click()
  }, [sessionId])

  const handleUploadFiles = useCallback(async (files: FileList | null) => {
    if (!sessionId || !files || files.length === 0) return
    const targetDir = paneState[activePane].path
    setStatus(`Uploading ${files.length} file(s)...`)
    try {
      for (const file of Array.from(files)) {
        const targetPath = joinPath(targetDir, file.name)
        await apiClient.uploadSftpFile(sessionId, targetPath, file)
      }
      setStatus(`Upload complete to ${targetDir}`)
      refreshActivePane()
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Upload failed.')
    }
  }, [activePane, apiClient, paneState, refreshActivePane, sessionId])

  const handleNewFolder = useCallback(async () => {
    if (!sessionId) return
    const name = window.prompt('New folder name')
    if (!name) return
    const target = joinPath(paneState[activePane].path, name)
    setStatus('Creating folder...')
    try {
      await apiClient.mkdirSftpPath(sessionId, target)
      setStatus(`Folder created: ${name}`)
      refreshActivePane()
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Failed to create folder.')
    }
  }, [activePane, apiClient, paneState, refreshActivePane, sessionId])

  const handleRename = useCallback(async () => {
    if (!sessionId || !selectedEntry) return
    const nextName = window.prompt('Rename to', selectedEntry.name)
    if (!nextName || nextName === selectedEntry.name) return
    const from = selectedEntry.path
    const to = joinPath(dirname(selectedEntry.path), nextName)
    setStatus('Renaming...')
    try {
      await apiClient.renameSftpPath(sessionId, from, to)
      setStatus(`Renamed to ${nextName}`)
      refreshActivePane()
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Rename failed.')
    }
  }, [apiClient, refreshActivePane, selectedEntry, sessionId])

  const handleDelete = useCallback(async () => {
    if (!sessionId || !selectedEntry) return
    const isDir = selectedEntry.type === 'dir'
    const confirmMessage = isDir ? `Delete folder "${selectedEntry.name}" and its contents?` : `Delete "${selectedEntry.name}"?`
    const confirmed = window.confirm(confirmMessage)
    if (!confirmed) return
    setStatus('Deleting...')
    try {
      await apiClient.deleteSftpPath(sessionId, selectedEntry.path, isDir)
      setStatus('Deleted.')
      updatePaneData(activePane, (prev) => ({
        ...prev,
        entries: prev.entries.filter((entry) => entry.path !== selectedEntry.path),
      }))
      refreshActivePane()
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Delete failed.')
    }
  }, [activePane, apiClient, refreshActivePane, selectedEntry, sessionId, updatePaneData])

  const handleDownload = useCallback(() => {
    if (!sessionId || !selectedEntry || selectedEntry.type === 'dir') return
    const url = apiClient.getSftpDownloadUrl(sessionId, selectedEntry.path)
    window.open(url, '_blank', 'noreferrer')
  }, [apiClient, selectedEntry, sessionId])

  const downloadUrl = useMemo(() => {
    if (!sessionId || !selectedEntry || selectedEntry.type === 'dir') return null
    return apiClient.getSftpDownloadUrl(sessionId, selectedEntry.path)
  }, [apiClient, selectedEntry, sessionId])

  const previewDownloadUrl = useMemo(() => {
    if (!sessionId || !previewState.entry || previewState.entry.type === 'dir') return null
    return apiClient.getSftpDownloadUrl(sessionId, previewState.entry.path)
  }, [apiClient, previewState.entry, sessionId])

  const canLoadMorePreview = useMemo(() => {
    if (!previewState.preview || previewState.preview.kind !== 'text') return false
    if (!previewState.preview.truncated) return false
    return previewState.preview.bytesRead < PREVIEW_MAX_BYTES
  }, [previewState.preview])

  const fileManagerClass = `file-manager ${activePane === 'right' ? 'right-active' : 'left-active'}`

  return (
    <section
      className={fileManagerClass}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="file-manager-header">
        <div className="file-manager-title">
          <h2>File Manager</h2>
          <span className="file-manager-sub">{sessionTitle ? `Session: ${sessionTitle}` : 'No active session'}</span>
        </div>
        <div className="file-manager-actions">
          <button type="button" onClick={handleUploadClick} disabled={!sessionId}>
            Upload
          </button>
          <button type="button" onClick={handleDownload} disabled={!downloadUrl}>
            Download
          </button>
          <button type="button" onClick={handleNewFolder} disabled={!sessionId}>
            New Folder
          </button>
          <button type="button" onClick={handleRename} disabled={!selectedEntry}>
            Rename
          </button>
          <button type="button" onClick={handleDelete} disabled={!selectedEntry}>
            Delete
          </button>
          <button type="button" onClick={refreshActivePane} disabled={!sessionId}>
            Refresh
          </button>
        </div>
      </div>

      {status && <div className="file-manager-status">{status}</div>}

      {!sessionId && (
        <div className="file-manager-empty">
          <p>No active SSH session. Open a session to browse files.</p>
        </div>
      )}

      {sessionId && (
        <div className="file-manager-grid">
          <FilePane
            paneId="left"
            state={paneState.left}
            entries={paneData.left.entries}
            loading={paneData.left.loading}
            error={paneData.left.error}
            truncated={paneData.left.truncated}
            isActive={activePane === 'left'}
            onPathChange={(path) => handleNavigate('left', path)}
            onSelect={(entry) => handleSelect('left', entry)}
            onFilterChange={(value) => handleFilterChange('left', value)}
            onSortChange={(key) => handleSortChange('left', key)}
            onRefresh={() => fetchDirectory('left', paneState.left.path, true)}
            onActivate={(entry) => handleActivate('left', entry)}
            onFocus={() => setActivePane('left')}
          />

          <FilePane
            paneId="right"
            state={paneState.right}
            entries={paneData.right.entries}
            loading={paneData.right.loading}
            error={paneData.right.error}
            truncated={paneData.right.truncated}
            isActive={activePane === 'right'}
            onPathChange={(path) => handleNavigate('right', path)}
            onSelect={(entry) => handleSelect('right', entry)}
            onFilterChange={(value) => handleFilterChange('right', value)}
            onSortChange={(key) => handleSortChange('right', key)}
            onRefresh={() => fetchDirectory('right', paneState.right.path, true)}
            onActivate={(entry) => handleActivate('right', entry)}
            onFocus={() => setActivePane('right')}
          />

          <FilePreview
            entry={previewState.entry ?? undefined}
            stat={previewState.stat ?? undefined}
            preview={previewState.preview ?? undefined}
            loading={previewState.loading}
            error={previewState.error}
            mediaKind={previewState.mediaKind ?? null}
            mediaUrl={previewState.mediaUrl ?? null}
            downloadUrl={previewDownloadUrl}
            onLoadMore={canLoadMorePreview ? loadMorePreview : undefined}
          />
        </div>
      )}

      <div className="file-manager-footer">
        <span>Active pane: {activePane === 'left' ? 'Left' : 'Right'} · {selectedEntry ? selectedEntry.name : 'No selection'}</span>
        {selectedEntry && selectedEntry.type !== 'dir' && (
          <span>Size: {formatBytes(selectedEntry.size)}</span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="file-input"
        multiple
        onChange={(event) => {
          void handleUploadFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </section>
  )
}
