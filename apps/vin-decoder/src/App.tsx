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
    <div className="min-h-screen bg-[#0a0a0f] text-white relative overflow-x-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-emerald-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-white/5">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">VIN Decoder</h1>
              <p className="text-xs text-emerald-400/70">Vehicle Lookup</p>
            </div>
          </div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all"
          >
            <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {history.length > 0 && (
              <span className="bg-emerald-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {history.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-lg mx-auto px-4 py-6">
        {/* VIN Input Card */}
        <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/10 p-5">
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
          <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 animate-slide-up">
            <div className="flex items-center gap-3 text-red-400">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">{error}</span>
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
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center">
              <svg className="w-10 h-10 text-emerald-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Ready to Decode</h3>
            <p className="text-white/40 text-sm max-w-xs mx-auto">
              Enter a 17-character VIN to get detailed vehicle information
            </p>
            
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {['Instant Results', 'Full Specs', 'History'].map((feature) => (
                <span key={feature} className="px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-xs text-white/40">
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
