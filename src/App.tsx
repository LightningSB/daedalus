import { useState, startTransition, Suspense, lazy } from 'react'
import { useTelegram } from './hooks/useTelegram'
import { AppGrid } from './components/AppGrid'
import { CreateView } from './components/CreateView'
import { FileSystemTerminalApp } from './components/FileSystemTerminalApp'

const AppLoader = lazy(() => import('./components/AppLoader'))

type View = 'home' | 'create' | 'app'

function App() {
  const [view, setView] = useState<View>('home')
  const [currentAppId, setCurrentAppId] = useState<string | null>(null)
  const { impactLight } = useTelegram()

  const navigateTo = (newView: View, appId?: string) => {
    impactLight()
    startTransition(() => {
      setView(newView)
      if (appId) setCurrentAppId(appId)
    })
  }

  const handleAppSelect = (appId: string) => {
    navigateTo('app', appId)
  }

  const handleCreateNew = () => {
    navigateTo('create')
  }

  const handleBack = () => {
    navigateTo('home')
  }

  return (
    <div className="min-h-screen bg-dark text-white font-nunito">
      {view === 'home' && (
        <AppGrid
          onAppSelect={handleAppSelect}
          onCreateNew={handleCreateNew}
        />
      )}
      {view === 'create' && (
        <CreateView onBack={handleBack} />
      )}
      {view === 'app' && currentAppId && (
        currentAppId === 'fs-terminal' ? (
          <FileSystemTerminalApp onBack={handleBack} />
        ) : (
          <Suspense fallback={<LoadingSpinner />}>
            <AppLoader appId={currentAppId} onBack={handleBack} />
          </Suspense>
        )
      )}
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-10 h-10 border-3 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  )
}

export default App
