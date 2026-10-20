import { flushSync } from 'react-dom';
import { motionAllowed } from '../hooks/useMotion';

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

/**
 * Material "container transform": morphs `source` into the element `target` finds once `update` has run,
 * using the browser's View Transitions API. Where that isn't supported, or motion is reduced, `update` just runs.
 *
 * The shared name is set only for the length of the transition, so it never clashes with another element.
 */
export function morph(source: HTMLElement | null, update: () => void, target: () => HTMLElement | null) {
  const doc = document as ViewTransitionDocument;
  if (!source || typeof doc.startViewTransition !== 'function' || !motionAllowed()) {
    update();
    return;
  }
  let landed: HTMLElement | null = null;
  source.style.viewTransitionName = 'morph';
  const transition = doc.startViewTransition(() => {
    source.style.viewTransitionName = '';
    flushSync(update);
    landed = target();
    if (landed) {
      landed.style.viewTransitionName = 'morph';
      // Its own entrance animation would fight the morph.
      landed.style.animation = 'none';
    }
  });
  void transition.finished.finally(() => {
    if (landed) landed.style.viewTransitionName = '';
  });
}
