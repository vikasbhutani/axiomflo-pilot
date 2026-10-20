import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { demoSession } from '../auth/demoSession';
import { renderApp } from '../test/authTestUtils';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  demoSession.exit();
  window.localStorage.clear();
});

describe('FinOps Scorecard in the demo workspace', () => {
  it('shows the score, unit economics, five levers and token cost per workflow on the Acme sample data', async () => {
    demoSession.enter();
    window.localStorage.setItem('axiomflo-demo:period', JSON.stringify('2026-09'));
    renderApp({ path: '/scorecard' });
    expect(await screen.findByRole('heading', { name: 'FinOps Scorecard' })).toBeTruthy();
    expect(await screen.findByText('FinOps score')).toBeTruthy();
    expect(screen.getByText('Cost per successful request')).toBeTruthy();
    const levers = screen.getByText('Five optimisation levers, by savings potential').closest('section')!;
    expect(within(levers).getAllByRole('listitem')).toHaveLength(5);
    for (const name of ['Model right-sizing', 'Prompt caching', 'Batch processing', 'Context trimming', 'Output limits']) expect(within(levers).getByText(name)).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('CI code-review bot')).toBeTruthy();
    expect(within(table).getByText('Support ticket summariser')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'FinOps Scorecard' })).toBeTruthy();
  });
});
