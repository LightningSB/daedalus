import React from 'react';
import { VinResult } from '../lib/api';

interface ResultCardProps {
  data: VinResult;
  vin: string;
  onExpand: () => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({ data, vin, onExpand }) => {
  const stats = [
    { label: 'Engine', value: data.EngineHP ? `${data.EngineHP} HP` : data.DisplacementL ? `${data.DisplacementL}L` : '—' },
    { label: 'Transmission', value: data.TransmissionStyle?.split(' ')[0] || '—' },
    { label: 'Body', value: data.BodyClass?.replace(/\s*Vehicle/i, '').replace(/\/.*/, '') || '—' },
    { label: 'Drive', value: data.DriveType?.replace(/\/.*/, '') || '—' },
  ];

  return (
    <div className="result-card animate-slide-up">
      <div className="result-header">
        <div className="result-make-model">
          <div>
            <h2 className="result-title">{data.Make} {data.Model}</h2>
            <p className="result-trim">{data.Trim || data.Series || 'Standard'}</p>
          </div>
          <span className="result-year-badge">{data.ModelYear}</span>
        </div>
        
        <div className="result-vin">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 7h-3a2 2 0 01-2-2V2" />
            <path d="M9 18a2 2 0 01-2-2V4a2 2 0 012-2h5l6 6v8a2 2 0 01-2 2H9z" />
            <path d="M3 7.6v12.8A1.6 1.6 0 004.6 22h9.8" />
          </svg>
          <span>{vin}</span>
        </div>
      </div>

      <div className="result-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-item">
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      <button onClick={onExpand} className="view-details-btn">
        View All Specs
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  );
};
