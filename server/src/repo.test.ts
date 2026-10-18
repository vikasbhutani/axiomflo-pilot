/**
 * Guards against credentials ending up in the repository: no private keys, no
 * service-account JSON files, anywhere in the files git tracks (web app included).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

describe('the repository', () => {
  it('contains no private keys or service-account key files', () => {
    const offenders = tracked.filter((file) => {
      let text: string;
      try {
        text = readFileSync(join(root, file), 'utf8');
      } catch {
        return false; // deleted in the working tree
      }
      // Built from parts so this file doesn't match itself.
      return text.includes('-----BEGIN ' + 'PRIVATE KEY') || text.includes('-----BEGIN RSA ' + 'PRIVATE KEY') || /"type"\s*:\s*"service_account"/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
