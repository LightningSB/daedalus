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
      <div className="premium-card rounded-2xl p-6 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl" />
        
        <div className="relative">
          {/* Label with icon */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <label className="text-sm font-semibold text-white/80">
              Vehicle Identification Number
            </label>
          </div>
          
          {/* Input container */}
          <div className="relative group">
            {/* Animated border on focus */}
            <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-r from-emerald-500/0 via-emerald-500/0 to-emerald-500/0 group-focus-within:from-emerald-500/50 group-focus-within:via-emerald-400/50 group-focus-within:to-emerald-500/50 transition-all duration-500" />
            
            <input
              type="text"
              value={value}
              onChange={handleChange}
              placeholder="Enter 17-character VIN"
              maxLength={17}
              className={`relative w-full px-5 py-5 pr-32 bg-[#0a0a0f]/80 border rounded-2xl text-lg font-bold tracking-widest uppercase text-white placeholder:text-white/20 focus:outline-none transition-all duration-300 ${
                error 
                  ? 'border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.15)]' 
                  : 'border-white/10 group-focus-within:border-emerald-500/50 group-focus-within:shadow-[0_0_30px_rgba(16,185,129,0.15)]'
              }`}
              disabled={loading}
              style={{ fontFamily: 'monospace' }}
            />
            
            {/* Character count badge */}
            <div className={`absolute right-16 top-1/2 -translate-y-1/2 px-3 py-1 rounded-full text-xs font-bold transition-all duration-300 ${
              value.length === 17 
                ? 'bg-emerald-500/20 text-emerald-400' 
                : 'bg-white/5 text-white/30'
            }`}>
              {value.length}/17
            </div>
            
            {/* Clear button */}
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all duration-200 group/clear"
              >
                <svg className="w-4 h-4 text-white/40 group-hover/clear:text-white/70 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          
          {/* Paste button */}
          <button
            type="button"
            onClick={handlePaste}
            className="mt-4 text-sm text-emerald-400/70 hover:text-emerald-400 font-medium flex items-center gap-2 transition-colors group/paste"
          >
            <div className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center group-hover/paste:bg-emerald-500/20 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <span>Paste from clipboard</span>
          </button>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading || value.length < 17}
        className="w-full mt-4 py-4 px-6 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all duration-300 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none"
        style={{
          background: value.length === 17 && !loading 
            ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
            : 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
          boxShadow: value.length === 17 && !loading 
            ? '0 4px 20px rgba(16, 185, 129, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)' 
            : 'none'
        }}
      >
        {/* Shine effect */}
        {value.length === 17 && !loading && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
        )}
        
        {loading ? (
          <>
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-white/80">Decoding VIN...</span>
          </>
        ) : (
          <>
            <svg className={`w-5 h-5 transition-transform duration-300 ${value.length === 17 ? 'group-hover:scale-110' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className={value.length === 17 ? 'text-white' : 'text-white/40'}>
              {value.length < 17 ? `Enter ${17 - value.length} more characters` : 'Decode VIN'}
            </span>
          </>
        )}
      </button>
    </form>
  );
};
