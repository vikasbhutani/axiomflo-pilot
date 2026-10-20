import { useCountUp } from '../../hooks/useMotion';

/**
 * Shows a number counting up to its value. Screen readers (and copy-paste) get only the final value,
 * so a live region never announces the in-between numbers.
 */
export function CountUp({ value, format, duration }: { value: number; format: (n: number) => string; duration?: number }) {
  const shown = useCountUp(value, duration);
  const final = format(value);
  if (shown === value) return <>{final}</>;
  return (
    <>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{final}</span>
    </>
  );
}
