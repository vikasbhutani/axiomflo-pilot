import { createContext, useContext, type ReactNode } from 'react';
import { readAppSettings, type AppSettings } from './config';

const defaultSettings = readAppSettings();
const SettingsContext = createContext<AppSettings>(defaultSettings);

/** Optional: overrides the build-time settings (used by tests). */
export function AppSettingsProvider({ value, children }: { value: AppSettings; children: ReactNode }) {
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAppSettings(): AppSettings {
  return useContext(SettingsContext);
}
