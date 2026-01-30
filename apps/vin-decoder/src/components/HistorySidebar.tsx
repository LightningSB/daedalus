import React from 'react';
import { HistoryRecord } from '../lib/api';

interface HistorySidebarProps {
  history: HistoryRecord[];
  onClose: () => void;
  onSelect: (record: HistoryRecord) => void;
  onClear: () => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  history,
  onClose,
  onSelect,
  onClear,
}) => {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="sidebar">
        <header className="sidebar-header">
          <h2>History</h2>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="sidebar-content">
          {history.length === 0 ? (
            <div className="empty-history">
              <div className="empty-history-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <p style={{ fontSize: '13px' }}>No history yet</p>
            </div>
          ) : (
            history.map((r, i) => (
              <button key={`${r.vin}-${i}`} onClick={() => onSelect(r)} className="history-item">
                <div className="history-item-text">
                  <h3>{r.make} {r.model}</h3>
                  <p>{r.year} • {r.vin.slice(0, 11)}...</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ))
          )}
        </div>

        {history.length > 0 && (
          <div className="sidebar-footer">
            <button onClick={onClear} className="clear-history-btn">Clear History</button>
          </div>
        )}
      </aside>
    </>
  );
};
