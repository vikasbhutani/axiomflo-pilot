/**
 * Simulated, editable demo state layered over the read-only sample dataset.
 *
 * Holds the things an admin can change in the demo (team names, people,
 * provider connection settings, company name) plus a simple audit log. It is
 * saved in the browser so edits survive a refresh, and "Reset demo" restores
 * the seed data.
 *
 * Nothing here is a secret: credential fields are masked samples and are
 * never stored. In production this state would live in the backend.
 */
import { company, providerConnections as seedConnections, seedAuditEvents, teams as seedTeams, users as seedUsers } from './mockData';
import type { AuditEvent, ProviderConnection, Team, User } from '../types';

const STORAGE_KEY = 'axiomflo-demo:workspace';
/** Saved demo Upgrade Analyses (services/upgradeAnalysisService.ts); "Reset demo" clears them too. */
const UPGRADE_STORAGE_KEY = 'axiomflo-demo:upgrade-analyses';
const STATE_VERSION = 1;

export interface DemoState {
  version: number;
  companyName: string;
  /** Team display names keyed by team ID. Codes never change. */
  teamNames: Record<string, string>;
  users: User[];
  connections: ProviderConnection[];
  audit: AuditEvent[];
}

function seedState(): DemoState {
  return {
    version: STATE_VERSION,
    companyName: company.name,
    teamNames: Object.fromEntries(seedTeams.map((t) => [t.id, t.name])),
    users: seedUsers.map((u) => ({ ...u })),
    connections: seedConnections.map((c) => ({ ...c })),
    audit: seedAuditEvents.map((e) => ({ ...e })),
  };
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load(): DemoState {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as DemoState;
    if (parsed.version !== STATE_VERSION || !Array.isArray(parsed.users) || !Array.isArray(parsed.connections)) return seedState();
    return parsed;
  } catch {
    return seedState();
  }
}

let state: DemoState = load();
let revision = 0;
const listeners = new Set<() => void>();

function persist() {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable; the demo keeps working for this session.
  }
}

export const demoStore = {
  get(): DemoState {
    return state;
  },
  /** Increments on every change so React views know to reload. */
  revision(): number {
    return revision;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  update(mutator: (draft: DemoState) => DemoState): void {
    state = mutator(state);
    revision++;
    persist();
    listeners.forEach((l) => l());
  },
  reset(): void {
    state = seedState();
    revision++;
    try {
      storage()?.removeItem(STORAGE_KEY);
      storage()?.removeItem(UPGRADE_STORAGE_KEY);
    } catch {
      // ignore
    }
    listeners.forEach((l) => l());
  },
};

/** Teams with their current (possibly renamed) display names. */
export function currentTeams(): Team[] {
  return seedTeams.map((t) => ({ ...t, name: state.teamNames[t.id] ?? t.name }));
}

export function currentUsers(): User[] {
  return state.users;
}

export function newAuditEvent(actorName: string, action: string, detail: string): AuditEvent {
  return { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), actorName, action, detail };
}
