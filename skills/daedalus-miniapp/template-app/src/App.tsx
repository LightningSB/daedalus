import { useState } from 'react';
import { useTelegram } from './hooks/useTelegram';
import './index.css';

/**
 * Daedalus Mini App Template
 * 
 * Customize this component for your app. The template provides:
 * - Telegram SDK integration via useTelegram hook
 * - Tailwind CSS with custom theme (emerald/teal accents)
 * - Dark theme matching Daedalus shell
 * - Animation utilities (fade-in, slide-up, scale-in)
 * 
 * Delete this comment and replace with your app logic.
 */
export default function App() {
  const { user, haptic, themeParams } = useTelegram();
  const [count, setCount] = useState(0);

  const handleTap = () => {
    setCount((c) => c + 1);
    haptic.impact('light');
  };

  return (
    <div className="app min-h-screen bg-surface text-white p-4">
      {/* Header */}
      <header className="text-center mb-8 animate-fade-in">
        <h1 className="text-2xl font-bold text-primary-400">
          Hello{user?.first_name ? `, ${user.first_name}` : ''}! 👋
        </h1>
        <p className="text-gray-400 mt-2">
          This is your Daedalus Mini App template
        </p>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center gap-6">
        {/* Example Card */}
        <div 
          className="w-full max-w-sm p-6 rounded-2xl bg-surface-elevated border border-white/10 
                     backdrop-blur-sm animate-slide-up"
          style={{ animationDelay: '0.1s' }}
        >
          <div className="text-center">
            <div className="text-6xl font-bold text-primary-400 mb-4">
              {count}
            </div>
            <button
              onClick={handleTap}
              className="w-full py-4 px-6 bg-primary-500 hover:bg-primary-600 
                       text-white font-semibold rounded-xl transition-all
                       active:scale-95 focus:outline-none focus:ring-2 
                       focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-surface"
            >
              Tap to Count
            </button>
          </div>
        </div>

        {/* Info Card */}
        <div 
          className="w-full max-w-sm p-4 rounded-xl bg-surface-overlay 
                     border border-white/5 animate-slide-up"
          style={{ animationDelay: '0.2s' }}
        >
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Getting Started
          </h2>
          <ul className="text-sm text-gray-300 space-y-1">
            <li>• Edit <code className="text-primary-400">src/App.tsx</code></li>
            <li>• Add components in <code className="text-primary-400">src/components/</code></li>
            <li>• Run <code className="text-primary-400">pnpm build</code> to bundle</li>
            <li>• Deploy with the deploy script</li>
          </ul>
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 text-center text-xs text-gray-500">
        Powered by Daedalus
      </footer>
    </div>
  );
}
