import React from 'react';

interface VinInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (vin: string) => void;
  loading: boolean;
  error: string | null;
}

export const VinInput: React.FC<VinInputProps> = ({
  value,
  onChange,
  onSubmit,
  loading,
  error,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.toUpperCase();
    // Only allow alphanumeric characters, remove I, O, Q
    const cleaned = rawValue
      .replace(/[^A-Z0-9]/g, '')
      .replace(/[IOQ]/g, '')
      .slice(0, 17);
    onChange(cleaned);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  const handleClear = () => {
    onChange('');
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = text
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .replace(/[IOQ]/g, '')
        .slice(0, 17);
      onChange(cleaned);
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        <label className="block text-sm font-medium text-white/60 mb-2">
          Vehicle Identification Number
        </label>
        
        <div className="relative">
          <input
            type="text"
            value={value}
            onChange={handleChange}
            placeholder="Enter 17-character VIN"
            maxLength={17}
            className={`vin-input w-full px-4 py-4 pr-24 ${
              error ? 'border-red-500/50' : ''
            }`}
            disabled={loading}
          />
          
          {/* Character count */}
          <div className="absolute right-16 top-1/2 -translate-y-1/2 text-sm font-medium text-white/30">
            {value.length}/17
          </div>
          
          {/* Clear button */}
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/60 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        
        {/* Paste button for mobile */}
        <button
          type="button"
          onClick={handlePaste}
          className="mt-2 text-sm text-[#10b981] hover:text-[#059669] font-medium flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Paste from clipboard
        </button>
      </div>

      <button
        type="submit"
        disabled={loading || value.length < 17}
        className="btn-primary w-full mt-4 py-4 text-lg flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Decoding...</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>Decode VIN</span>
          </>
        )}
      </button>
    </form>
  );
};
