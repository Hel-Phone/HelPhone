import { describe, expect, it } from 'vitest';
import { buildBindingManifest, renderBindings } from '../scripts/generate-soroban-bindings.js';

describe('Soroban binding generator', () => {
  it('discovers contract crates and public contract functions', () => {
    const manifest = buildBindingManifest();
    const aegis = manifest.find((binding) => binding.crateName === 'aegis_vault');
    const dao = manifest.find((binding) => binding.crateName === 'helphone_dao');

    expect(aegis).toBeTruthy();
    expect(dao.contractIds).toEqual({
      testnet: 'CDP5XZ7UYCGSQBYRDYM2OEAUQJULBZPULSQXK7LGNAJTRXRG3VHZLSHY',
      mainnet: 'UNDEPLOYED',
    });
    expect(aegis.functions.map((fn) => fn.name)).toEqual(expect.arrayContaining([
      'fund_zone',
      'claim_aid',
      'treasury_deposit',
    ]));
  });

  it('renders a typed registry module', () => {
    const output = renderBindings([
      { crateName: 'demo', wasmFile: 'demo.wasm', source: 'contracts/demo/src/lib.rs', functions: [{ name: 'ping', params: [] }] },
    ]);

    expect(output).toContain('export const sorobanBindings');
    expect(output).toContain('getSorobanBinding');
    expect(output).toContain('ping');
  });
});
