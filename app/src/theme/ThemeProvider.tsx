import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { dark, light, type ColorScheme, type Palette } from './tokens';

export type AppearancePref = 'system' | 'light' | 'dark';

type ThemeValue = {
  scheme: ColorScheme;
  c: Palette;
  pref: AppearancePref;
  setPref: (p: AppearancePref) => void;
  /** Elevation as CSS box-shadow strings (supported by RN new architecture + web). */
  shadow: { e1: string; e2: string; e3: string; tab: string; fab: string };
};

const ThemeContext = createContext<ThemeValue | null>(null);
const PREF_KEY = 'nudge.appearance';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<AppearancePref>('system');
  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v);
      })
      .catch(() => {});
  }, []);
  const setPref = (p: AppearancePref) => {
    setPrefState(p);
    AsyncStorage.setItem(PREF_KEY, p).catch(() => {});
  };
  const scheme: ColorScheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;

  const value = useMemo<ThemeValue>(() => {
    const isDark = scheme === 'dark';
    return {
      scheme,
      c: isDark ? dark : light,
      pref,
      setPref,
      shadow: isDark
        ? {
            e1: 'none',
            e2: '0 14px 36px -14px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.03)',
            e3: '0 30px 70px -20px rgba(0,0,0,0.85)',
            tab: '0 18px 40px -12px rgba(0,0,0,0.7)',
            fab: '0 12px 28px -10px rgba(0,0,0,0.8)',
          }
        : {
            e1: '0 1px 2px rgba(20,20,28,0.04)',
            e2: '0 12px 32px -14px rgba(20,20,28,0.18), 0 0 0 1px rgba(20,20,28,0.04)',
            e3: '0 30px 70px -20px rgba(20,20,28,0.3), 0 6px 16px rgba(20,20,28,0.06)',
            tab: '0 18px 40px -14px rgba(20,20,28,0.22), 0 0 0 1px rgba(20,20,28,0.05)',
            fab: '0 14px 30px -10px rgba(20,20,28,0.45)',
          },
    };
  }, [scheme, pref]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}
