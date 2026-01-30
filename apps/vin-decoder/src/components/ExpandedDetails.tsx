import React, { useState } from 'react';
import { VinResult } from '../lib/api';

interface ExpandedDetailsProps {
  data: VinResult;
  vin: string;
  onClose: () => void;
}

export const ExpandedDetails: React.FC<ExpandedDetailsProps> = ({ data, vin, onClose }) => {
  const [tab, setTab] = useState<'specs' | 'safety' | 'info'>('specs');

  const sections = {
    specs: [
      { label: 'Make', value: data.Make },
      { label: 'Model', value: data.Model },
      { label: 'Year', value: data.ModelYear },
      { label: 'Trim', value: data.Trim },
      { label: 'Series', value: data.Series },
      { label: 'Body', value: data.BodyClass },
      { label: 'Drive', value: data.DriveType },
      { label: 'Engine', value: data.DisplacementL ? `${data.DisplacementL}L` : null },
      { label: 'Cylinders', value: data.EngineCylinders },
      { label: 'Power', value: data.EngineHP ? `${data.EngineHP} HP` : null },
      { label: 'Fuel', value: data.FuelTypePrimary },
      { label: 'Transmission', value: data.TransmissionStyle },
      { label: 'Doors', value: data.Doors },
    ],
    safety: [
      { label: 'ABS', value: data.ABS },
      { label: 'ESC', value: data.ESC },
      { label: 'Traction Control', value: data.TractionControl },
      { label: 'Front Airbags', value: data.AirBagLocFront },
      { label: 'TPMS', value: data.TPMS },
    ],
    info: [
      { label: 'Manufacturer', value: data.Manufacturer },
      { label: 'Plant City', value: data.PlantCity },
      { label: 'Plant Country', value: data.PlantCountry },
      { label: 'Vehicle Type', value: data.VehicleType },
      { label: 'GVWR', value: data.GVWR },
    ],
  };

  const specs = sections[tab].filter(s => s.value);
  const tabs = [
    { id: 'specs' as const, label: 'Specs' },
    { id: 'safety' as const, label: 'Safety' },
    { id: 'info' as const, label: 'Info' },
  ];

  return (
    <div className="modal">
      <header className="modal-header">
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 700 }}>{data.Make} {data.Model}</h2>
          <p style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{data.ModelYear} • {vin}</p>
        </div>
        <button onClick={onClose} className="icon-btn" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="modal-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="modal-content">
        {specs.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-3)', padding: '32px' }}>No data available</p>
        ) : (
          specs.map(s => (
            <div key={s.label} className="spec-row">
              <span>{s.label}</span>
              <span>{s.value}</span>
            </div>
          ))
        )}
      </div>

      <div className="modal-footer">
        <button onClick={onClose} className="done-btn">Done</button>
      </div>
    </div>
  );
};
