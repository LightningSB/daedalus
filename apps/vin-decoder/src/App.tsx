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
          
          // Save to history
          const historyRecord: HistoryRecord = {
            vin: submittedVin,
            make: vehicleData.Make || 'Unknown',
            model: vehicleData.Model || 'Unknown',
            year: vehicleData.ModelYear || 'Unknown',
            data: vehicleData,
          };
          
          setHistory(prev => [historyRecord, ...prev.slice(0, 19)]);
          
          // Save to server if Telegram user
          if (tgUserId) {
            await saveHistory(tgUserId, historyRecord);
          }
          
          // Save to DuckDB for local persistence
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
    <div className="h-full w-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#12121a]/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#10b981] to-[#059669] flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold">VIN Decoder</h1>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="btn-secondary px-3 py-2 text-sm touch-target flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="hidden sm:inline">History</span>
          {history.length > 0 && (
            <span className="bg-[#10b981] text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
              {history.length}
            </span>
          )}
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* History Sidebar */}
        <HistorySidebar
          history={history}
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          onSelect={handleHistorySelect}
          onClear={handleClearHistory}
        />

        {/* Main Panel */}
        <main className={`flex-1 overflow-y-auto transition-all duration-300 ${showHistory ? 'lg:ml-0' : ''}`}>
          <div className="max-w-2xl mx-auto p-4 sm:p-6">
            {/* VIN Input */}
            <VinInput
              value={vin}
              onChange={setVin}
              onSubmit={handleVinSubmit}
              loading={loading || dbLoading}
              error={error}
            />

            {/* Error Message */}
            {error && (
              <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 animate-slide-up">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{error}</span>
                </div>
              </div>
            )}

            {/* Result Card */}
            {result && (
              <div className="mt-6 animate-slide-up">
                <ResultCard
                  data={result}
                  vin={vin}
                  onExpand={() => setShowDetails(true)}
                />
              </div>
            )}

            {/* Empty State */}
            {!result && !loading && !error && (
              <div className="mt-12 text-center animate-fade-in">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
                  <svg className="w-10 h-10 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-white/40 text-sm">
                  Enter a 17-character VIN to decode vehicle information
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

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
