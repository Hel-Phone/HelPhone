import { z } from "zod";
import {
  contractManifest,
  type ContractName,
  type StellarNetwork,
} from "./contractManifest.ts";

export const contractIdSchema = z.string().regex(/^C[A-Z2-7]{55}$/);

const CONTRACT_ENV_NAMES: Record<
  "server" | "client",
  Record<ContractName, string>
> = {
  server: {
    aegis_vault: "AEGIS_VAULT_ID",
    emergency_vault: "EMERGENCY_VAULT_ID",
    helphone_dao: "HELPHONE_DAO_ID",
    maintainer_vault: "MAINTAINER_VAULT_ID",
  },
  client: {
    aegis_vault: "VITE_AEGIS_VAULT_ID",
    emergency_vault: "VITE_EMERGENCY_VAULT_ID",
    helphone_dao: "VITE_HELPHONE_DAO_ID",
    maintainer_vault: "VITE_MAINTAINER_VAULT_ID",
  },
};

const CONTRACT_NAMES = Object.keys(contractManifest) as ContractName[];

export function normalizeContractEnvironment(
  input: Record<string, unknown>,
  side: "server" | "client",
): Record<string, unknown> {
  const normalized = { ...input };
  const aliases =
    side === "client"
      ? [
          ["VITE_HELPHONE_CONTRACT_ID", "VITE_HELPHONE_DAO_ID"],
          ["VITE_HELPHONE_DAO_CONTRACT_ID", "VITE_HELPHONE_DAO_ID"],
          ["VITE_MAINTAINER_VAULT_CONTRACT_ID", "VITE_MAINTAINER_VAULT_ID"],
        ]
      : [
          ["CONTRACT_ID", "HELPHONE_DAO_ID"],
          ["HELPHONE_CONTRACT_ID", "HELPHONE_DAO_ID"],
        ];

  for (const [deprecatedName, canonicalName] of aliases) {
    const deprecatedValue = normalized[deprecatedName];
    if (deprecatedValue === undefined || deprecatedValue === "") continue;
    console.warn(
      `[DEPRECATED] ${deprecatedName} is deprecated; use ${canonicalName} for the selected Stellar network.`,
    );
    if (normalized[canonicalName] === undefined || normalized[canonicalName] === "") {
      normalized[canonicalName] = deprecatedValue;
    }
  }
  return normalized;
}

export function createContractIdsSchema(
  network: StellarNetwork,
  side: "server" | "client",
) {
  const names = CONTRACT_ENV_NAMES[side];
  const shape = Object.fromEntries(
    CONTRACT_NAMES.map((contract) => [
      names[contract],
      z
        .string()
        .regex(
          /^C[A-Z2-7]{55}$/,
          `${names[contract]} must be a valid Stellar contract ID for ${network}.`,
        )
        .optional(),
    ]),
  ) as Record<string, z.ZodOptional<z.ZodString>>;

  return z.object(shape).superRefine((values, ctx) => {
    for (const contract of CONTRACT_NAMES) {
      const variableName = names[contract];
      const suppliedId = values[variableName] as string | undefined;
      if (suppliedId === undefined) continue;

      const expectedId = contractManifest[contract][network].id;
      if (expectedId === "UNDEPLOYED" || suppliedId !== expectedId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [variableName],
          message: `${variableName} does not match the ${network} ${contract} ID in contracts/manifest.json.`,
        });
      }
    }
  });
}

export function contractIdsFromEnvironment(
  values: Record<string, unknown>,
  network: StellarNetwork,
  side: "server" | "client",
): Partial<Record<ContractName, string>> {
  const names = CONTRACT_ENV_NAMES[side];
  return Object.fromEntries(
    CONTRACT_NAMES.flatMap((contract) => {
      const supplied = values[names[contract]];
      const manifestId = contractManifest[contract][network].id;
      const id =
        typeof supplied === "string"
          ? supplied
          : manifestId === "UNDEPLOYED"
            ? undefined
            : manifestId;
      return id === undefined ? [] : [[contract, id]];
    }),
  );
}
