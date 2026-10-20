import { useEffect, useState } from 'react';
import { motionAllowed } from '../../hooks/useMotion';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * A formatted figure whose digits roll into place like an odometer: from 0 on first show, then from
 * the old digits whenever the value changes. Screen readers get only the final text.
 */
export function RollingNumber({ text }: { text: string }) {
  // Digits start at 0 and roll to their place on the next frame, so the first show rolls too.
  const [settled, setSettled] = useState(() => !motionAllowed());
  useEffect(() => {
    if (settled) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [settled]);

  if (!motionAllowed()) return <>{text}</>;
  const chars = [...text];
  return (
    <>
      <span aria-hidden className="inline-flex">
        {chars.map((c, i) => {
          // Keyed from the right, so units stay units when the number gains a digit.
          const key = chars.length - i;
          const digit = DIGITS.indexOf(c);
          if (digit < 0)
            return (
              <span key={`c${key}`} className="inline-block h-[1.15em] whitespace-pre leading-[1.15em]">
                {c}
              </span>
            );
          return (
            <span key={`d${key}`} className="relative inline-block h-[1.15em] overflow-hidden leading-[1.15em]">
              <span className="invisible">0</span>
              <span
                className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-700 ease-emphasized-decelerate"
                style={{ transform: `translateY(-${(settled ? digit : 0) * 1.15}em)`, transitionDelay: `${(chars.length - i) * 25}ms` }}
              >
                {DIGITS.map((d) => (
                  <span key={d} className="h-[1.15em]">
                    {d}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}
