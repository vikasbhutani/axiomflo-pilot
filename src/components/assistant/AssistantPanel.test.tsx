import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { demoSession } from '../../auth/demoSession';
import { navItems } from '../layout/navigation';
import { renderApp } from '../../test/authTestUtils';

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

const location = () => screen.getByTestId('location').textContent;

describe('AI Cost Assistant side panel in the demo workspace', () => {
  it('is offered on every menu page except the assistant’s own', async () => {
    demoSession.enter();
    for (const item of navItems) {
      renderApp({ path: item.to });
      await screen.findByRole('main');
      if (item.to === '/assistant') expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
      else expect(await screen.findByRole('button', { name: 'Ask AI' })).toBeTruthy();
      cleanup();
    }
  });

  it('answers over the current page, keeps the chat across pages, and hands it to the full page', async () => {
    demoSession.enter();
    renderApp({ path: '/teams' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ask AI' }));

    const panel = screen.getByRole('complementary', { name: 'AI Cost Assistant' });
    expect(document.activeElement).toBe(within(panel).getByLabelText('Ask a question about AI costs'));
    await user.click(within(panel).getByRole('button', { name: 'What did each team spend this month?' }));
    expect(await within(panel).findByText(/Assistant answered/)).toBeTruthy();
    expect(location()).toBe('/teams');

    // Closing returns to the button; the page underneath never changed.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'AI Cost Assistant' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask AI' }));

    // Another page, same conversation.
    await user.click(screen.getAllByRole('link', { name: 'Usage Explorer' })[0]);
    await user.click(await screen.findByRole('button', { name: 'Ask AI' }));
    const again = screen.getByRole('complementary', { name: 'AI Cost Assistant' });
    expect(within(again).getByText('What did each team spend this month?', { exact: false })).toBeTruthy();
    expect(location()).toBe('/usage');

    await user.click(within(again).getByRole('link', { name: 'Open the full assistant page' }));
    expect(location()).toBe('/assistant');
    expect(screen.queryByRole('complementary', { name: 'AI Cost Assistant' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'AxiomFlo Cost Assistant' })).toBeTruthy();
    expect(screen.getByText(/You asked/).parentElement?.textContent).toContain('What did each team spend this month?');
  });
});
