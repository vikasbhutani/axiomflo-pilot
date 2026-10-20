import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { TypedParagraphs, useTypedParagraphs } from './ChatParts';

const PARAGRAPHS = ['Spend rose by ten percent.', 'Most of it was Platform Engineering.'];

function Answer() {
  const typed = useTypedParagraphs(PARAGRAPHS);
  return (
    <div>
      <TypedParagraphs paragraphs={PARAGRAPHS} {...typed} className={() => ''} />
      {typed.done && <a href="/usage">View supporting requests</a>}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('typed answers', () => {
  it('types the answer out, keeps the whole text for screen readers, then shows the links', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { container } = render(<Answer />);
    act(() => {
      vi.advanceTimersByTime(40);
    });
    const typed = container.querySelector('[aria-hidden]')?.textContent ?? '';
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.length).toBeLessThan(PARAGRAPHS.join('').length);
    expect(container.querySelector('.sr-only')?.textContent).toBe(PARAGRAPHS.join(''));
    expect(container.querySelector('a')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelector('a')?.textContent).toBe('View supporting requests');
  });

  it('shows everything at once without motion', () => {
    const { container } = render(<Answer />);
    expect(container.textContent).toBe(`${PARAGRAPHS.join('')}View supporting requests`);
  });
});
