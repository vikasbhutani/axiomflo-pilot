/**
 * Whether this browser tab chose "Explore the demo workspace".
 *
 * Demo mode only ever shows SAMPLE data with the demo role switcher. It is a separate
 * mode from a real workspace and grants nothing: a real membership always comes from
 * the membership service. The flag lives in sessionStorage, so it ends with the tab.
 */
import { useSyncExternalStore } from 'react';
import { useAppSettings } from './settings';

const KEY = 'axiomflo:demo-session';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === 'active';
  } catch {
    return false;
  }
}

let active = typeof window === 'undefined' ? false : read();

function set(next: boolean) {
  active = next;
  try {
    if (next) window.sessionStorage.setItem(KEY, 'active');
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be unavailable; demo mode then lasts until the page reloads.
  }
  listeners.forEach((l) => l());
}

export const demoSession = {
  isActive: () => active,
  enter: () => set(true),
  exit: () => set(false),
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useDemoSession() {
  const { demoEnabled } = useAppSettings();
  const isActive = useSyncExternalStore(demoSession.subscribe, demoSession.isActive);
  return { demoAvailable: demoEnabled, demoActive: demoEnabled && isActive, enterDemo: demoSession.enter, exitDemo: demoSession.exit };
}
