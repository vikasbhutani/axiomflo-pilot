import { createContext, useContext } from 'react';
import type { AuthUser, Membership } from './types';

/**
 * Which kind of workspace the app shell is showing.
 * - demo: sample data, with the demo role switcher. Never real company data.
 * - real: an approved AxiomFlo membership from the membership service.
 */
export type WorkspaceSession = { mode: 'demo' } | { mode: 'real'; user: AuthUser; membership: Membership };

export const WorkspaceSessionContext = createContext<WorkspaceSession>({ mode: 'demo' });

export function useWorkspaceSession(): WorkspaceSession {
  return useContext(WorkspaceSessionContext);
}
