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
    <div className="h-full w-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden relative">
      {/* Premium background effects */}
      <div className="absolute inset-0 bg-gradient-premium pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-radial pointer-events-none" />
      
      {/* Animated grid pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
        backgroundSize: '50px 50px'
      }} />
      
      {/* Floating orbs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse-slow pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl animate-pulse-slow pointer-events-none" style={{ animationDelay: '1s' }} />

      {/* Header */}
      <header className="relative flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/5 bg-[#0a0a0f]/50 backdrop-blur-xl z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-emerald-500/20 rounded-xl blur-md animate-pulse-glow" />
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-[#10b981] to-[#059669] flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
              VIN Decoder
            </h1>
            <p className="text-xs text-emerald-400/70 font-medium">Premium Vehicle Lookup</p>
          </div>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="btn-secondary px-4 py-2.5 text-sm touch-target flex items-center gap-2 rounded-xl hover:bg-white/5 transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="hidden sm:inline">History</span>
          {history.length > 0 && (
            <span className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-lg shadow-emerald-500/20">
              {history.length}
            </span>
          )}
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative z-10">
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
          <div className="max-w-2xl mx-auto p-4 sm:p-8">
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
              <div className="mt-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 animate-slide-up">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="font-medium">{error}</span>
                </div>
              </div>
            )}

            {/* Result Card */}
            {result && (
              <div className="mt-8 animate-slide-up">
                <ResultCard
                  data={result}
                  vin={vin}
                  onExpand={() => setShowDetails(true)}
                />
              </div>
            )}

            {/* Empty State */}
            {!result && !loading && !error && (
              <div className="mt-16 sm:mt-24 text-center animate-fade-in">
                {/* Premium empty state illustration */}
                <div className="relative w-32 h-32 mx-auto mb-8">
                  {/* Outer ring */}
                  <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20 animate-spin-slow" />
                  <div className="absolute inset-2 rounded-full border-2 border-dashed border-emerald-500/10 animate-spin-slow" style={{ animationDirection: 'reverse', animationDuration: '12s' }} />
                  
                  {/* Inner glow */}
                  <div className="absolute inset-4 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/10 animate-pulse-slow" />
                  
                  {/* Icon container */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative">
                      {/* Glow effect */}
                      <div className="absolute inset-0 bg-emerald-500/30 blur-xl rounded-full" />
                      
                      {/* Main icon */}
                      <svg className="relative w-16 h-16 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      
                      {/* Scan line */}
                      <div className="absolute inset-0 overflow-hidden rounded-lg">
                        <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan" />
                      </div>
                    </div>
                  </div>
                  
                  {/* Floating dots */}
                  <div className="absolute top-0 left-1/2 w-2 h-2 rounded-full bg-emerald-500/50 animate-float" />
                  <div className="absolute bottom-2 left-4 w-1.5 h-1.5 rounded-full bg-emerald-400/30 animate-float" style={{ animationDelay: '0.5s' }} />
                  <div className="absolute top-4 right-4 w-1 h-1 rounded-full bg-emerald-300/40 animate-float" style={{ animationDelay: '1s' }} />
                </div>
                
                <h3 className="text-xl font-bold text-white mb-2">
                  Ready to Decode
                </h3>
                <p className="text-white/40 text-sm max-w-xs mx-auto leading-relaxed">
                  Enter a 17-character Vehicle Identification Number to instantly retrieve detailed vehicle specifications
                </p>
                
                {/* Features */}
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  {['Instant Results', 'Detailed Specs', 'History Tracking'].map((feature) => (
                    <div key={feature} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-xs text-white/50">
                      <svg className="w-3.5 h-3.5 text-emerald-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {feature}
                    </div>
                  ))}
                </div>
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
