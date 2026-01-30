import React, { useState } from 'react';
import { VinResult } from '../lib/api';

interface ExpandedDetailsProps {
  data: VinResult;
  vin: string;
  onClose: () => void;
}

export const ExpandedDetails: React.FC<ExpandedDetailsProps> = ({ data, vin, onClose }) => {
  const [activeTab, setActiveTab] = useState<'specs' | 'safety' | 'info'>('specs');

  const sections = {
    specs: [
      { label: 'Make', value: data.Make },
      { label: 'Model', value: data.Model },
      { label: 'Year', value: data.ModelYear },
      { label: 'Trim', value: data.Trim },
      { label: 'Series', value: data.Series },
      { label: 'Body Style', value: data.BodyClass },
      { label: 'Drive Type', value: data.DriveType },
      { label: 'Engine', value: data.DisplacementL ? `${data.DisplacementL}L` : null },
      { label: 'Cylinders', value: data.EngineCylinders },
      { label: 'Horsepower', value: data.EngineHP ? `${data.EngineHP} HP` : null },
      { label: 'Fuel Type', value: data.FuelTypePrimary },
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

  const currentSpecs = sections[activeTab].filter(s => s.value);
  const tabs = [
    { id: 'specs' as const, label: 'Specs' },
    { id: 'safety' as const, label: 'Safety' },
    { id: 'info' as const, label: 'Info' },
  ];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)'
      }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>{data.Make} {data.Model}</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{data.ModelYear} • {vin}</p>
        </div>
        <button onClick={onClose} style={{
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        padding: '0 20px',
        gap: '8px',
        borderBottom: '1px solid var(--border)'
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '14px 16px',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-1px'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {currentSpecs.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
            No data available
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentSpecs.map(spec => (
              <div key={spec.label} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                background: 'var(--card)',
                borderRadius: '12px',
                border: '1px solid var(--border)'
              }}>
                <span style={{ fontSize: '14px', color: 'var(--text-dim)' }}>{spec.label}</span>
                <span style={{ fontSize: '14px', fontWeight: 600, textAlign: 'right', maxWidth: '55%' }}>{spec.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Close Button */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
        <button onClick={onClose} style={{
          width: '100%',
          padding: '16px',
          borderRadius: '14px',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          fontSize: '15px',
          fontWeight: 600,
          cursor: 'pointer'
        }}>
          Done
        </button>
      </div>
    </div>
  );
};
