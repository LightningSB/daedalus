import React, { useState } from 'react';
import { VinResult } from '../lib/api';

interface ExpandedDetailsProps {
  data: VinResult;
  vin: string;
  onClose: () => void;
}

export const ExpandedDetails: React.FC<ExpandedDetailsProps> = ({ data, vin, onClose }) => {
  const [activeTab, setActiveTab] = useState<'specs' | 'safety' | 'other'>('specs');

  const specSections = {
    specs: [
      { label: 'Make', value: data.Make },
      { label: 'Model', value: data.Model },
      { label: 'Year', value: data.ModelYear },
      { label: 'Trim', value: data.Trim },
      { label: 'Body Class', value: data.BodyClass },
      { label: 'Drive Type', value: data.DriveType },
      { label: 'Engine Size', value: data.DisplacementL ? `${data.DisplacementL}L` : null },
      { label: 'Engine Config', value: data.EngineConfiguration },
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
      { label: 'Front Airbag', value: data.AirBagLocFront },
      { label: 'Side Airbag', value: data.AirBagLocSide },
      { label: 'Curtain Airbag', value: data.AirBagLocCurtain },
      { label: 'TPMS', value: data.TPMS },
      { label: 'Backup Camera', value: data.RearVisibilitySystem },
    ],
    other: [
      { label: 'Manufacturer', value: data.Manufacturer },
      { label: 'Plant City', value: data.PlantCity },
      { label: 'Plant Country', value: data.PlantCountry },
      { label: 'Vehicle Type', value: data.VehicleType },
      { label: 'GVWR', value: data.GVWR },
      { label: 'Series', value: data.Series },
    ],
  };

  const filteredSpecs = specSections[activeTab].filter(s => s.value);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5 bg-[#0a0a0f]/90 backdrop-blur-xl">
        <div>
          <h2 className="text-lg font-bold text-white">
            {data.Make} {data.Model}
          </h2>
          <p className="text-xs text-white/40">{data.ModelYear} • {vin}</p>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
        >
          <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 px-4">
        {(['specs', 'safety', 'other'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`
              px-4 py-3 text-sm font-medium capitalize transition-colors relative
              ${activeTab === tab ? 'text-emerald-400' : 'text-white/40 hover:text-white/60'}
            `}
          >
            {tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2 max-w-lg mx-auto">
          {filteredSpecs.length === 0 ? (
            <div className="text-center py-12 text-white/40">
              No {activeTab} data available
            </div>
          ) : (
            filteredSpecs.map((spec, index) => (
              <div 
                key={spec.label}
                className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/[0.02] border border-white/5"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <span className="text-sm text-white/50">{spec.label}</span>
                <span className="text-sm font-medium text-white text-right max-w-[60%] truncate">
                  {spec.value}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Close Button */}
      <div className="p-4 border-t border-white/5">
        <button
          onClick={onClose}
          className="w-full py-4 rounded-xl bg-white/5 text-white font-medium hover:bg-white/10 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};
