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
    if (value.length === 17 && !loading) {
      onSubmit(value);
    }
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
    <form onSubmit={handleSubmit} className="vin-card">
      <div className="vin-label">
        <span className="vin-label-text">Vehicle ID Number</span>
        <span className={`vin-count ${isValid ? '' : 'incomplete'}`}>
          {value.length}/17
        </span>
      </div>

      <div className="vin-input-wrapper">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="Enter VIN..."
          maxLength={17}
          disabled={loading}
          className="vin-input"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        {value && (
          <button type="button" onClick={() => onChange('')} className="clear-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <button type="button" onClick={handlePaste} className="paste-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
        Paste
      </button>

      <button
        type="submit"
        disabled={loading || !isValid}
        className={`decode-btn ${isValid && !loading ? 'active' : 'inactive'}`}
      >
        {loading ? (
          <>
            <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Decoding...
          </>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            {isValid ? 'Decode VIN' : `${17 - value.length} more`}
          </>
        )}
      </button>
    </form>
  );
};
