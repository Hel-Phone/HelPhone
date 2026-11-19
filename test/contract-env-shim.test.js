import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeContractEnvironment } from '../shared/contractEnvAliases.ts';

const ROOT = process.cwd();
const CHECKER = resolve(ROOT, 'scripts/check-env-names.mjs');
const tempRoots = [];

function createRoot() {
  const root = mkdtempSync(join(tmpdir(), 'helphone-env-names-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('contract environment deprecation shim', () => {
  it('maps deprecated client and server aliases and warns loudly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const oldClientName = ['VITE', 'HELPHONE', 'CONTRACT', 'ID'].join('_');
    const oldServerName = ['CONTRACT', 'ID'].join('_');

    expect(normalizeContractEnvironment(
      { [oldClientName]: 'client-id' },
      'client',
    ).VITE_HELPHONE_DAO_ID).toBe('client-id');
    expect(normalizeContractEnvironment(
      { [oldServerName]: 'server-id' },
      'server',
    ).HELPHONE_DAO_ID).toBe('server-id');

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.flat().join(' ')).toContain('[DEPRECATED]');
    warn.mockRestore();
  });

  it('passes a clean tree and fails when a deprecated name appears outside docs', () => {
    const cleanRoot = createRoot();
    mkdirSync(join(cleanRoot, 'src'), { recursive: true });
    writeFileSync(join(cleanRoot, 'src', 'clean.js'), 'const id = VITE_HELPHONE_DAO_ID;\n');
    writeFileSync(join(cleanRoot, 'legacy.md'), 'deprecated names are documented here\n');
    const clean = spawnSync(process.execPath, [CHECKER, cleanRoot], { encoding: 'utf8' });
    expect(clean.status).toBe(0);

    const dirtyRoot = createRoot();
    mkdirSync(join(dirtyRoot, 'src'), { recursive: true });
    const deprecatedName = ['VITE', 'HELPHONE', 'CONTRACT', 'ID'].join('_');
    writeFileSync(join(dirtyRoot, 'src', 'legacy.js'), `const id = ${deprecatedName};\n`);
    const dirty = spawnSync(process.execPath, [CHECKER, dirtyRoot], { encoding: 'utf8' });
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('Deprecated contract environment names found');
  });
});
