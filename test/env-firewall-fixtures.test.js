import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_CONTRACT_ID_NAMES } from '../scripts/security/env_firewall.js';

const ROOT = process.cwd();
const FIREWALL = resolve(ROOT, 'scripts/security/env_firewall.js');
const FIXTURES = resolve(ROOT, 'scripts/security/__fixtures__');

function auditBundle(name) {
  return spawnSync(
    process.execPath,
    [FIREWALL, '--audit', resolve(FIXTURES, name, 'dist')],
    { encoding: 'utf8' },
  );
}

describe('contract environment firewall', () => {
  it('uses exact public contract ID variable names', () => {
    expect(PUBLIC_CONTRACT_ID_NAMES).toEqual([
      'VITE_AEGIS_VAULT_ID',
      'VITE_EMERGENCY_VAULT_ID',
      'VITE_HELPHONE_DAO_ID',
      'VITE_MAINTAINER_VAULT_ID',
    ]);
  });

  it('rejects a bundle containing fake Stellar and database credentials', () => {
    const result = auditBundle('leaked');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stellar-secret-seed');
    expect(result.stderr).toContain('database-connection-string');
  });

  it('accepts a clean build fixture', () => {
    const result = auditBundle('clean');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bundle audit OK');
  });
});
