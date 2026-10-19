/**
 * Writes the AxiomFlo Agent fixtures from the web app's demo dataset.
 * Run with `npm run agent:fixtures`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoldenTotals, buildWorkspaceFixture } from '../src/lib/agentFixtures';
import { buildSnapshotGoldenTotals, buildUsageSnapshot } from '../src/lib/agentRealFixtures';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'backend/fixtures');
mkdirSync(outDir, { recursive: true });

// The workspace file holds ~6,000 request records, so it is written without indentation.
const files: [string, unknown, number | undefined][] = [
  ['demo-workspace.json', buildWorkspaceFixture(), undefined],
  ['golden-totals.json', buildGoldenTotals(), 2],
  ['sample-snapshot.json', buildUsageSnapshot(), undefined],
  ['sample-snapshot-golden.json', buildSnapshotGoldenTotals(), 2],
];
for (const [name, data, indent] of files) {
  writeFileSync(resolve(outDir, name), `${JSON.stringify(data, null, indent)}\n`);
  console.log(`Wrote backend/fixtures/${name}`);
}
