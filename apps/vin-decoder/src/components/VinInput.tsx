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
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.toUpperCase();
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

  const isValid = value.length === 17;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Label */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-white/60">
          Vehicle Identification Number
        </label>
        <span className={`text-xs font-mono ${isValid ? 'text-emerald-400' : 'text-white/30'}`}>
          {value.length}/17
        </span>
      </div>

      {/* Input */}
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="Enter 17-character VIN"
          maxLength={17}
          disabled={loading}
          className={`
            w-full px-4 py-4 
            bg-black/40 
            border rounded-xl 
            text-lg font-mono font-semibold tracking-wider uppercase 
            text-white placeholder:text-white/20
            focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50
            transition-all
            ${isValid ? 'border-emerald-500/30' : 'border-white/10'}
          `}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Paste Button */}
      <button
        type="button"
        onClick={handlePaste}
        className="flex items-center gap-2 text-sm text-emerald-400/70 hover:text-emerald-400 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        Paste from clipboard
      </button>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading || !isValid}
        className={`
          w-full py-4 rounded-xl font-semibold text-base
          flex items-center justify-center gap-2
          transition-all duration-200
          ${isValid && !loading
            ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.98]'
            : 'bg-white/5 text-white/30 cursor-not-allowed'
          }
        `}
      >
        {loading ? (
          <>
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Decoding...</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>{isValid ? 'Decode VIN' : `Enter ${17 - value.length} more characters`}</span>
          </>
        )}
      </button>
    </form>
  );
};
