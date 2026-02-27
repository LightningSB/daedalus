import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import type { FileEntry, FileStat, PreviewData } from './utils'
import { dirname, formatBytes, getExtension, isImageExtension, isPdfExtension, joinPath, normalizePath } from './utils'
import { FilePane, type FilePaneState } from './FilePane'
import { FilePreview } from './FilePreview'

const CACHE_TTL_MS = 15000
const PREVIEW_CHUNK_BYTES = 64 * 1024
const PREVIEW_MAX_BYTES = 512 * 1024
const MEDIA_PREVIEW_LIMIT = 20 * 1024 * 1024
const SWIPE_THRESHOLD_PX = 48
const MOBILE_BREAKPOINT = '(max-width: 767px)'

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

type PaneModel = {
  id: string
  state: FilePaneState
}

const defaultPaneState: FilePaneState = {
  path: '.',
  filter: '',
  sortKey: 'name',
  sortDir: 'asc',
}

function createPane(path = '.'): PaneModel {
  return {
    id: `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    state: {
      ...defaultPaneState,
      path,
    },
  }
}

export function FileManager({ sessionId, sessionTitle, apiClient }: FileManagerProps) {
  const [panes, setPanes] = useState<PaneModel[]>([createPane('.')])
  const [activePaneId, setActivePaneId] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [paneData, setPaneData] = useState<Record<string, PaneData>>({})
  const [previewState, setPreviewState] = useState<PreviewState>({ loading: false })
  const [status, setStatus] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BREAKPOINT).matches)
  const [mobileViewingPreview, setMobileViewingPreview] = useState(false)
  const [mobilePaneMenuOpen, setMobilePaneMenuOpen] = useState(false)

  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  const sessionStateRef = useRef(new Map<string, { panes: PaneModel[]; activePaneId: string | null }>())
  const cacheRef = useRef(new Map<string, Map<string, CachedDir>>())
  const abortRef = useRef<Record<string, AbortController | undefined>>({})
  const previewAbortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<Record<string, number | undefined>>({})
  const previewDebounceRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const touchStartXRef = useRef<number | null>(null)

  // Mobile breakpoint listener
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT)
    const handler = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
      isMobileRef.current = event.matches
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const activePane = useMemo(() => {
    if (panes.length === 0) return null
    if (!activePaneId) return panes[0]
    return panes.find((pane) => pane.id === activePaneId) ?? panes[0]
  }, [activePaneId, panes])

  const activePaneIndex = useMemo(() => {
    if (!activePane) return 0
    return Math.max(0, panes.findIndex((pane) => pane.id === activePane.id))
  }, [activePane, panes])

  useEffect(() => {
    if (!activePaneId && panes.length > 0) {
      setActivePaneId(panes[0].id)
    }
  }, [activePaneId, panes])

  useEffect(() => {
    if (!sessionId) {
      const initial = [createPane('.')]
      setPanes(initial)
      setActivePaneId(initial[0].id)
      setPaneData({})
      setPreviewState({ loading: false })
      setMobileViewingPreview(false)
      setMobilePaneMenuOpen(false)
      return
    }

    const saved = sessionStateRef.current.get(sessionId)
    if (saved && saved.panes.length > 0) {
      setPanes(saved.panes)
      setActivePaneId(saved.activePaneId ?? saved.panes[0].id)
    } else {
      const initial = [createPane('.')]
      setPanes(initial)
      setActivePaneId(initial[0].id)
    }
    setMobileViewingPreview(false)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    sessionStateRef.current.set(sessionId, { panes, activePaneId })
  }, [activePaneId, panes, sessionId])

  useEffect(() => {
    return () => {
      Object.values(abortRef.current).forEach((controller) => controller?.abort())
      previewAbortRef.current?.abort()
      Object.values(debounceRef.current).forEach((timer) => {
        if (timer) window.clearTimeout(timer)
      })
      if (previewDebounceRef.current) window.clearTimeout(previewDebounceRef.current)
    }
  }, [])

  const updatePaneState = useCallback((paneId: string, updater: (state: FilePaneState) => FilePaneState) => {
    setPanes((previous) => previous.map((pane) => (
      pane.id === paneId ? { ...pane, state: updater(pane.state) } : pane
    )))
  }, [])

  const updatePaneData = useCallback((paneId: string, updater: (state: PaneData) => PaneData) => {
    setPaneData((previous) => {
      const current = previous[paneId] ?? { entries: [], loading: false, truncated: false }
      return {
        ...previous,
        [paneId]: updater(current),
      }
    })
  }, [])

  const fetchDirectory = useCallback((paneId: string, path: string, force = false) => {
    if (!sessionId) return

    const normalized = normalizePath(path)
    const sessionCache = cacheRef.current.get(sessionId) ?? new Map<string, CachedDir>()
    cacheRef.current.set(sessionId, sessionCache)

    const cached = sessionCache.get(normalized)
    const now = Date.now()
    if (cached && !force && now - cached.fetchedAt < CACHE_TTL_MS) {
      updatePaneData(paneId, () => ({ entries: cached.entries, truncated: cached.truncated, loading: false, error: null }))
      return
    }

    if (debounceRef.current[paneId]) {
      window.clearTimeout(debounceRef.current[paneId])
    }

    abortRef.current[paneId]?.abort()

    updatePaneData(paneId, (prev) => ({ ...prev, loading: true, error: null }))

    const controller = new AbortController()
    abortRef.current[paneId] = controller

    debounceRef.current[paneId] = window.setTimeout(() => {
      apiClient.listSftpDirectory(sessionId, normalized, controller.signal)
        .then((data) => {
          sessionCache.set(normalized, { entries: data.entries, truncated: data.truncated, fetchedAt: Date.now() })
          updatePaneData(paneId, () => ({ entries: data.entries, truncated: data.truncated, loading: false, error: null }))
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : 'Failed to load directory.'
          updatePaneData(paneId, (prev) => ({ ...prev, loading: false, error: message }))
        })
    }, 180)
  }, [apiClient, sessionId, updatePaneData])

  useEffect(() => {
    if (!sessionId) return
    panes.forEach((pane) => {
      fetchDirectory(pane.id, pane.state.path)
    })
  }, [fetchDirectory, panes, sessionId])

  const activeEntries = activePane ? (paneData[activePane.id]?.entries ?? []) : []
  const activeSelection = activePane?.state.selectedPath

  const selectedEntry = useMemo(() => {
    return activeEntries.find((entry) => entry.path === activeSelection) ?? null
  }, [activeEntries, activeSelection])

  // Whether a preview panel should be shown (file selected, not a dir)
  const hasPreview = useMemo(() => {
    return selectedEntry !== null && selectedEntry.type !== 'dir'
  }, [selectedEntry])

  // Mobile swipe slot index: panes[0..n-1] + optional preview slot at panes.length
  const activeMobileSlotIndex = useMemo(() => {
    if (mobileViewingPreview && hasPreview) return panes.length
    return Math.max(0, activePaneIndex)
  }, [mobileViewingPreview, hasPreview, panes.length, activePaneIndex])

  // Auto-reset mobile preview view when file is deselected
  useEffect(() => {
    if (!hasPreview) setMobileViewingPreview(false)
  }, [hasPreview])

  useEffect(() => {
    if (!isMobile) {
      setMobilePaneMenuOpen(false)
    }
  }, [isMobile])

  useEffect(() => {
    setMobilePaneMenuOpen(false)
  }, [activePaneId, mobileViewingPreview])

  const refreshActivePane = useCallback(() => {
    if (!activePane) return
    fetchDirectory(activePane.id, activePane.state.path, true)
  }, [activePane, fetchDirectory])

  const switchPaneByOffset = useCallback((offset: number) => {
    if (panes.length <= 1 || !activePane) return
    const currentIndex = panes.findIndex((pane) => pane.id === activePane.id)
    if (currentIndex < 0) return
    const nextIndex = currentIndex + offset
    if (nextIndex < 0 || nextIndex >= panes.length) return
    setActivePaneId(panes[nextIndex].id)
  }, [activePane, panes])

  const handleNavigate = useCallback((paneId: string, path: string) => {
    updatePaneState(paneId, (prev) => ({ ...prev, path: normalizePath(path), selectedPath: undefined }))
  }, [updatePaneState])

  const handleSelect = useCallback((paneId: string, entry: FileEntry | null) => {
    setActivePaneId(paneId)
    updatePaneState(paneId, (prev) => ({ ...prev, selectedPath: entry?.path }))
    // On mobile: auto-navigate to preview slot when a file is selected
    if (entry && entry.type !== 'dir' && isMobileRef.current) {
      setMobileViewingPreview(true)
    }
  }, [updatePaneState])

  const handleActivate = useCallback((paneId: string, entry: FileEntry) => {
    setActivePaneId(paneId)

    if (entry.type === 'dir') {
      const sourcePane = panes.find((pane) => pane.id === paneId)
      if (!sourcePane) return
      const nextPath = joinPath(sourcePane.state.path, entry.name)
      const nextPane = createPane(nextPath)
      setPanes((previous) => {
        if (isMobileRef.current) return [...previous, nextPane]
        const sourceIndex = previous.findIndex((p) => p.id === paneId)
        if (sourceIndex === -1) return [...previous, nextPane]
        return [...previous.slice(0, sourceIndex + 1), nextPane]
      })
      setActivePaneId(nextPane.id)
      setMobileViewingPreview(false)
      return
    }

    updatePaneState(paneId, (prev) => ({ ...prev, selectedPath: entry.path }))
    if (isMobileRef.current) setMobileViewingPreview(true)
  }, [handleNavigate, panes, updatePaneState])

  const handleSortChange = useCallback((paneId: string, key: 'name' | 'size' | 'mtime') => {
    updatePaneState(paneId, (prev) => {
      const nextDir = prev.sortKey === key && prev.sortDir === 'asc' ? 'desc' : 'asc'
      return { ...prev, sortKey: key, sortDir: nextDir }
    })
  }, [updatePaneState])

  const handleFilterChange = useCallback((paneId: string, value: string) => {
    updatePaneState(paneId, (prev) => ({ ...prev, filter: value }))
  }, [updatePaneState])

  const closeActivePane = useCallback(() => {
    if (!activePane || panes.length <= 1) return
    const currentIndex = panes.findIndex((pane) => pane.id === activePane.id)
    const nextIndex = Math.max(0, currentIndex - 1)
    const remaining = panes.filter((pane) => pane.id !== activePane.id)
    setPanes(remaining)
    setActivePaneId(remaining[nextIndex]?.id ?? remaining[0]?.id ?? null)
  }, [activePane, panes])

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
      if (!sessionId || !activePane) return

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

      if (event.key === 'ArrowLeft' && event.altKey) {
        event.preventDefault()
        switchPaneByOffset(-1)
      }

      if (event.key === 'ArrowRight' && event.altKey) {
        event.preventDefault()
        switchPaneByOffset(1)
      }

      if (event.key === 'Enter' && selectedEntry) {
        event.preventDefault()
        handleActivate(activePane.id, selectedEntry)
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        handleNavigate(activePane.id, dirname(activePane.state.path))
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activePane, focused, handleActivate, handleNavigate, refreshActivePane, selectedEntry, sessionId, switchPaneByOffset])

  const handleUploadClick = useCallback(() => {
    if (!sessionId) return
    fileInputRef.current?.click()
  }, [sessionId])

  const handleUploadFiles = useCallback(async (files: FileList | null) => {
    if (!sessionId || !files || files.length === 0 || !activePane) return
    const targetDir = activePane.state.path
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
  }, [activePane, apiClient, refreshActivePane, sessionId])

  const handleNewFolder = useCallback(async () => {
    if (!sessionId || !activePane) return
    const name = window.prompt('New folder name')
    if (!name) return
    const target = joinPath(activePane.state.path, name)
    setStatus('Creating folder...')
    try {
      await apiClient.mkdirSftpPath(sessionId, target)
      setStatus(`Folder created: ${name}`)
      refreshActivePane()
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Failed to create folder.')
    }
  }, [activePane, apiClient, refreshActivePane, sessionId])

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
    if (!sessionId || !selectedEntry || !activePane) return
    const isDir = selectedEntry.type === 'dir'
    const confirmMessage = isDir ? `Delete folder "${selectedEntry.name}" and its contents?` : `Delete "${selectedEntry.name}"?`
    const confirmed = window.confirm(confirmMessage)
    if (!confirmed) return
    setStatus('Deleting...')
    try {
      await apiClient.deleteSftpPath(sessionId, selectedEntry.path, isDir)
      setStatus('Deleted.')
      updatePaneData(activePane.id, (prev) => ({
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

  // Touch handlers for mobile swipe-track navigation
  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null
  }, [])

  const handleTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current
    const endX = event.changedTouches[0]?.clientX
    touchStartXRef.current = null
    if (startX == null || endX == null) return

    const delta = endX - startX
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return

    const totalSlots = panes.length + (hasPreview ? 1 : 0)

    if (delta < 0) {
      // Swipe left: advance to next slot
      const next = activeMobileSlotIndex + 1
      if (next >= totalSlots) return
      if (next >= panes.length) {
        setMobileViewingPreview(true)
      } else {
        setActivePaneId(panes[next].id)
        setMobileViewingPreview(false)
      }
    } else {
      // Swipe right: go back to previous slot
      if (mobileViewingPreview) {
        setMobileViewingPreview(false)
      } else {
        const prev = activeMobileSlotIndex - 1
        if (prev < 0) return
        setActivePaneId(panes[prev].id)
      }
    }
  }, [activeMobileSlotIndex, hasPreview, mobileViewingPreview, panes])


  // Header subtitle: current path + pane position
  const headerSubtitle = useMemo(() => {
    if (!activePane) return sessionTitle ?? 'No active session'
    const pathLabel = activePane.state.path === '.' ? '~' : activePane.state.path
    const paneLabel = panes.length > 1 ? ` · ${activePaneIndex + 1}/${panes.length}` : ''
    return `${pathLabel}${paneLabel}`
  }, [activePane, activePaneIndex, panes.length, sessionTitle])

  const canGoPrevPane = Boolean(activePane && activePaneIndex > 0)
  const canGoNextPane = Boolean(activePane && activePaneIndex < panes.length - 1)

  return (
    <section
      className="file-manager"
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {!isMobile && (
        <div className="file-manager-header">
          <div className="file-manager-title">
            <h2>{sessionTitle ?? 'Files'}</h2>
            <span className="file-manager-sub">{headerSubtitle}</span>
          </div>
          <div className="file-manager-actions">
            <button type="button" onClick={handleUploadClick} disabled={!sessionId}>⇪ Upload</button>
            <button type="button" onClick={handleDownload} disabled={!downloadUrl}>⇩ Download</button>
            <button type="button" onClick={handleNewFolder} disabled={!sessionId}>📁 New Folder</button>
            <button type="button" onClick={handleRename} disabled={!selectedEntry}>✎ Rename</button>
            <button type="button" onClick={handleDelete} disabled={!selectedEntry}>🗑 Delete</button>
            <button type="button" onClick={closeActivePane} disabled={!activePane || panes.length <= 1}>✕ Close Pane</button>
            <button type="button" onClick={() => switchPaneByOffset(-1)} disabled={!canGoPrevPane}>◀</button>
            <button type="button" onClick={() => switchPaneByOffset(1)} disabled={!canGoNextPane}>▶</button>
            <button type="button" onClick={refreshActivePane} disabled={!sessionId || !activePane}>↻ Refresh</button>
          </div>
        </div>
      )}

      {status && <div className="file-manager-status">{status}</div>}

      {!sessionId && (
        <div className="file-manager-empty">
          <p>No active SSH session. Open a session to browse files.</p>
        </div>
      )}

      {sessionId && activePane && (
        isMobile ? (
          // Mobile: horizontal sliding pane track
          <div className="fm-mobile-container">
            <div
              className="fm-mobile-track-wrapper"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div
                className="fm-mobile-track"
                style={{ transform: `translateX(-${activeMobileSlotIndex * 100}%)` }}
              >
                {panes.map((pane) => {
                  const pData = paneData[pane.id] ?? { entries: [], loading: false, truncated: false }
                  return (
                    <div key={pane.id} className="fm-mobile-slot">
                      <FilePane
                        paneId={pane.id}
                        title={pane.state.path === '.' ? '~' : pane.state.path}
                        state={pane.state}
                        entries={pData.entries}
                        loading={pData.loading}
                        error={pData.error}
                        truncated={pData.truncated}
                        isActive={pane.id === activePane.id}
                        onPathChange={(path) => handleNavigate(pane.id, path)}
                        onSelect={(entry) => handleSelect(pane.id, entry)}
                        onFilterChange={(value) => handleFilterChange(pane.id, value)}
                        onSortChange={(key) => handleSortChange(pane.id, key)}
                        onRefresh={() => fetchDirectory(pane.id, pane.state.path, true)}
                        onActivate={(entry) => handleActivate(pane.id, entry)}
                        onFocus={() => setActivePaneId(pane.id)}
                        rightSlot={pane.id === activePane.id ? (
                          <div className="fm-pane-menu-wrap">
                            <button
                              type="button"
                              className="fm-pane-menu-toggle"
                              aria-label="Pane actions"
                              aria-expanded={mobilePaneMenuOpen}
                              onClick={(event) => {
                                event.stopPropagation()
                                setMobilePaneMenuOpen((open) => !open)
                              }}
                            >
                              <span />
                              <span />
                              <span />
                            </button>
                            {mobilePaneMenuOpen && (
                              <div className="fm-pane-menu" onClick={(event) => event.stopPropagation()}>
                                <button type="button" onClick={() => { setMobilePaneMenuOpen(false); handleUploadClick() }} disabled={!sessionId}>⇪ Upload</button>
                                <button type="button" onClick={() => { setMobilePaneMenuOpen(false); handleDownload() }} disabled={!downloadUrl}>⇩ Download</button>
                                <button type="button" onClick={() => { setMobilePaneMenuOpen(false); void handleNewFolder() }} disabled={!sessionId}>📁 New Folder</button>
                                <button type="button" onClick={() => { setMobilePaneMenuOpen(false); void handleRename() }} disabled={!selectedEntry}>✎ Rename</button>
                                <button type="button" onClick={() => { setMobilePaneMenuOpen(false); void handleDelete() }} disabled={!selectedEntry}>🗑 Delete</button>
                                <button type="button" onClick={() => { setMobilePaneMenuOpen(false); closeActivePane() }} disabled={!activePane || panes.length <= 1}>✕ Close Pane</button>
                                <button type="button" onClick={() => { setMobilePaneMenuOpen(false); switchPaneByOffset(-1) }} disabled={!canGoPrevPane}>◀ Prev Pane</button>
                                <button type="button" onClick={() => { setMobilePaneMenuOpen(false); switchPaneByOffset(1) }} disabled={!canGoNextPane}>▶ Next Pane</button>
                              </div>
                            )}
                          </div>
                        ) : undefined}
                      />
                    </div>
                  )
                })}
                {hasPreview && (
                  <div className="fm-mobile-slot">
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
                      onBack={() => setMobileViewingPreview(false)}
                    />
                  </div>
                )}
              </div>
            </div>
            {/* Dot navigation indicators */}
            <div className="fm-mobile-dots">
              {panes.map((pane, index) => (
                <button
                  key={pane.id}
                  type="button"
                  className={`fm-dot${activeMobileSlotIndex === index ? ' active' : ''}`}
                  onClick={() => {
                    setActivePaneId(pane.id)
                    setMobileViewingPreview(false)
                  }}
                  aria-label={`Pane ${index + 1}`}
                />
              ))}
              {hasPreview && (
                <button
                  type="button"
                  className={`fm-dot fm-dot-preview${activeMobileSlotIndex === panes.length ? ' active' : ''}`}
                  onClick={() => setMobileViewingPreview(true)}
                  aria-label="Preview"
                />
              )}
            </div>
          </div>
        ) : (
          // Desktop multi-pane + optional side preview
          <div className={`fm-desktop-grid${hasPreview ? ' with-preview' : ''}`}>
            {panes.map((pane) => {
              const pData = paneData[pane.id] ?? { entries: [], loading: false, truncated: false }
              return (
                <FilePane
                  key={pane.id}
                  paneId={pane.id}
                  title={pane.state.path === '.' ? '~' : pane.state.path}
                  state={pane.state}
                  entries={pData.entries}
                  loading={pData.loading}
                  error={pData.error}
                  truncated={pData.truncated}
                  isActive={pane.id === activePane?.id}
                  onPathChange={(path) => handleNavigate(pane.id, path)}
                  onSelect={(entry) => handleSelect(pane.id, entry)}
                  onFilterChange={(value) => handleFilterChange(pane.id, value)}
                  onSortChange={(key) => handleSortChange(pane.id, key)}
                  onRefresh={() => fetchDirectory(pane.id, pane.state.path, true)}
                  onActivate={(entry) => handleActivate(pane.id, entry)}
                  onFocus={() => setActivePaneId(pane.id)}
                />
              )
            })}
            {/* Preview panel: always in DOM for smooth transition, hidden when no selection */}
            <div className={`fm-preview-panel${hasPreview ? ' visible' : ''}`}>
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
          </div>
        )
      )}

      {!isMobile && (
        <div className="file-manager-footer">
          <span>
            {activePane ? `Pane ${activePaneIndex + 1}/${panes.length}` : 'No pane'} · {selectedEntry ? selectedEntry.name : 'No selection'}
          </span>
          {selectedEntry && selectedEntry.type !== 'dir' && (
            <span>Size: {formatBytes(selectedEntry.size)}</span>
          )}
        </div>
      )}

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
