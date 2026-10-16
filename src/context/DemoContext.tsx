import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { demoStore } from '../data/demoStore';
import { DEMO_PERSONAS } from '../data/mockData';
import { getCurrentUser, getWorkspaceInfo, type WorkspaceInfo } from '../services/mockService';
import { readPreference, writePreference } from '../lib/storage';
import type { PeriodKey, Role, User, UserContext } from '../types';

interface DemoState {
  workspace: WorkspaceInfo;
  role: Role;
  setRole: (role: Role) => void;
  userContext: UserContext;
  currentUser: User;
  period: PeriodKey;
  setPeriod: (period: PeriodKey) => void;
  /** Changes whenever simulated demo data is edited or reset; add it to data-loading dependencies. */
  dataVersion: number;
}

const DemoContext = createContext<DemoState | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const dataVersion = useSyncExternalStore(demoStore.subscribe, demoStore.revision);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const workspace = useMemo(() => getWorkspaceInfo(), [dataVersion]);
  const [role, setRoleState] = useState<Role>(() => {
    const saved = readPreference<Role>('role', 'company_admin');
    return saved === 'individual_user' ? 'individual_user' : 'company_admin';
  });
  const [period, setPeriodState] = useState<PeriodKey>(() => {
    const saved = readPreference<string>('period', workspace.defaultPeriod);
    return workspace.periods.includes(saved) ? saved : workspace.defaultPeriod;
  });

  const value = useMemo<DemoState>(() => {
    const userContext: UserContext = { role, userId: DEMO_PERSONAS[role] };
    return {
      workspace,
      role,
      setRole: (next) => {
        setRoleState(next);
        writePreference('role', next);
      },
      userContext,
      currentUser: getCurrentUser(userContext)!,
      period,
      setPeriod: (next) => {
        setPeriodState(next);
        writePreference('period', next);
      },
      dataVersion,
    };
  }, [workspace, role, period, dataVersion]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoState {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemo must be used inside <DemoProvider>');
  return ctx;
}
