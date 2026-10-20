import { useEffect, useRef, useState } from 'react';

/** True when the browser can animate and the person hasn't asked their system to reduce motion. */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True only during a component's first render, so charts animate on first load but not on every filter change. */
export function useFirstRender(): boolean {
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return first.current;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tweens a number towards `value`: from zero on first show, then from the previous value on each change.
 * Returns `value` straight away when motion isn't allowed.
 */
export function useCountUp(value: number, duration = 700): number {
  const [shown, setShown] = useState(() => (motionAllowed() ? 0 : value));
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (!motionAllowed() || !Number.isFinite(value)) {
      setShown(value);
      return;
    }
    const from = shownRef.current;
    if (from === value) return;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(t === 1 ? value : from + (value - from) * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return shown;
}
