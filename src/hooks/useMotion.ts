import { useEffect, useRef, useState } from 'react';

/** True when the browser can animate and the person hasn't asked their system to reduce motion. */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tweens a number towards `value`: from zero on first show, then from the previous value on each change.
 * Returns `value` straight away when motion isn't allowed.
 */
export function useCountUp(value: number, duration = 1200): number {
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

/**
 * Reveals `text` a few words at a time, like a reply being typed, finishing within `maxDuration`.
 * Returns the visible part and whether it's complete; with motion off it's complete at once.
 */
export function useTypedText(text: string, maxDuration = 1400): { shown: string; done: boolean } {
  const [count, setCount] = useState(() => (motionAllowed() ? 0 : text.length));

  useEffect(() => {
    if (!motionAllowed()) {
      setCount(text.length);
      return;
    }
    // Step through word boundaries so words never appear half-written.
    const stops: number[] = [];
    const re = /\S+\s*/g;
    for (let m = re.exec(text); m; m = re.exec(text)) stops.push(m.index + m[0].length);
    const perWord = Math.min(35, maxDuration / Math.max(1, stops.length));
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const i = Math.min(stops.length, Math.floor((now - start) / perWord) + 1);
      setCount(stops[i - 1] ?? text.length);
      if (i < stops.length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, maxDuration]);

  return { shown: text.slice(0, count), done: count >= text.length };
}
