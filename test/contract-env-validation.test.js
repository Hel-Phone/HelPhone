import { describe, expect, it } from 'vitest';
import { createClientEnvSchema } from '../src/lib/env.ts';
import { createServerContractIdsSchema } from '../server/env.ts';

const VALID_TESTNET_ID =
  'CDP5XZ7UYCGSQBYRDYM2OEAUQJULBZPULSQXK7LGNAJTRXRG3VHZLSHY';
const OLD_PLACEHOLDER_ID =
  'CC325F37' + 'QW7N2F5M3QGHL4A4O7J2K9L0M1N2O3P4Q5R6S7T8U9V0';

const schemas = [
  {
    name: 'client',
    variable: 'VITE_HELPHONE_DAO_ID',
    create: (network = 'testnet') =>
      createClientEnvSchema(network, {
        helphone_dao: network === 'testnet' ? VALID_TESTNET_ID : 'UNDEPLOYED',
      }),
    input: (value) => ({ VITE_STELLAR_NETWORK: 'testnet', VITE_HELPHONE_DAO_ID: value }),
  },
  {
    name: 'server',
    variable: 'HELPHONE_DAO_ID',
    create: (network = 'testnet') => createServerContractIdsSchema(network),
    input: (value) => ({ HELPHONE_DAO_ID: value }),
  },
];

describe.each(schemas)('$name contract environment schema', ({
  variable,
  create,
  input,
}) => {
  it('accepts a manifest-matching contract ID', () => {
    expect(create().safeParse(input(VALID_TESTNET_ID)).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['UNDEPLOYED', 'UNDEPLOYED'],
    ['old placeholder', OLD_PLACEHOLDER_ID],
    ['wrong length', VALID_TESTNET_ID.slice(0, -1)],
  ])('rejects %s with the variable and network in the issue', (_case, id) => {
    const result = create().safeParse(input(id));
    expect(result.success).toBe(false);
    expect(result.error.issues.some((issue) =>
      issue.path.includes(variable) && issue.message.includes('testnet'),
    )).toBe(true);
  });

  it('rejects a testnet ID when validating against mainnet', () => {
    const result = create('mainnet').safeParse(input(VALID_TESTNET_ID));
    expect(result.success).toBe(false);
    expect(result.error.issues.some((issue) =>
      issue.path.includes(variable) && issue.message.includes('mainnet'),
    )).toBe(true);
  });
});
