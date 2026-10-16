import { describe, expect, it } from 'vitest';
import { buildGoldenTotals, buildWorkspaceFixture } from './agentFixtures';

const committed = import.meta.glob<unknown>('../../backend/fixtures/*.json', { eager: true, import: 'default' });
const fixture = (name: string) => committed[`../../backend/fixtures/${name}`];

describe('AxiomFlo Agent fixtures', () => {
  it('backend/fixtures match the current demo dataset (run `npm run agent:fixtures` if this fails)', () => {
    expect(fixture('demo-workspace.json')).toEqual(JSON.parse(JSON.stringify(buildWorkspaceFixture())));
    expect(fixture('golden-totals.json')).toEqual(JSON.parse(JSON.stringify(buildGoldenTotals())));
  });
});
