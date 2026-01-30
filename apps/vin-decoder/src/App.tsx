import React, { useState, useCallback } from 'react';
import { VinInput } from './components/VinInput';
import { ResultCard } from './components/ResultCard';
import { ExpandedDetails } from './components/ExpandedDetails';
import { HistorySidebar } from './components/HistorySidebar';
import { useTelegram } from './hooks/useTelegram';
import { useDuckDB } from './hooks/useDuckDB';
import { decodeVin, saveHistory, VinResult, HistoryRecord } from './lib/api';
import './index.css';

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
        
        const isError = vehicleData.ErrorText && 
          !vehicleData.ErrorText.startsWith('0 -') && 
          !vehicleData.ErrorText.startsWith('0 ');
        
        if (isError) {
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
    <div className="app-container">
      {/* Gradient background */}
      <div className="bg-gradient" />
      
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="header-text">
            <h1>VIN Decoder</h1>
            <span>Instant Vehicle Lookup</span>
          </div>
        </div>
        <button className="history-btn" onClick={() => setShowHistory(!showHistory)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {history.length > 0 && <span className="history-badge">{history.length}</span>}
        </button>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <VinInput
          value={vin}
          onChange={setVin}
          onSubmit={handleVinSubmit}
          loading={loading || dbLoading}
          error={error}
        />

        {error && (
          <div className="error-message">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4m0 4h.01" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {result && (
          <ResultCard
            data={result}
            vin={vin}
            onExpand={() => setShowDetails(true)}
          />
        )}

        {!result && !loading && !error && (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="8" width="18" height="12" rx="2" />
                <circle cx="7" cy="16" r="2" />
                <circle cx="17" cy="16" r="2" />
                <path d="M5 8l2-4h10l2 4" />
              </svg>
            </div>
            <p className="empty-title">Enter a VIN to decode</p>
            <p className="empty-subtitle">Get instant vehicle specs, history, and more</p>
          </div>
        )}
      </main>

      <HistorySidebar
        history={history}
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        onSelect={handleHistorySelect}
        onClear={handleClearHistory}
      />

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
