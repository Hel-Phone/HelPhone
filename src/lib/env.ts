/**
 * Client-side environment validation using Zod.
 *
 * Secrets should never be exposed to the client bundle.
 */
import { z } from 'zod';
import {
  contractIdsFromEnvironment,
  createContractIdsSchema,
  normalizeContractEnvironment,
} from '../../shared/contractEnvironment.ts';

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

export function createClientEnvSchema(network: 'testnet' | 'mainnet') {
  return clientEnvBaseSchema.superRefine((env, ctx) => {
    const result = createContractIdsSchema(network, 'client').safeParse(env);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
    }
  });
}

export const clientEnvSchema = createClientEnvSchema('testnet');
export type ClientEnv = z.infer<typeof clientEnvBaseSchema> & {
  VITE_AEGIS_VAULT_ID?: string;
  VITE_EMERGENCY_VAULT_ID?: string;
  VITE_HELPHONE_DAO_ID?: string;
  VITE_MAINTAINER_VAULT_ID?: string;
};

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

  const ids = contractIdsFromEnvironment(result.data, network, 'client');
  return {
    ...result.data,
    VITE_AEGIS_VAULT_ID: ids.aegis_vault,
    VITE_EMERGENCY_VAULT_ID: ids.emergency_vault,
    VITE_HELPHONE_DAO_ID: ids.helphone_dao,
    VITE_MAINTAINER_VAULT_ID: ids.maintainer_vault,
  };
}

export const clientEnv = validateClientEnv();
