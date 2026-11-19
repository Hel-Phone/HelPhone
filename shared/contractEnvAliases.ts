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
