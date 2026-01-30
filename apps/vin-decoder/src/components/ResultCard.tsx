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
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Vehicle Image */}
      <div className="relative h-48 sm:h-56 bg-gradient-to-b from-white/5 to-transparent">
        <img
          src={getVehicleImage()}
          alt={`${data.Make} ${data.Model}`}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://placehold.co/600x400/12121a/10b981?text=${encodeURIComponent(data.Make || 'Vehicle')}`;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-transparent to-transparent" />
        
        {/* Car Logo Badge */}
        <div className="absolute top-4 right-4">
          <CarLogo make={data.Make} size="lg" />
        </div>
        
        {/* VIN Badge */}
        <div className="absolute bottom-4 left-4">
          <span className="px-3 py-1.5 bg-white/10 backdrop-blur-md rounded-lg text-xs font-mono text-white/80 border border-white/10">
            {vin}
          </span>
        </div>
      </div>

      {/* Vehicle Info */}
      <div className="p-4 sm:p-5">
        {/* Title */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              {data.Make} {data.Model}
            </h2>
            <p className="text-[#10b981] font-semibold text-lg">
              {data.ModelYear} {data.Trim}
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatCard
            icon="engine"
            label="Engine"
            value={data.EngineHP ? `${data.EngineHP} HP` : data.DisplacementL ? `${data.DisplacementL}L` : 'N/A'}
          />
          <StatCard
            icon="transmission"
            label="Transmission"
            value={data.TransmissionStyle?.replace('Transmission', '').trim() || 'N/A'}
          />
          <StatCard
            icon="body"
            label="Body"
            value={data.BodyClass?.replace('Vehicle', '').trim() || 'N/A'}
          />
          <StatCard
            icon="drive"
            label="Drive"
            value={data.DriveType || 'N/A'}
          />
        </div>

        {/* Expand Button */}
        <button
          onClick={onExpand}
          className="w-full btn-secondary py-3 flex items-center justify-center gap-2 text-[#10b981] border-[#10b981]/30 hover:bg-[#10b981]/10"
        >
          <span>View Full Details</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value }) => {
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
    <div className="bg-white/5 rounded-xl p-3 border border-white/5">
      <div className="flex items-center gap-2 text-[#10b981] mb-1">
        {getIcon()}
        <span className="text-xs font-medium text-white/50">{label}</span>
      </div>
      <p className="text-sm font-semibold text-white truncate">{value}</p>
    </div>
  );
};
