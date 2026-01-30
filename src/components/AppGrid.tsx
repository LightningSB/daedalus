import { AppCard } from './AppCard'
import { useTelegram } from '../hooks/useTelegram'

interface AppGridProps {
  onAppSelect: (appId: string) => void
  onCreateNew: () => void
}

const APPS = [
  {
    id: 'vin-decoder',
    name: 'VIN Decoder',
    icon: '🚗',
    description: 'Decode any vehicle identification number',
  },
]

export function AppGrid({ onAppSelect, onCreateNew }: AppGridProps) {
  const { user } = useTelegram()

  return (
    <div className="min-h-screen px-4 py-6 pb-24">
      {/* Header */}
      <header className="mb-8 animate-fade-in">
        <h1 className="text-3xl font-bold text-white mb-1">
          Daedalus
        </h1>
        <p className="text-white/50 text-sm">
          Your Mini App Factory
        </p>
        {user && (
          <p className="text-emerald-400/70 text-xs mt-2">
            Welcome, {user.first_name}
          </p>
        )}
      </header>

      {/* Create Button */}
      <button
        onClick={onCreateNew}
        className="btn-emerald w-full rounded-2xl py-4 px-6 mb-8 flex items-center justify-center gap-3 font-semibold text-white animate-fade-in stagger-1"
      >
        <span className="text-xl">+</span>
        <span>New App</span>
      </button>

      {/* App Grid */}
      <div className="grid grid-cols-2 gap-3">
        {APPS.map((app, index) => (
          <div
            key={app.id}
            className={`animate-fade-in opacity-0 stagger-${index + 1}`}
          >
            <AppCard
              id={app.id}
              name={app.name}
              icon={app.icon}
              description={app.description}
              onClick={() => onAppSelect(app.id)}
            />
          </div>
        ))}
      </div>

      {/* Empty state hint */}
      <p className="text-center text-white/30 text-xs mt-8 animate-fade-in stagger-4">
        Tap an app to open or create something new
      </p>
    </div>
  )
}
