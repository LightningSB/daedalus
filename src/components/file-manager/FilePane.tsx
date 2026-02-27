import type { ReactNode } from 'react'
import type { FileEntry, SortDir, SortKey } from './utils'
import { dirname, filterEntries, formatBytes, formatDate, sortEntries } from './utils'

export type FilePaneState = {
  path: string
  filter: string
  sortKey: SortKey
  sortDir: SortDir
  selectedPath?: string
}

type FilePaneProps = {
  paneId: string
  title: string
  state: FilePaneState
  entries: FileEntry[]
  loading: boolean
  error?: string | null
  truncated: boolean
  isActive: boolean
  onPathChange: (path: string) => void
  onSelect: (entry: FileEntry | null) => void
  onFilterChange: (value: string) => void
  onSortChange: (key: SortKey) => void
  onRefresh: () => void
  onActivate: (entry: FileEntry) => void
  onFocus: () => void
  rightSlot?: ReactNode
}

export function FilePane({
  paneId,
  title,
  state,
  entries,
  loading,
  error,
  truncated,
  isActive,
  onPathChange,
  onSelect,
  onFilterChange,
  onSortChange,
  onRefresh,
  onActivate,
  onFocus,
  rightSlot,
}: FilePaneProps) {
  const filtered = filterEntries(entries, state.filter)
  const sorted = sortEntries(filtered, state.sortKey, state.sortDir)

  return (
    <section className={`file-pane ${isActive ? 'active' : ''}`} data-pane={paneId} onClick={onFocus}>
      <div className="file-pane-header">
        <div className="file-pane-title">
          <span>{title}</span>
          <div className="file-pane-title-actions">
            {rightSlot}
            <button
              type="button"
              className="file-refresh"
              onClick={() => onPathChange(dirname(state.path))}
              title="Go Up"
              aria-label="Go Up"
            >
              <span className="file-icon-up" aria-hidden>↖</span>
            </button>
            <button type="button" className="file-refresh" onClick={onRefresh} title="Refresh" aria-label="Refresh">
              <span className="file-icon-refresh" aria-hidden>↻</span>
            </button>
          </div>
        </div>
        <div className="file-path-display" title={state.path === '.' ? '~' : state.path}>
          <span className="file-path-label">Path</span>
          <code>{state.path === '.' ? '~' : state.path}</code>
        </div>
        <div className="file-pane-controls">
          <input
            type="text"
            value={state.filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Filter..."
            className="file-filter"
          />
        </div>
      </div>

      <div className="file-list-header">
        <button
          type="button"
          className="file-col name"
          onClick={() => onSortChange('name')}
        >
          Name {state.sortKey === 'name' && <span>{state.sortDir === 'asc' ? '▲' : '▼'}</span>}
        </button>
        <button
          type="button"
          className="file-col size"
          onClick={() => onSortChange('size')}
        >
          Size {state.sortKey === 'size' && <span>{state.sortDir === 'asc' ? '▲' : '▼'}</span>}
        </button>
        <button
          type="button"
          className="file-col mtime"
          onClick={() => onSortChange('mtime')}
        >
          Modified {state.sortKey === 'mtime' && <span>{state.sortDir === 'asc' ? '▲' : '▼'}</span>}
        </button>
      </div>

      <div className="file-list" role="list">
        {loading && <div className="file-state">Loading directory...</div>}
        {error && !loading && <div className="file-state error">{error}</div>}
        {!error && !loading && sorted.length === 0 && (
          <div className="file-state empty">No files match this view.</div>
        )}
        {!error && !loading && sorted.map((entry) => {
          const isSelected = entry.path === state.selectedPath
          return (
            <button
              key={`${paneId}-${entry.path}`}
              type="button"
              className={`file-row ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onActivate(entry)}
              title={entry.path}
            >
              <span className={`file-icon ${entry.type}`}>
                {entry.type === 'dir' ? '📁' : entry.type === 'symlink' ? '🔗' : '📄'}
              </span>
              <span className="file-name">{entry.name}</span>
              <span className="file-size">{entry.type === 'dir' ? '-' : formatBytes(entry.size)}</span>
              <span className="file-mtime">{formatDate(entry.mtimeMs)}</span>
            </button>
          )
        })}
      </div>

      {truncated && !loading && !error && (
        <div className="file-truncated">Showing first {entries.length} entries.</div>
      )}
    </section>
  )
}
