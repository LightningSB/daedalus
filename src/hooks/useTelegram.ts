import { useEffect, useState, useCallback } from 'react'

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

interface ThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
}

export function useTelegram() {
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [themeParams, setThemeParams] = useState<ThemeParams>({})
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const tg = window.Telegram?.WebApp

    if (tg) {
      // Initialize the app
      tg.ready()
      tg.expand()

      // Extract user data
      if (tg.initDataUnsafe?.user) {
        setUser(tg.initDataUnsafe.user)
      }

      // Get theme params
      setThemeParams(tg.themeParams)

      // Listen for theme changes
      const handleThemeChange = () => {
        if (tg.themeParams) {
          setThemeParams({ ...tg.themeParams })
        }
      }

      tg.onEvent('themeChanged', handleThemeChange)
      setIsReady(true)

      return () => {
        tg.offEvent('themeChanged', handleThemeChange)
      }
    } else {
      // Running outside Telegram - use defaults
      setIsReady(true)
    }
  }, [])

  const impactLight = useCallback(() => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light')
  }, [])

  const impactMedium = useCallback(() => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium')
  }, [])

  const notificationSuccess = useCallback(() => {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success')
  }, [])

  const showBackButton = useCallback((callback: () => void) => {
    const tg = window.Telegram?.WebApp
    if (tg?.BackButton) {
      tg.BackButton.onClick(callback)
      tg.BackButton.show()
      return () => {
        tg.BackButton.offClick(callback)
        tg.BackButton.hide()
      }
    }
    return () => {}
  }, [])

  return {
    user,
    themeParams,
    isReady,
    impactLight,
    impactMedium,
    notificationSuccess,
    showBackButton,
  }
}
