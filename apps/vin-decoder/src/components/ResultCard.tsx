import React from 'react';
import { VinResult } from '../lib/api';

interface ResultCardProps {
  data: VinResult;
  vin: string;
  onExpand: () => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({ data, vin, onExpand }) => {
  return (
    <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-white/5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              {data.Make} {data.Model}
            </h2>
            <p className="text-emerald-400 font-medium mt-1">
              {data.ModelYear} • {data.Trim || 'Standard'}
            </p>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <span className="text-emerald-400 font-bold text-sm">{data.ModelYear}</span>
          </div>
        </div>
        
        {/* VIN */}
        <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-black/30 border border-white/5">
          <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <span className="text-xs font-mono text-white/60 tracking-wider">{vin}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-px bg-white/5">
        <StatItem 
          label="Engine" 
          value={data.EngineHP ? `${data.EngineHP} HP` : data.DisplacementL ? `${data.DisplacementL}L` : 'N/A'} 
          icon="⚡"
        />
        <StatItem 
          label="Transmission" 
          value={data.TransmissionStyle?.split(' ')[0] || 'N/A'} 
          icon="⚙️"
        />
        <StatItem 
          label="Body Style" 
          value={data.BodyClass?.replace(/ Vehicle/i, '') || 'N/A'} 
          icon="🚗"
        />
        <StatItem 
          label="Drive Type" 
          value={data.DriveType || 'N/A'} 
          icon="🔧"
        />
      </div>

      {/* Expand Button */}
      <button
        onClick={onExpand}
        className="w-full py-4 flex items-center justify-center gap-2 text-emerald-400 font-medium hover:bg-white/5 transition-colors border-t border-white/5"
      >
        <span>View Full Details</span>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
};

interface StatItemProps {
  label: string;
  value: string;
  icon: string;
}

const StatItem: React.FC<StatItemProps> = ({ label, value, icon }) => (
  <div className="p-4 bg-[#0a0a0f]">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-sm">{icon}</span>
      <span className="text-xs text-white/40">{label}</span>
    </div>
    <p className="text-sm font-semibold text-white truncate">{value}</p>
  </div>
);
