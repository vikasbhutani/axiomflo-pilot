import type { ReactNode } from 'react';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';

/** Renders the demo page for the demo workspace and the real page for an approved member. Never both. */
export function ByMode({ demo, real }: { demo: ReactNode; real: ReactNode }) {
  return <>{useWorkspaceSession().mode === 'real' ? real : demo}</>;
}
