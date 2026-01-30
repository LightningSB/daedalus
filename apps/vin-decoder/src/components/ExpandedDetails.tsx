import React, { useState } from 'react';
import { VinResult } from '../lib/api';

interface ExpandedDetailsProps {
  data: VinResult;
  vin: string;
  onClose: () => void;
}

export const ExpandedDetails: React.FC<ExpandedDetailsProps> = ({ data, vin, onClose }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'engine' | 'safety' | 'manufacturing'>('general');

  const tabs = [
    { id: 'general', label: 'General', icon: 'info' },
    { id: 'engine', label: 'Engine', icon: 'bolt' },
    { id: 'safety', label: 'Safety', icon: 'shield' },
    { id: 'manufacturing', label: 'Plant', icon: 'factory' },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] bg-[#12121a] sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-in-bottom sm:animate-slide-up shadow-2xl border border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#0a0a0f]/50">
          <div>
            <h3 className="text-lg font-bold text-white">
              {data.Make} {data.Model}
            </h3>
            <p className="text-sm text-[#10b981]">{vin}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
          >
            <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto scrollbar-hide border-b border-white/10 bg-[#0a0a0f]/30">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'text-[#10b981] border-[#10b981]'
                  : 'text-white/50 border-transparent hover:text-white/80'
              }`}
            >
              <TabIcon name={tab.icon} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-180px)] sm:max-h-[calc(85vh-180px)]">
          {activeTab === 'general' && <GeneralTab data={data} />}
          {activeTab === 'engine' && <EngineTab data={data} />}
          {activeTab === 'safety' && <SafetyTab data={data} />}
          {activeTab === 'manufacturing' && <ManufacturingTab data={data} />}
        </div>
      </div>
    </div>
  );
};

const TabIcon: React.FC<{ name: string }> = ({ name }) => {
  const icons: Record<string, JSX.Element> = {
    info: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    bolt: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
    shield: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
    factory: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  };
  return icons[name] || null;
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
    <span className="text-white/50 text-sm">{label}</span>
    <span className="text-white font-medium text-sm text-right">{value || 'N/A'}</span>
  </div>
);

const GeneralTab: React.FC<{ data: VinResult }> = ({ data }) => (
  <div className="space-y-1">
    <DetailRow label="Year" value={data.ModelYear} />
    <DetailRow label="Make" value={data.Make} />
    <DetailRow label="Model" value={data.Model} />
    <DetailRow label="Trim" value={data.Trim} />
    <DetailRow label="Series" value={data.Series} />
    <DetailRow label="Vehicle Type" value={data.VehicleType} />
    <DetailRow label="Body Class" value={data.BodyClass} />
    <DetailRow label="Doors" value={data.Doors} />
    <DetailRow label="Seats" value={data.Seats} />
    <DetailRow label="GVWR" value={data.GVWR} />
  </div>
);

const EngineTab: React.FC<{ data: VinResult }> = ({ data }) => (
  <div className="space-y-1">
    <DetailRow label="Engine Configuration" value={data.EngineConfiguration} />
    <DetailRow label="Cylinders" value={data.EngineCylinders} />
    <DetailRow label="Displacement" value={data.DisplacementL ? `${data.DisplacementL}L` : ''} />
    <DetailRow label="Horsepower" value={data.EngineHP ? `${data.EngineHP} HP` : ''} />
    <DetailRow label="Fuel Type" value={data.FuelTypePrimary} />
    <DetailRow label="Turbo" value={data.Turbo} />
    <DetailRow label="Transmission" value={data.TransmissionStyle} />
    <DetailRow label="Transmission Speeds" value={data.TransmissionSpeeds} />
    <DetailRow label="Drive Type" value={data.DriveType} />
  </div>
);

const SafetyTab: React.FC<{ data: VinResult }> = ({ data }) => (
  <div className="space-y-1">
    <DetailRow label="Front Airbags" value={data.AirBagLocFront} />
    <DetailRow label="ABS" value={data.ABS} />
    <DetailRow label="Electronic Stability Control" value={data.ESC} />
    <DetailRow label="Traction Control" value={data.TractionControl} />
    <DetailRow label="TPMS" value={data.TPMS} />
  </div>
);

const ManufacturingTab: React.FC<{ data: VinResult }> = ({ data }) => (
  <div className="space-y-1">
    <DetailRow label="Manufacturer" value={data.Manufacturer} />
    <DetailRow label="Plant City" value={data.PlantCity} />
    <DetailRow label="Plant State" value={data.PlantState} />
    <DetailRow label="Plant Country" value={data.PlantCountry} />
  </div>
);
