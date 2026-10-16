import { useEffect } from 'react';

/** Sets the browser tab title so each screen is identifiable (and announced by screen readers on navigation). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · AxiomFlo`;
  }, [title]);
}
