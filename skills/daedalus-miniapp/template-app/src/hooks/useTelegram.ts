import { useEffect, useState, useCallback, useMemo } from 'react';

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

interface HapticMethods {
  impact: (style?: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notification: (type?: 'error' | 'success' | 'warning') => void;
  selection: () => void;
}

interface UseTelegramReturn {
  webApp: typeof window.Telegram?.WebApp | null;
  user: TelegramUser | null;
  tgUserId: string | null;
  themeParams: ThemeParams;
  isReady: boolean;
  haptic: HapticMethods;
  showBackButton: (visible: boolean) => void;
  setHeaderColor: (color: string) => void;
  close: () => void;
  expand: () => void;
  showAlert: (message: string) => Promise<void>;
  showConfirm: (message: string) => Promise<boolean>;
}

/**
 * Hook for Telegram Web App SDK integration
 * 
 * Provides access to Telegram user data, theme, haptic feedback, and UI controls.
 * Gracefully handles non-Telegram environments (returns safe defaults).
 */
export function useTelegram(): UseTelegramReturn {
  const [isReady, setIsReady] = useState(false);
  const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;

  useEffect(() => {
    if (webApp) {
      webApp.ready();
      webApp.expand();
      setIsReady(true);
    }
  }, [webApp]);

  const user = useMemo(() => {
    return webApp?.initDataUnsafe?.user || null;
  }, [webApp]);

  const tgUserId = useMemo(() => {
    return user?.id?.toString() || null;
  }, [user]);

  const themeParams = useMemo((): ThemeParams => {
    return webApp?.themeParams || {
      bg_color: '#0f1419',
      text_color: '#ffffff',
      hint_color: '#6b7280',
      link_color: '#10b981',
      button_color: '#10b981',
      button_text_color: '#ffffff',
    };
  }, [webApp]);

  const haptic = useMemo((): HapticMethods => ({
    impact: (style = 'light') => {
      try {
        webApp?.HapticFeedback?.impactOccurred(style);
      } catch {
        // Silently fail if not supported
      }
    },
    notification: (type = 'success') => {
      try {
        webApp?.HapticFeedback?.notificationOccurred(type);
      } catch {
        // Silently fail if not supported
      }
    },
    selection: () => {
      try {
        webApp?.HapticFeedback?.selectionChanged();
      } catch {
        // Silently fail if not supported
      }
    },
  }), [webApp]);

  const showBackButton = useCallback((visible: boolean) => {
    if (visible) {
      webApp?.BackButton?.show();
    } else {
      webApp?.BackButton?.hide();
    }
  }, [webApp]);

  const setHeaderColor = useCallback((color: string) => {
    webApp?.setHeaderColor(color);
  }, [webApp]);

  const close = useCallback(() => {
    webApp?.close();
  }, [webApp]);

  const expand = useCallback(() => {
    webApp?.expand();
  }, [webApp]);

  const showAlert = useCallback((message: string): Promise<void> => {
    return new Promise((resolve) => {
      if (webApp) {
        webApp.showAlert(message, resolve);
      } else {
        alert(message);
        resolve();
      }
    });
  }, [webApp]);

  const showConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (webApp) {
        webApp.showConfirm(message, resolve);
      } else {
        resolve(confirm(message));
      }
    });
  }, [webApp]);

  return {
    webApp,
    user,
    tgUserId,
    themeParams,
    isReady,
    haptic,
    showBackButton,
    setHeaderColor,
    close,
    expand,
    showAlert,
    showConfirm,
  };
}
