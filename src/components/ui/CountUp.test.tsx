import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { CountUp } from './CountUp';

const format = (n: number) => `$${n.toFixed(2)}`;

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CountUp', () => {
  it('shows the final value at once when the person prefers reduced motion', () => {
    mockReducedMotion(true);
    const { container } = render(<CountUp value={42} format={format} />);
    expect(container.textContent).toBe('$42.00');
  });

  it('gives screen readers only the final value while counting, then settles on it', () => {
    mockReducedMotion(false);
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { container } = render(<CountUp value={42} format={format} duration={100} />);
    expect(container.querySelector('[aria-hidden]')?.textContent).toBe('$0.00');
    expect(container.querySelector('.sr-only')?.textContent).toBe('$42.00');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.textContent).toBe('$42.00');
    expect(container.querySelector('[aria-hidden]')).toBeNull();
  });
});
