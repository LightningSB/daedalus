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
    { label: 'Trans', value: data.TransmissionStyle?.split(' ')[0] || '—' },
    { label: 'Body', value: data.BodyClass?.replace(/\s*Vehicle/i, '').split('/')[0] || '—' },
    { label: 'Drive', value: data.DriveType?.split('/')[0] || '—' },
  ];

  return (
    <div className="result-card">
      <div className="result-hero">
        <div className="result-title-row">
          <div>
            <h2 className="result-title">{data.Make} {data.Model}</h2>
            <p className="result-trim">{data.Trim || data.Series || 'Standard'}</p>
          </div>
          <span className="result-year">{data.ModelYear}</span>
        </div>
        <div className="result-vin">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 7h-3a2 2 0 01-2-2V2" />
            <path d="M9 18a2 2 0 01-2-2V4a2 2 0 012-2h5l6 6v8a2 2 0 01-2 2H9z" />
          </svg>
          <span>{vin}</span>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      <button onClick={onExpand} className="details-btn">
        View All Specs
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  );
};
