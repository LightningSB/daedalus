import React from 'react';
import { VinResult } from '../lib/api';
import { CarLogo } from './CarLogo';

interface ResultCardProps {
  data: VinResult;
  vin: string;
  onExpand: () => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({ data, vin, onExpand }) => {
  const getVehicleImage = () => {
    return `https://placehold.co/600x400/12121a/10b981?text=${encodeURIComponent(`${data.Make} ${data.Model}`)}`;
  };

  return (
    <div className="premium-card rounded-3xl overflow-hidden relative group">
      {/* Ambient glow effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      {/* Vehicle Image Section */}
      <div className="relative h-52 sm:h-64 overflow-hidden">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0f]/50 to-[#0a0a0f] z-10" />
        
        {/* Image */}
        <img
          src={getVehicleImage()}
          alt={`${data.Make} ${data.Model}`}
          className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://placehold.co/600x400/12121a/10b981?text=${encodeURIComponent(data.Make || 'Vehicle')}`;
          }}
        />
        
        {/* Top gradient for badge */}
        <div className="absolute inset-0 bg-gradient-to-t from-transparent via-transparent to-[#0a0a0f]/80 z-20" />
        
        {/* Car Logo Badge */}
        <div className="absolute top-4 right-4 z-30">
          <div className="relative">
            <div className="absolute inset-0 bg-emerald-500/20 rounded-2xl blur-xl" />
            <div className="relative p-3 rounded-2xl bg-[#0a0a0f]/60 backdrop-blur-xl border border-white/10 shadow-xl">
              <CarLogo make={data.Make} size="lg" />
            </div>
          </div>
        </div>
        
        {/* VIN Badge */}
        <div className="absolute bottom-4 left-4 z-30">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0a0a0f]/60 backdrop-blur-xl border border-white/10 shadow-lg">
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span className="text-sm font-mono font-semibold text-white/90 tracking-wider">
              {vin}
            </span>
          </div>
        </div>
        
        {/* Year badge */}
        <div className="absolute bottom-4 right-4 z-30">
          <div className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 backdrop-blur-xl border border-emerald-500/30 shadow-lg">
            <span className="text-lg font-bold text-emerald-400">{data.ModelYear}</span>
          </div>
        </div>
      </div>

      {/* Vehicle Info */}
      <div className="relative p-5 sm:p-6">
        {/* Title */}
        <div className="mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 group-hover:text-emerald-50 transition-colors">
            {data.Make} {data.Model}
          </h2>
          <p className="text-emerald-400/80 font-semibold text-lg">
            {data.Trim || 'Standard Trim'}
          </p>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard
            icon="engine"
            label="Engine"
            value={data.EngineHP ? `${data.EngineHP} HP` : data.DisplacementL ? `${data.DisplacementL}L` : 'N/A'}
            delay={0}
          />
          <StatCard
            icon="transmission"
            label="Transmission"
            value={data.TransmissionStyle?.replace('Transmission', '').trim() || 'N/A'}
            delay={1}
          />
          <StatCard
            icon="body"
            label="Body"
            value={data.BodyClass?.replace('Vehicle', '').trim() || 'N/A'}
            delay={2}
          />
          <StatCard
            icon="drive"
            label="Drive"
            value={data.DriveType || 'N/A'}
            delay={3}
          />
        </div>

        {/* Expand Button */}
        <button
          onClick={onExpand}
          className="w-full py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all duration-300 relative overflow-hidden group/btn"
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.2)'
          }}
        >
          {/* Hover glow */}
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/10 to-emerald-500/0 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-500" />
          
          <span className="relative text-emerald-400 group-hover/btn:text-emerald-300 transition-colors">View Full Details</span>
          <svg className="relative w-5 h-5 text-emerald-400 group-hover/btn:text-emerald-300 group-hover/btn:translate-y-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

interface StatCardProps {
  icon: string;
  label: string;
  value: string;
  delay: number;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, delay }) => {
  const getIcon = () => {
    switch (icon) {
      case 'engine':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
      case 'transmission':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      case 'body':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        );
      case 'drive':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div 
      className="stat-card p-4 group/stat hover:bg-white/[0.05] transition-all duration-300"
      style={{ animationDelay: `${delay * 100}ms` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 group-hover/stat:bg-emerald-500/20 transition-colors">
          {getIcon()}
        </div>
        <span className="text-xs font-medium text-white/40">{label}</span>
      </div>
      <p className="text-sm font-bold text-white truncate group-hover/stat:text-emerald-50 transition-colors">
        {value}
      </p>
    </div>
  );
};
