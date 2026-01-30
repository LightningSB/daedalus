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
    <form onSubmit={handleSubmit}>
      {/* Label */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: '12px'
      }}>
        <label style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)' }}>
          Vehicle Identification Number
        </label>
        <span style={{ 
          fontSize: '12px', 
          fontFamily: 'monospace',
          color: isValid ? '#10b981' : 'rgba(255,255,255,0.3)'
        }}>
          {value.length}/17
        </span>
      </div>

      {/* Input */}
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="ENTER 17-CHARACTER VIN"
          maxLength={17}
          disabled={loading}
          style={{
            width: '100%',
            padding: '16px',
            paddingRight: value ? '48px' : '16px',
            background: 'rgba(0,0,0,0.4)',
            border: `1px solid ${isValid ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '12px',
            fontSize: '16px',
            fontFamily: 'monospace',
            fontWeight: '600',
            letterSpacing: '2px',
            color: 'white',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.6)'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Paste Button */}
      <button
        type="button"
        onClick={handlePaste}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'none',
          border: 'none',
          color: 'rgba(16,185,129,0.7)',
          fontSize: '14px',
          cursor: 'pointer',
          padding: '4px 0',
          marginBottom: '16px'
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        Paste from clipboard
      </button>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading || !isValid}
        style={{
          width: '100%',
          padding: '16px',
          borderRadius: '12px',
          border: 'none',
          fontWeight: '600',
          fontSize: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          cursor: isValid && !loading ? 'pointer' : 'not-allowed',
          background: isValid && !loading 
            ? 'linear-gradient(135deg, #10b981, #059669)' 
            : 'rgba(255,255,255,0.05)',
          color: isValid && !loading ? 'white' : 'rgba(255,255,255,0.3)',
          boxShadow: isValid && !loading ? '0 4px 16px rgba(16,185,129,0.3)' : 'none',
          transition: 'all 0.2s'
        }}
      >
        {loading ? (
          <>
            <svg 
              width="20" 
              height="20" 
              viewBox="0 0 24 24" 
              fill="none" 
              style={{ animation: 'spin 1s linear infinite' }}
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Decoding...</span>
          </>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>{isValid ? 'Decode VIN' : `Enter ${17 - value.length} more characters`}</span>
          </>
        )}
      </button>
      
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </form>
  );
};
