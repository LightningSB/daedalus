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
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      
      {/* Sidebar */}
      <div className="fixed right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-[#0a0a0f] border-l border-white/10 z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h2 className="text-lg font-bold text-white">History</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-4">
          {history.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
                <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-white/40 text-sm">No history yet</p>
              <p className="text-white/20 text-xs mt-1">Decoded VINs will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((record, index) => (
                <button
                  key={`${record.vin}-${index}`}
                  onClick={() => onSelect(record)}
                  className="w-full p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-emerald-500/20 transition-all text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-white text-sm truncate group-hover:text-emerald-50">
                        {record.make} {record.model}
                      </p>
                      <p className="text-xs text-white/40 mt-0.5">{record.year}</p>
                    </div>
                    <svg className="w-4 h-4 text-white/20 group-hover:text-emerald-400 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <p className="text-xs font-mono text-white/30 mt-2 truncate">{record.vin}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Clear Button */}
        {history.length > 0 && (
          <div className="p-4 border-t border-white/5">
            <button
              onClick={onClear}
              className="w-full py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium hover:bg-red-500/20 transition-colors"
            >
              Clear History
            </button>
          </div>
        )}
      </div>
    </>
  );
};
