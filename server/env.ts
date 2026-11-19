/**
 * Server-side environment variable validation using Zod.
 *
 * Validates all required server environment variables at startup.
 * Fails loudly if required variables are missing or invalid.
 */
import { z } from 'zod';
import {
  contractIdsFromEnvironment,
  createContractIdsSchema,
  normalizeContractEnvironment,
} from '../shared/contractEnvironment.ts';

const baseServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  STELLAR_SECRET_KEY: z.string().min(56),
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  AEGIS_VAULT_ID: z.string().optional(),
  EMERGENCY_VAULT_ID: z.string().optional(),
  HELPHONE_DAO_ID: z.string().optional(),
  MAINTAINER_VAULT_ID: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export function createServerContractIdsSchema(network: 'testnet' | 'mainnet') {
  return createContractIdsSchema(network, 'server');
}

const serverEnvSchema = baseServerEnvSchema.superRefine((env, ctx) => {
  const contractIds = createServerContractIdsSchema(env.STELLAR_NETWORK).safeParse(env);
  if (!contractIds.success) {
    for (const issue of contractIds.error.issues) ctx.addIssue(issue);
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Mask a secret value for safe logging.
 * Shows first 4 and last 4 characters, masks the rest.
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}

function validateServerEnv(): ServerEnv {
  const normalizedEnv = normalizeContractEnvironment(process.env, 'server');
  const result = serverEnvSchema.safeParse(normalizedEnv);
  const network =
    normalizedEnv.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  const contractResult = createServerContractIdsSchema(network).safeParse(normalizedEnv);

  if (!result.success) {
    if (process.env.NODE_ENV === 'test') {
      if (!contractResult.success) {
        throw new Error(
          `Invalid server contract IDs for ${network}: ${contractResult.error.issues
            .map((issue) => issue.message)
            .join('; ')}`,
        );
      }
      return {
        NODE_ENV: 'test',
        PORT: 3001,
        DATABASE_URL: 'postgresql://test:test@localhost:5432/helphone_test',
        STELLAR_SECRET_KEY: 'SB' + 'A'.repeat(54),
        STELLAR_NETWORK: network,
        LOG_LEVEL: 'info',
        ...serverContractIds(normalizedEnv, network),
      };
    }
    const errors = result.error.flatten().fieldErrors;
    console.error('❌ Invalid server environment variables:');
    for (const [key, msgs] of Object.entries(errors)) {
      console.error(`  ${key}: ${msgs?.join(', ')}`);
    }
    throw new Error('Server environment validation failed');
  }

  return {
    ...result.data,
    ...serverContractIds(normalizedEnv, result.data.STELLAR_NETWORK),
  };
}

function serverContractIds(
  env: Record<string, unknown>,
  network: 'testnet' | 'mainnet',
) {
  const ids = contractIdsFromEnvironment(env, network, 'server');
  return {
    AEGIS_VAULT_ID: ids.aegis_vault,
    EMERGENCY_VAULT_ID: ids.emergency_vault,
    HELPHONE_DAO_ID: ids.helphone_dao,
    MAINTAINER_VAULT_ID: ids.maintainer_vault,
  };
}

export function validateServerContractEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof serverContractIds> {
  const normalized = normalizeContractEnvironment(env, 'server');
  const rawNetwork = env.STELLAR_NETWORK ?? 'testnet';
  if (rawNetwork !== 'testnet' && rawNetwork !== 'mainnet') {
    throw new Error(
      `STELLAR_NETWORK must be testnet or mainnet (received ${rawNetwork}).`,
    );
  }
  const network = rawNetwork;
  const result = createContractIdsSchema(network, 'server').safeParse(normalized);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `${String(issue.path[0])}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server contract IDs for ${network}: ${messages}`);
  }
  return serverContractIds(normalized, network);
}

export const serverEnv = validateServerEnv();

export interface MaintenanceConfig {
  enabled: boolean;
  bloatThresholdPct: number;
  windowStartHour: number;
  windowEndHour: number;
  intervalMs: number;
  reindexCooldownMs: number;
  minTableTuples: number;
}

function envNumber(raw: string | undefined, fallback: number, bounds: { min: number; max: number }): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= bounds.min && n <= bounds.max ? n : fallback;
}

export function getMaintenanceConfig(env: NodeJS.ProcessEnv = process.env): MaintenanceConfig {
  return {
    enabled: env.DB_MAINTENANCE_ENABLED === 'true',
    bloatThresholdPct: envNumber(env.DB_BLOAT_THRESHOLD_PCT, 20, { min: 1, max: 100 }),
    windowStartHour: Math.trunc(envNumber(env.DB_MAINTENANCE_WINDOW_START_UTC, 2, { min: 0, max: 23 })),
    windowEndHour: Math.trunc(envNumber(env.DB_MAINTENANCE_WINDOW_END_UTC, 5, { min: 0, max: 23 })),
    intervalMs: envNumber(env.DB_MAINTENANCE_INTERVAL_MS, 15 * 60_000, { min: 1_000, max: 24 * 3_600_000 }),
    reindexCooldownMs: envNumber(env.DB_REINDEX_COOLDOWN_MS, 7 * 24 * 3_600_000, { min: 0, max: 365 * 24 * 3_600_000 }),
    minTableTuples: envNumber(env.DB_MAINTENANCE_MIN_TUPLES, 1_000, { min: 0, max: Number.MAX_SAFE_INTEGER }),
  };
}
