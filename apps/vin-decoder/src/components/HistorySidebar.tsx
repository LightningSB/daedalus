import React from 'react';
import { HistoryRecord } from '../lib/api';

interface HistorySidebarProps {
  history: HistoryRecord[];
  isOpen: boolean;
  onClose: () => void;
  onSelect: (record: HistoryRecord) => void;
  onClear: () => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  history,
  isOpen,
  onClose,
  onSelect,
  onClear,
}) => {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 150
        }}
      />
      
      {/* Sidebar */}
      <div className="animate-slide-in" style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: '320px',
        maxWidth: '85vw',
        background: 'var(--bg)',
        borderLeft: '1px solid var(--border)',
        zIndex: 151,
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>History</h2>
          <button onClick={onClose} style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{
                width: '56px',
                height: '56px',
                margin: '0 auto 16px',
                borderRadius: '16px',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>No history yet</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {history.map((record, i) => (
                <button
                  key={`${record.vin}-${i}`}
                  onClick={() => onSelect(record)}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
                      {record.make} {record.model}
                    </p>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'monospace' }}>
                      {record.year} • {record.vin.slice(0, 11)}...
                    </p>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Clear */}
        {history.length > 0 && (
          <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
            <button onClick={onClear} style={{
              width: '100%',
              padding: '14px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)',
              color: '#f87171',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer'
            }}>
              Clear History
            </button>
          </div>
        )}
      </div>
    </>
  );
};
