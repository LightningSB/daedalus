import React, { useState, useCallback, useEffect } from 'react';
import { VinInput } from './components/VinInput';
import { ResultCard } from './components/ResultCard';
import { ExpandedDetails } from './components/ExpandedDetails';
import { HistorySidebar } from './components/HistorySidebar';
import { useTelegram } from './hooks/useTelegram';
import { useDuckDB } from './hooks/useDuckDB';
import { decodeVin, saveHistoryToAPI, VinResult, HistoryRecord } from './lib/api';
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
  const { conn, historyLoaded } = useDuckDB();

  // Load history from DuckDB when connection is ready
  useEffect(() => {
    if (conn && historyLoaded) {
      const loadHistory = async () => {
        try {
          const result = await conn.query(`
            SELECT vin, make, model, year, data FROM vin_history ORDER BY timestamp DESC LIMIT 20
          `);
          
          const records: HistoryRecord[] = [];
          for (let i = 0; i < result.numRows; i++) {
            const row = result.get(i);
            if (row) {
              records.push({
                vin: String(row.vin),
                make: String(row.make),
                model: String(row.model),
                year: String(row.year),
                data: JSON.parse(String(row.data))
              });
            }
          }
          setHistory(records);
        } catch (e) {
          console.error('Failed to load history from DuckDB:', e);
        }
      };
      loadHistory();
    }
  }, [conn, historyLoaded]);

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
            try {
              await saveHistoryToAPI(tgUserId, historyRecord);
            } catch (saveError) {
              console.error('Failed to save history to MinIO:', saveError);
            }
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
  }, [tgUserId, conn, historyLoaded]);

  const handleHistorySelect = useCallback((record: HistoryRecord) => {
    setVin(record.vin);
    setResult(record.data);
    setShowDetails(false);
    setError(null);
    setShowHistory(false);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="8" width="18" height="12" rx="2" />
              <circle cx="7" cy="16" r="2" />
              <circle cx="17" cy="16" r="2" />
              <path d="M5 8l2-4h10l2 4" />
            </svg>
          </div>
          <div className="brand-text">
            <h1>VIN Decoder</h1>
            <span>Instant Lookup</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setShowHistory(true)} aria-label="History">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            {history.length > 0 && <span className="badge">{history.length}</span>}
          </button>
        </div>
      </header>

      <main className="main">
        <div className="content">
          <VinInput
            value={vin}
            onChange={setVin}
            onSubmit={handleVinSubmit}
            loading={loading}
          />

          {error && (
            <div className="error-msg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {result ? (
            <div className="result-area">
              <ResultCard
                data={result}
                vin={vin}
                onExpand={() => setShowDetails(true)}
              />
            </div>
          ) : !loading && !error ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="8" width="18" height="12" rx="2" />
                  <circle cx="7" cy="16" r="2" />
                  <circle cx="17" cy="16" r="2" />
                  <path d="M5 8l2-4h10l2 4" />
                </svg>
              </div>
              <p className="empty-title">Ready to decode</p>
              <p className="empty-subtitle">Enter a 17-character VIN to get vehicle specs instantly</p>
            </div>
          ) : null}
        </div>
      </main>

      {showHistory && (
        <HistorySidebar
          history={history}
          onClose={() => setShowHistory(false)}
          onSelect={handleHistorySelect}
          onClear={() => setHistory([])}
        />
      )}

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
