/**
 * Client-side environment validation using Zod.
 *
 * Secrets should never be exposed to the client bundle.
 */
import { z } from 'zod';
import { normalizeContractEnvironment } from '../../shared/contractEnvAliases.ts';

type StellarNetwork = 'testnet' | 'mainnet';
type ContractName =
  | 'aegis_vault'
  | 'emergency_vault'
  | 'helphone_dao'
  | 'maintainer_vault';
type ContractIds = Partial<Record<ContractName, string>>;

declare const __HELPHONE_CONTRACT_IDS__: ContractIds;
declare const __HELPHONE_CONTRACT_NETWORK__: StellarNetwork;

const CONTRACT_ENV_NAMES: Record<ContractName, string> = {
  aegis_vault: 'VITE_AEGIS_VAULT_ID',
  emergency_vault: 'VITE_EMERGENCY_VAULT_ID',
  helphone_dao: 'VITE_HELPHONE_DAO_ID',
  maintainer_vault: 'VITE_MAINTAINER_VAULT_ID',
};
const CONTRACT_NAMES = Object.keys(CONTRACT_ENV_NAMES) as ContractName[];
const clientManifestIds =
  typeof __HELPHONE_CONTRACT_IDS__ === 'undefined'
    ? {}
    : __HELPHONE_CONTRACT_IDS__;
const clientManifestNetwork =
  typeof __HELPHONE_CONTRACT_NETWORK__ === 'undefined'
    ? undefined
    : __HELPHONE_CONTRACT_NETWORK__;

const clientEnvBaseSchema = z.object({
  VITE_STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  VITE_AEGIS_VAULT_ID: z.string().optional(),
  VITE_EMERGENCY_VAULT_ID: z.string().optional(),
  VITE_HELPHONE_DAO_ID: z.string().optional(),
  VITE_MAINTAINER_VAULT_ID: z.string().optional(),
  VITE_SUPABASE_URL: z.string().url().optional(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  VITE_MAPBOX_TOKEN: z.string().min(1).optional(),
  VITE_API_BASE_URL: z.string().url().optional(),
});

export function createClientEnvSchema(
  network: StellarNetwork,
  manifestIds: ContractIds = clientManifestIds,
) {
  return clientEnvBaseSchema.superRefine((env, ctx) => {
    if (clientManifestNetwork && network !== clientManifestNetwork) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VITE_STELLAR_NETWORK'],
        message: `VITE_STELLAR_NETWORK does not match the ${clientManifestNetwork} build manifest.`,
      });
    }

    for (const contract of CONTRACT_NAMES) {
      const variableName = CONTRACT_ENV_NAMES[contract];
      const id = env[variableName] as string | undefined;
      if (id === undefined) continue;

      if (!/^C[A-Z2-7]{55}$/.test(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [variableName],
          message: `${variableName} must be a valid Stellar contract ID for ${network}.`,
        });
        continue;
      }

      const expectedId = manifestIds[contract];
      if (
        expectedId !== undefined &&
        (expectedId === 'UNDEPLOYED' || id !== expectedId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [variableName],
          message: `${variableName} does not match the ${network} ${contract} ID in contracts/manifest.json.`,
        });
      }
    }
  });
}

export const clientEnvSchema = createClientEnvSchema('testnet');
export type ClientEnv = z.infer<typeof clientEnvBaseSchema>;

export function validateClientEnv(
  env: Record<string, unknown> = { ...import.meta.env },
): ClientEnv {
  const normalized = normalizeContractEnvironment(env, 'client');
  const network =
    normalized.VITE_STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  const result = createClientEnvSchema(network).safeParse(normalized);

  if (!result.success) {
    console.error(
      '❌ Invalid client environment variables:',
      result.error.flatten().fieldErrors,
    );
    throw new Error(
      `Invalid client environment configuration for ${network}.`,
    );
  }

  const ids = Object.fromEntries(
    CONTRACT_NAMES.flatMap((contract) => {
      const supplied = result.data[CONTRACT_ENV_NAMES[contract]] as
        | string
        | undefined;
      const manifestId = clientManifestIds[contract];
      const id = supplied ?? (manifestId && manifestId !== 'UNDEPLOYED' ? manifestId : undefined);
      return id === undefined ? [] : [[CONTRACT_ENV_NAMES[contract], id]];
    }),
  );
  return { ...result.data, ...ids };
}

export const clientEnv = validateClientEnv();
