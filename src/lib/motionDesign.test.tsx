import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { installRipple } from './ripple';
import { RollingNumber } from '../components/ui/RollingNumber';
import { PageTransition } from '../components/layout/PageTransition';

function allowMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ink ripple', () => {
  it('spreads from a pressed button, but not a disabled one or with reduced motion', () => {
    allowMotion();
    const uninstall = installRipple();
    render(
      <>
        <button className="btn-primary">Send</button>
        <button className="btn-secondary" disabled>
          Off
        </button>
      </>,
    );
    fireEvent.pointerDown(screen.getByText('Send'), { button: 0, clientX: 5, clientY: 5 });
    expect(screen.getByText('Send').querySelector('.ripple')).not.toBeNull();
    fireEvent.pointerDown(screen.getByText('Off'), { button: 0 });
    expect(screen.getByText('Off').querySelector('.ripple')).toBeNull();
    vi.unstubAllGlobals();
    fireEvent.pointerDown(screen.getByText('Send'), { button: 0 });
    expect(screen.getByText('Send').querySelectorAll('.ripple')).toHaveLength(1);
    uninstall();
  });
});

describe('rolling number', () => {
  it('rolls each digit while screen readers get the plain figure', () => {
    allowMotion();
    const { container } = render(<RollingNumber text="$1,204" />);
    expect(container.querySelector('.sr-only')?.textContent).toBe('$1,204');
    // One strip of 0–9 per digit.
    expect(container.querySelectorAll('[aria-hidden] .flex-col')).toHaveLength(4);
  });

  it('is plain text without motion', () => {
    const { container } = render(<RollingNumber text="$1,204" />);
    expect(container.textContent).toBe('$1,204');
  });
});

describe('page transitions', () => {
  function App({ start }: { start: string }) {
    return (
      <MemoryRouter initialEntries={[start]}>
        <Link to="/assistant">Chat</Link>
        <Link to="/assistant/upgrade">Upgrade</Link>
        <Link to="/usage">Usage</Link>
        <PageTransition>
          <Routes>
            <Route path="*" element={<p>page</p>} />
          </Routes>
        </PageTransition>
      </MemoryRouter>
    );
  }
  const wrapper = () => screen.getByText('page').parentElement!;

  it('slides between the assistant tabs and fades through to other pages', () => {
    render(<App start="/assistant" />);
    expect(wrapper().className).toBe('animate-fade-through');
    act(() => screen.getByText('Upgrade').click());
    expect(wrapper().className).toBe('animate-axis-forward');
    act(() => screen.getByText('Chat').click());
    expect(wrapper().className).toBe('animate-axis-back');
    act(() => screen.getByText('Usage').click());
    expect(wrapper().className).toBe('animate-fade-through');
  });
});
