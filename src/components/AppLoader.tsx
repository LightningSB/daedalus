import { useState, useEffect } from 'react'
import { useTelegram } from '../hooks/useTelegram'

interface AppLoaderProps {
  appId: string
  onBack: () => void
}

const BASE_URL = 'https://minio.wheelbase.io/daedalus/apps'

export default function AppLoader({ appId, onBack }: AppLoaderProps) {
  const [isLoading, setIsLoading] = useState(true)
  const { showBackButton } = useTelegram()

  useEffect(() => {
    const cleanup = showBackButton(onBack)
    return cleanup
  }, [showBackButton, onBack])

  const handleIframeLoad = () => {
    setIsLoading(false)
  }

  const iframeSrc = `${BASE_URL}/${appId}/index.html`

  return (
    <div className="fixed inset-0 bg-dark">
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark z-10">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            <p className="text-white/50 text-sm">Loading app...</p>
          </div>
        </div>
      )}

      {/* App iframe */}
      <iframe
        src={iframeSrc}
        onLoad={handleIframeLoad}
        className="w-full h-full border-0"
        title={`App: ${appId}`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  )
}
