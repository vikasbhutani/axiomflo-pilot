import { describe, expect, it } from 'vitest';
import { buildGoldenTotals, buildWorkspaceFixture } from './agentFixtures';
import { buildSnapshotGoldenTotals, buildUsageSnapshot } from './agentRealFixtures';
import { buildFinopsGolden } from './finopsFixtures';

const committed = import.meta.glob<unknown>('../../backend/fixtures/*.json', { eager: true, import: 'default' });
const fixture = (name: string) => committed[`../../backend/fixtures/${name}`];

describe('AxiomFlo Agent fixtures', () => {
  it('backend/fixtures match the current demo dataset (run `npm run agent:fixtures` if this fails)', () => {
    expect(fixture('demo-workspace.json')).toEqual(JSON.parse(JSON.stringify(buildWorkspaceFixture())));
    expect(fixture('golden-totals.json')).toEqual(JSON.parse(JSON.stringify(buildGoldenTotals())));
    expect(fixture('sample-snapshot.json')).toEqual(JSON.parse(JSON.stringify(buildUsageSnapshot())));
    expect(fixture('sample-snapshot-golden.json')).toEqual(JSON.parse(JSON.stringify(buildSnapshotGoldenTotals())));
    expect(fixture('finops-golden.json')).toEqual(JSON.parse(JSON.stringify(buildFinopsGolden())));
  });
});
