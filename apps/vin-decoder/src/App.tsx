import React, { useState, useCallback } from 'react';
import { VinInput } from './components/VinInput';
import { ResultCard } from './components/ResultCard';
import { ExpandedDetails } from './components/ExpandedDetails';
import { HistorySidebar } from './components/HistorySidebar';
import { useTelegram } from './hooks/useTelegram';
import { useDuckDB } from './hooks/useDuckDB';
import { decodeVin, saveHistory, VinResult, HistoryRecord } from './lib/api';

const App: React.FC = () => {
  const [vin, setVin] = useState('');
  const [result, setResult] = useState<VinResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const { tgUserId } = useTelegram();
  const { conn, isLoading: dbLoading } = useDuckDB();

  const handleVinSubmit = useCallback(async (submittedVin: string) => {
    if (submittedVin.length !== 17) {
      setError('VIN must be exactly 17 characters');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setShowDetails(false);

    try {
      const response = await decodeVin(submittedVin);
      
      if (response.Results && response.Results.length > 0) {
        const vehicleData = response.Results[0];
        
        if (vehicleData.ErrorText) {
          setError(vehicleData.ErrorText);
        } else {
          setResult(vehicleData);
          
          const historyRecord: HistoryRecord = {
            vin: submittedVin,
            make: vehicleData.Make || 'Unknown',
            model: vehicleData.Model || 'Unknown',
            year: vehicleData.ModelYear || 'Unknown',
            data: vehicleData,
          };
          
          setHistory(prev => [historyRecord, ...prev.slice(0, 19)]);
          
          if (tgUserId) {
            await saveHistory(tgUserId, historyRecord);
          }
          
          if (conn) {
            try {
              await conn.query(`
                INSERT INTO vin_history (vin, make, model, year, data, timestamp)
                VALUES ('${submittedVin}', '${vehicleData.Make || ''}', '${vehicleData.Model || ''}', '${vehicleData.ModelYear || ''}', '${JSON.stringify(vehicleData).replace(/'/g, "''")}', '${Date.now()}')
                ON CONFLICT (vin) DO UPDATE SET
                  make = excluded.make,
                  model = excluded.model,
                  year = excluded.year,
                  data = excluded.data,
                  timestamp = excluded.timestamp
              `);
            } catch (dbError) {
              console.error('Failed to save to DuckDB:', dbError);
            }
          }
        }
      } else {
        setError('No results found for this VIN');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decode VIN');
    } finally {
      setLoading(false);
    }
  }, [tgUserId, conn]);

  const handleHistorySelect = useCallback((record: HistoryRecord) => {
    setVin(record.vin);
    setResult(record.data);
    setShowDetails(false);
    setError(null);
    setShowHistory(false);
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0a0a0f', 
      color: 'white',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(10,10,15,0.9)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(16,185,129,0.3)'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>VIN Decoder</h1>
            <p style={{ fontSize: '12px', color: 'rgba(16,185,129,0.7)', margin: 0 }}>Vehicle Lookup</p>
          </div>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {history.length > 0 && (
            <span style={{
              background: '#10b981',
              color: 'white',
              fontSize: '11px',
              fontWeight: 'bold',
              padding: '2px 6px',
              borderRadius: '10px',
              minWidth: '20px',
              textAlign: 'center'
            }}>
              {history.length}
            </span>
          )}
        </button>
      </header>

      {/* Main Content */}
      <main style={{ 
        flex: 1, 
        padding: '16px',
        maxWidth: '500px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {/* VIN Input Card */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: '20px'
        }}>
          <VinInput
            value={vin}
            onChange={setVin}
            onSubmit={handleVinSubmit}
            loading={loading || dbLoading}
            error={error}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            marginTop: '16px',
            padding: '16px',
            borderRadius: '12px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: '#f87171'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span style={{ fontSize: '14px', fontWeight: '500' }}>{error}</span>
          </div>
        )}

        {/* Result Card */}
        {result && (
          <div style={{ marginTop: '24px' }}>
            <ResultCard
              data={result}
              vin={vin}
              onExpand={() => setShowDetails(true)}
            />
          </div>
        )}

        {/* Empty State */}
        {!result && !loading && !error && (
          <div style={{ 
            marginTop: '48px', 
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.05))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '24px'
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(16,185,129,0.6)" strokeWidth="1.5">
                <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              margin: '0 0 8px 0' 
            }}>
              Ready to Decode
            </h3>
            <p style={{ 
              fontSize: '14px', 
              color: 'rgba(255,255,255,0.4)', 
              margin: 0,
              maxWidth: '280px',
              lineHeight: '1.5'
            }}>
              Enter a 17-character VIN to get detailed vehicle information
            </p>
            
            <div style={{ 
              marginTop: '24px', 
              display: 'flex', 
              flexWrap: 'wrap', 
              justifyContent: 'center',
              gap: '8px' 
            }}>
              {['Instant Results', 'Full Specs', 'History'].map((feature) => (
                <span key={feature} style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  fontSize: '12px',
                  color: 'rgba(255,255,255,0.4)'
                }}>
                  ✓ {feature}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* History Sidebar */}
      <HistorySidebar
        history={history}
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        onSelect={handleHistorySelect}
        onClear={handleClearHistory}
      />

      {/* Expanded Details Modal */}
      {showDetails && result && (
        <ExpandedDetails
          data={result}
          vin={vin}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  );
};

export default App;
