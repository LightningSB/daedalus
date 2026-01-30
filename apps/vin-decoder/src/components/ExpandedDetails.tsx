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
      {/* Backdrop with blur */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] bg-[#12121a] sm:rounded-3xl rounded-t-3xl overflow-hidden animate-slide-in-bottom sm:animate-slide-up shadow-2xl border border-white/10">
        {/* Header */}
        <div className="relative overflow-hidden">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-transparent to-blue-500/5" />
          
          <div className="relative flex items-center justify-between p-5 sm:p-6 border-b border-white/10">
            <div className="flex items-center gap-4">
              {/* Vehicle icon */}
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center border border-emerald-500/20">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
              </div>
              
              <div>
                <h3 className="text-xl font-bold text-white">
                  {data.Make} {data.Model}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-mono font-semibold">
                    {vin}
                  </span>
                  <span className="text-white/40 text-sm">{data.ModelYear}</span>
                </div>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all duration-200 group"
            >
              <svg className="w-5 h-5 text-white/60 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto scrollbar-hide border-b border-white/10 bg-[#0a0a0f]/50">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-semibold whitespace-nowrap transition-all duration-300 border-b-2 relative ${
                activeTab === tab.id
                  ? 'text-emerald-400 border-emerald-500'
                  : 'text-white/40 border-transparent hover:text-white/70'
              }`}
            >
              <TabIcon name={tab.icon} active={activeTab === tab.id} />
              <span>{tab.label}</span>
              
              {/* Active indicator glow */}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-emerald-400 blur-sm" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 overflow-y-auto max-h-[calc(90vh-200px)] sm:max-h-[calc(85vh-200px)] bg-gradient-to-b from-[#0a0a0f]/30 to-transparent">
          {activeTab === 'general' && <GeneralTab data={data} />}
          {activeTab === 'engine' && <EngineTab data={data} />}
          {activeTab === 'safety' && <SafetyTab data={data} />}
          {activeTab === 'manufacturing' && <ManufacturingTab data={data} />}
        </div>
      </div>
    </div>
  );
};

const TabIcon: React.FC<{ name: string; active: boolean }> = ({ name, active }) => {
  const icons: Record<string, JSX.Element> = {
    info: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    bolt: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
    shield: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
    factory: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  };
  return (
    <span className={active ? 'text-emerald-400' : ''}>
      {icons[name] || null}
    </span>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center py-3 px-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 transition-colors group">
    <div className="flex items-center gap-3">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50 group-hover:bg-emerald-400 transition-colors" />
      <span className="text-white/50 text-sm font-medium">{label}</span>
    </div>
    <span className="text-white font-semibold text-sm text-right">{value || 'N/A'}</span>
  </div>
);

const GeneralTab: React.FC<{ data: VinResult }> = ({ data }) => (
  <div className="space-y-2">
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
  <div className="space-y-2">
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
  <div className="space-y-2">
    <DetailRow label="Front Airbags" value={data.AirBagLocFront} />
    <DetailRow label="ABS" value={data.ABS} />
    <DetailRow label="Electronic Stability Control" value={data.ESC} />
    <DetailRow label="Traction Control" value={data.TractionControl} />
    <DetailRow label="TPMS" value={data.TPMS} />
  </div>
);

const ManufacturingTab: React.FC<{ data: VinResult }> = ({ data }) => (
  <div className="space-y-2">
    <DetailRow label="Manufacturer" value={data.Manufacturer} />
    <DetailRow label="Plant City" value={data.PlantCity} />
    <DetailRow label="Plant State" value={data.PlantState} />
    <DetailRow label="Plant Country" value={data.PlantCountry} />
  </div>
);
