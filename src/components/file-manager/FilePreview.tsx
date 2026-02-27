import type { FileEntry, FileStat, PreviewData } from './utils'
import { formatBytes, formatDate } from './utils'

type FilePreviewProps = {
  entry?: FileEntry | null
  stat?: FileStat | null
  preview?: PreviewData | null
  loading: boolean
  error?: string | null
  mediaKind?: 'image' | 'pdf' | null
  mediaUrl?: string | null
  downloadUrl?: string | null
  onLoadMore?: () => void
  onBack?: () => void
}

export function FilePreview({
  entry,
  stat,
  preview,
  loading,
  error,
  mediaKind,
  mediaUrl,
  downloadUrl,
  onLoadMore,
  onBack,
}: FilePreviewProps) {
  if (!entry) {
    return (
      <section className="file-preview">
        {onBack && (
          <div className="file-preview-nav">
            <button type="button" className="file-preview-back" onClick={onBack}>← Back</button>
          </div>
        )}
        <div className="file-preview-empty">Select a file to preview.</div>
      </section>
    )
  }

  const meta = stat ?? {
    path: entry.path,
    type: entry.type,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    mode: entry.mode,
    isSymlink: false,
  }

  return (
    <section className="file-preview">
      {onBack && (
        <div className="file-preview-nav">
          <button type="button" className="file-preview-back" onClick={onBack}>← Back</button>
        </div>
      )}
      <div className="file-preview-header">
        <div>
          <h3>{entry.name}</h3>
          <p className="file-preview-path">{meta.path}</p>
        </div>
        {downloadUrl && (
          <a className="file-preview-download" href={downloadUrl} target="_blank" rel="noreferrer">
            Download
          </a>
        )}
      </div>

      <div className="file-preview-meta">
        <span>Size: {formatBytes(meta.size)}</span>
        <span>Modified: {formatDate(meta.mtimeMs)}</span>
        <span>Type: {meta.type}{meta.isSymlink ? ' (symlink)' : ''}</span>
      </div>

      {loading && <div className="file-preview-state">Loading preview...</div>}
      {error && !loading && <div className="file-preview-state error">{error}</div>}

      {!error && !loading && mediaKind === 'image' && mediaUrl && (
        <div className="file-preview-media">
          <img src={mediaUrl} alt={entry.name} />
        </div>
      )}

      {!error && !loading && mediaKind === 'pdf' && mediaUrl && (
        <div className="file-preview-media pdf">
          <iframe title={entry.name} src={mediaUrl} />
        </div>
      )}

      {!error && !loading && mediaKind == null && preview?.kind === 'binary' && (
        <div className="file-preview-binary">
          <p>Binary file preview is not available.</p>
          {downloadUrl && (
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              Download to view
            </a>
          )}
        </div>
      )}

      {!error && !loading && mediaKind == null && preview?.kind === 'text' && (
        <div className="file-preview-text">
          {preview.data ? preview.data.split('\n').map((line, index) => (
            <div key={`line-${index}`} className="preview-line">
              <span className="line-number">{index + 1}</span>
              <span className="line-content">{line || ' '}</span>
            </div>
          )) : (
            <div className="file-preview-empty">No content to show.</div>
          )}
          {preview.truncated && onLoadMore && (
            <button type="button" className="file-preview-more" onClick={onLoadMore}>
              Load more
            </button>
          )}
        </div>
      )}
    </section>
  )
}
