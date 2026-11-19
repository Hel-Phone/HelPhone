import manifestJson from "../contracts/manifest.json" with { type: "json" };

export type StellarNetwork = "testnet" | "mainnet";
export type ContractName =
  | "aegis_vault"
  | "emergency_vault"
  | "helphone_dao"
  | "maintainer_vault";

export interface ContractDeployment {
  id: string;
  wasmHash: string;
  status?: "unverified";
}

export type ContractManifest = Record<
  ContractName,
  Record<StellarNetwork, ContractDeployment>
>;

export const contractManifest = manifestJson as ContractManifest;

export function getContractDeployment(
  contract: ContractName,
  network: StellarNetwork,
): ContractDeployment {
  return contractManifest[contract][network];
}

export function getContractIds(
  network: StellarNetwork,
): Record<ContractName, string> {
  return Object.fromEntries(
    (Object.keys(contractManifest) as ContractName[]).map((contract) => [
      contract,
      contractManifest[contract][network].id,
    ]),
  ) as Record<ContractName, string>;
}
