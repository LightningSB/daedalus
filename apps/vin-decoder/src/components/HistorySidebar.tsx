import React from 'react';
import { HistoryRecord } from '../lib/api';
import { CarLogo } from './CarLogo';

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
      {/* Mobile Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside className={`
        fixed lg:relative z-50 h-full
        w-80 max-w-[85vw]
        bg-[#12121a] border-r border-white/10
        flex flex-col
        animate-slide-in-right lg:animate-none
      `}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[#10b981]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="font-bold text-white">History</h2>
          </div>
          <div className="flex items-center gap-1">
            {history.length > 0 && (
              <button
                onClick={onClear}
                className="p-2 text-white/40 hover:text-red-400 transition-colors"
                title="Clear history"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-white/40 hover:text-white transition-colors lg:hidden"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {history.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
                <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-white/40 text-sm">No history yet</p>
              <p className="text-white/20 text-xs mt-1">Decoded VINs will appear here</p>
            </div>
          ) : (
            history.map((record, index) => (
              <button
                key={`${record.vin}-${index}`}
                onClick={() => onSelect(record)}
                className="history-item w-full p-3 text-left group"
              >
                <div className="flex items-start gap-3">
                  <CarLogo make={record.make} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white text-sm truncate">
                      {record.make} {record.model}
                    </p>
                    <p className="text-[#10b981] text-xs">{record.year}</p>
                    <p className="text-white/40 text-xs font-mono mt-1 truncate">
                      {record.vin}
                    </p>
                  </div>
                  <svg 
                    className="w-4 h-4 text-white/20 group-hover:text-[#10b981] transition-colors flex-shrink-0 mt-1" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div className="p-3 border-t border-white/10 bg-[#0a0a0f]/50">
            <p className="text-center text-white/30 text-xs">
              {history.length} {history.length === 1 ? 'vehicle' : 'vehicles'} in history
            </p>
          </div>
        )}
      </aside>
    </>
  );
};
