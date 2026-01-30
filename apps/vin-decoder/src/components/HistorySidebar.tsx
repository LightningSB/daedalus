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
        className="fixed inset-0 bg-black/60 backdrop-blur-md z-40 lg:hidden"
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside className={`
        fixed lg:relative z-50 h-full
        w-80 max-w-[85vw]
        flex flex-col
        animate-slide-in-right lg:animate-none
      `}
      style={{
        background: 'linear-gradient(180deg, rgba(18, 18, 26, 0.95) 0%, rgba(10, 10, 15, 0.98) 100%)',
        backdropFilter: 'blur(20px)',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '4px 0 24px rgba(0, 0, 0, 0.4)'
      }}
      >
        {/* Decorative top gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none" />
        
        {/* Header */}
        <div className="relative flex items-center justify-between p-5 border-b border-white/10 bg-[#0a0a0f]/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center border border-emerald-500/20">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="font-bold text-white text-lg">History</h2>
              <p className="text-xs text-white/40">{history.length} {history.length === 1 ? 'vehicle' : 'vehicles'}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            {history.length > 0 && (
              <button
                onClick={onClear}
                className="w-9 h-9 rounded-lg bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 flex items-center justify-center transition-all duration-200 group"
                title="Clear history"
              >
                <svg className="w-4 h-4 text-white/40 group-hover:text-red-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all duration-200 group lg:hidden"
            >
              <svg className="w-5 h-5 text-white/60 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="relative mb-4">
                <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl" />
                <div className="relative w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                  <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <p className="text-white/50 font-medium">No history yet</p>
              <p className="text-white/30 text-sm mt-1">Decoded VINs will appear here</p>
            </div>
          ) : (
            history.map((record, index) => (
              <button
                key={`${record.vin}-${index}`}
                onClick={() => onSelect(record)}
                className="w-full p-4 text-left group relative overflow-hidden rounded-2xl transition-all duration-300 hover:translate-x-1"
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.06)'
                }}
              >
                {/* Hover glow */}
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                
                <div className="relative flex items-start gap-4">
                  {/* Logo */}
                  <div className="relative flex-shrink-0">
                    <div className="absolute inset-0 bg-emerald-500/20 rounded-xl blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative p-2.5 rounded-xl bg-white/5 group-hover:bg-emerald-500/10 transition-colors border border-white/5 group-hover:border-emerald-500/20">
                      <CarLogo make={record.make} size="sm" />
                    </div>
                  </div>
                  
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm truncate group-hover:text-emerald-50 transition-colors">
                      {record.make} {record.model}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-semibold">
                        {record.year}
                      </span>
                      <span className="text-white/30 text-xs font-mono">
                        {record.vin.slice(0, 8)}...
                      </span>
                    </div>
                  </div>
                  
                  {/* Arrow */}
                  <svg 
                    className="w-5 h-5 text-white/20 group-hover:text-emerald-400 transition-colors flex-shrink-0 mt-1" 
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
          <div className="relative p-4 border-t border-white/10 bg-[#0a0a0f]/30">
            <div className="flex items-center justify-between">
              <p className="text-white/30 text-xs">
                Last {Math.min(history.length, 20)} decoded
              </p>
              <button
                onClick={onClose}
                className="lg:hidden text-xs text-emerald-400 hover:text-emerald-300 font-medium"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
